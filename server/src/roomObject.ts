import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import type { GameState } from "../../web/src/engine/game";
import {
  broadcastFor,
  createRoom,
  dispatchSocket,
  indexesToClose,
  joinRoom,
  setConnected,
  settle,
  welcomeFor,
  type RoomSnapshot,
} from "../../web/src/online/room";
import type { CreateRoomBody, RoomCredentials, ServerMessage } from "../../web/src/online/protocol";

const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;
const MAX_SOCKETS = 8;

type SocketAttachment = { token?: string };

export class RoomObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          data TEXT NOT NULL
        )
      `);
    });
  }

  async openRoom(input: CreateRoomBody, code: string): Promise<RoomCredentials> {
    if (this.load()) throw new Error("La sala ya existe");
    const opened = createRoom({
      hostName: input?.name ?? "",
      seats: input?.seats,
      code,
    });
    await this.save(opened.room);
    return { code: opened.room.code, token: opened.token, seat: opened.seat };
  }

  async enterRoom(name: string): Promise<RoomCredentials> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const room = this.load();
      if (!room) throw new Error("Sala no encontrada");
      const joined = joinRoom(room, name ?? "");
      const fresh = await this.commit(room);
      this.broadcast(fresh, joined.frames);
      return { code: fresh.code, token: joined.token, seat: joined.seat };
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Se espera WebSocket", { status: 426 });
    }
    const room = this.load();
    if (!room) return new Response("Sala no encontrada", { status: 404 });
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) {
      return new Response("La sala no acepta más conexiones", { status: 429 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.setAlarm(this.alarmWhen(this.load()));
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const room = this.load();
      if (!room) {
        this.sendError(ws, "Sala no encontrada");
        return;
      }
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      const result = dispatchSocket(room, this.tokenOf(ws) || null, text);
      if (result.type === "close") {
        ws.close(1008, "No se pudo autenticar");
        return;
      }
      if (result.type === "authenticate") {
        ws.serializeAttachment({ token: result.token } satisfies SocketAttachment);
        setConnected(room, result.token, true);
        const fresh = await this.commit(room);
        this.closePrevious(ws, result.token);
        ws.send(JSON.stringify(welcomeFor(fresh, result.token)));
        for (const socket of this.ctx.getWebSockets()) {
          if (socket === ws) continue;
          this.sendTo(socket, fresh);
        }
        return;
      }
      if (result.type === "left") {
        const fresh = await this.commit(room);
        this.broadcast(fresh, result.frames);
        try {
          ws.close(1000, "Saliste de la sala");
        } catch {
          // The socket can already be closing.
        }
        return;
      }
      if (result.type === "error") {
        this.sendError(ws, result.message, result.requestId ?? "");
        return;
      }
      const fresh = await this.commit(room);
      this.broadcast(fresh, result.frames, { token: this.tokenOf(ws), requestId: result.requestId });
    });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const token = this.tokenOf(ws);
      if (!token) return;
      const others = this.ctx.getWebSockets().filter((socket) => socket !== ws && this.tokenOf(socket) === token);
      if (others.length) return;
      const room = this.load();
      if (!room) return;
      try {
        setConnected(room, token, false);
      } catch {
        return;
      }
      const frames = settle(room, Date.now());
      const fresh = await this.commit(room);
      this.broadcast(fresh, frames);
    });
  }

  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const room = this.load();
      if (room?.passAt != null && Date.now() + 1000 >= room.passAt) {
        const frames = settle(room, Math.max(Date.now(), room.passAt));
        const fresh = await this.commit(room);
        this.broadcast(fresh, frames);
        return;
      }
      if (this.ctx.getWebSockets().length > 0) {
        await this.ctx.storage.setAlarm(this.alarmWhen(room));
        return;
      }
      if (room && Date.now() - room.lastActivity < ROOM_IDLE_MS) {
        await this.ctx.storage.setAlarm(this.alarmWhen(room));
        return;
      }
      if (this.ctx.getWebSockets().length > 0) {
        await this.ctx.storage.setAlarm(this.alarmWhen(room));
        return;
      }
      await this.ctx.storage.deleteAll();
    });
  }

  private closePrevious(ws: WebSocket, token: string): void {
    const sockets = this.ctx.getWebSockets();
    const tokens = sockets.map((socket) => this.tokenOf(socket) || null);
    for (const index of indexesToClose(tokens, sockets.indexOf(ws), token)) {
      sockets[index].close(4000, "Se abrió otra conexión con este asiento");
    }
  }

  private load(): RoomSnapshot | null {
    const rows = this.ctx.storage.sql.exec<{ data: string }>("SELECT data FROM room WHERE id = 1").toArray();
    if (!rows.length) return null;
    return JSON.parse(rows[0].data) as RoomSnapshot;
  }

  private alarmWhen(room: RoomSnapshot | null): number {
    const idle = Date.now() + ROOM_IDLE_MS;
    if (room?.passAt != null) return Math.min(room.passAt, idle);
    return idle;
  }

  private async save(room: RoomSnapshot): Promise<void> {
    room.lastActivity = Date.now();
    this.ctx.storage.sql.exec(
      "INSERT INTO room (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      JSON.stringify(room),
    );
    await this.ctx.storage.setAlarm(this.alarmWhen(room));
  }

  private async commit(room: RoomSnapshot): Promise<RoomSnapshot> {
    await this.save(room);
    return this.load() ?? room;
  }

  private tokenOf(ws: WebSocket): string {
    const data = ws.deserializeAttachment() as SocketAttachment | null;
    return typeof data?.token === "string" ? data.token : "";
  }

  private sendTo(ws: WebSocket, room: RoomSnapshot, frames: GameState[] = [], requestId = ""): void {
    const token = this.tokenOf(ws);
    if (!token) return;
    try {
      const message = broadcastFor(room, token, frames);
      if (requestId && message.type === "state") message.requestId = requestId;
      ws.send(JSON.stringify(message));
    } catch {
      // The socket can already be closing.
    }
  }

  private broadcast(room: RoomSnapshot, frames: GameState[] = [], actor?: { token: string; requestId: string }): void {
    for (const socket of this.ctx.getWebSockets()) {
      const token = this.tokenOf(socket);
      const requestId = actor && token === actor.token ? actor.requestId : "";
      this.sendTo(socket, room, frames, requestId);
    }
  }

  private sendError(ws: WebSocket, message: string, requestId = ""): void {
    const body: ServerMessage = { type: "error", message, requestId: requestId || undefined };
    try {
      ws.send(JSON.stringify(body));
    } catch {
      // Ignore a socket that already closed.
    }
  }
}
