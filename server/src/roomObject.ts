import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import type { GameState } from "../../web/src/engine/game";
import {
  applyCommand,
  broadcastFor,
  createRoom,
  joinRoom,
  parseClientMessage,
  seatIndex,
  setConnected,
  welcomeFor,
  type RoomSnapshot,
} from "../../web/src/online/room";
import type { CreateRoomBody, RoomCredentials, ServerMessage } from "../../web/src/online/protocol";

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
    this.save(opened.room);
    return { code: opened.room.code, token: opened.token, seat: opened.seat };
  }

  async enterRoom(name: string): Promise<RoomCredentials> {
    const room = this.load();
    if (!room) throw new Error("Sala no encontrada");
    const joined = joinRoom(room, name ?? "");
    this.save(room);
    this.broadcast(room, joined.frames);
    return { code: room.code, token: joined.token, seat: joined.seat };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Se espera WebSocket", { status: 426 });
    }
    const url = new URL(request.url);
    const token = url.searchParams.get("token") ?? "";
    const room = this.load();
    if (!room) return new Response("Sala no encontrada", { status: 404 });
    try {
      seatIndex(room, token);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Token inválido";
      return new Response(message, { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [token]);
    setConnected(room, token, true);
    this.save(room);
    server.send(JSON.stringify(welcomeFor(room, token)));
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === server) continue;
      this.sendTo(socket, room);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const token = this.tokenOf(ws);
    if (!token) return;
    const room = this.load();
    if (!room) {
      this.sendError(ws, "Sala no encontrada");
      return;
    }
    let requestId = "";
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      const command = parseClientMessage(text);
      requestId = command.requestId;
      const frames = applyCommand(room, token, command);
      this.save(room);
      this.broadcast(room, frames, { token, requestId });
    } catch (error: unknown) {
      this.sendError(ws, error instanceof Error ? error.message : "Error", requestId);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const token = this.tokenOf(ws);
    if (!token) return;
    const others = this.ctx.getWebSockets(token).filter((socket) => socket !== ws);
    if (others.length) return;
    const room = this.load();
    if (!room) return;
    try {
      setConnected(room, token, false);
    } catch {
      return;
    }
    this.save(room);
    this.broadcast(room);
  }

  private load(): RoomSnapshot | null {
    const rows = this.ctx.storage.sql.exec<{ data: string }>("SELECT data FROM room WHERE id = 1").toArray();
    if (!rows.length) return null;
    return JSON.parse(rows[0].data) as RoomSnapshot;
  }

  private save(room: RoomSnapshot): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO room (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      JSON.stringify(room),
    );
  }

  private tokenOf(ws: WebSocket): string {
    return this.ctx.getTags(ws)[0] ?? "";
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
