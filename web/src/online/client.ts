import { PROTOCOL_VERSION, type CreateRoomBody, type ErrorBody, type RoomCredentials, type ServerMessage, type WaitingInfo } from "./protocol";
import type { GamePayload } from "../types";

const STORAGE_KEY = "rummikub.online";

export function multiplayerBase(): string {
  const configured = import.meta.env.VITE_MULTIPLAYER_URL ?? "";
  return configured.replace(/\/$/, "");
}

export function multiplayerConfigured(): boolean {
  if (multiplayerBase()) return true;
  if (typeof location === "undefined") return false;
  return location.hostname === "127.0.0.1" || location.hostname === "localhost";
}

export function saveOnlineSession(creds: RoomCredentials): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

export function loadOnlineSession(): RoomCredentials | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as RoomCredentials;
    if (!data.code || !data.token || typeof data.seat !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

export function clearOnlineSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function createOnlineRoom(body: CreateRoomBody): Promise<RoomCredentials> {
  return postJson<RoomCredentials>("/api/rooms", body);
}

export function joinOnlineRoom(code: string, name: string): Promise<RoomCredentials> {
  return postJson<RoomCredentials>("/api/rooms/join", { code, name });
}

type RoomHandlers = {
  onWelcome: (message: Extract<ServerMessage, { type: "welcome" }>) => void;
  onState: (payload: GamePayload) => void;
  onWaiting: (waiting: WaitingInfo) => void;
  onError: (message: string) => void;
  onClose: () => void;
};

export type RoomConnection = {
  draw: () => Promise<GamePayload>;
  play: (tileIds: number[], melds?: number[][]) => Promise<GamePayload>;
  nextRound: () => Promise<GamePayload>;
  leave: () => void;
  close: () => void;
};

export function connectRoom(creds: RoomCredentials, handlers: RoomHandlers): RoomConnection {
  const ws = new WebSocket(socketUrl(creds));
  let pending: { id: string; resolve: (payload: GamePayload) => void; reject: (error: Error) => void } | null = null;
  let closedByUs = false;

  const failPending = (error: Error) => {
    if (!pending) return;
    pending.reject(error);
    pending = null;
  };

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "auth", token: creds.token }));
  };

  ws.onmessage = (event: MessageEvent<string>) => {
    let message: ServerMessage;
    try {
      message = JSON.parse(event.data) as ServerMessage;
    } catch {
      handlers.onError("El servidor envió un mensaje inválido");
      return;
    }
    if (message.type === "error") {
      const error = new Error(message.message);
      if (pending && (!message.requestId || message.requestId === pending.id)) failPending(error);
      else handlers.onError(message.message);
      return;
    }
    if (message.type === "welcome") {
      if (message.version !== PROTOCOL_VERSION) {
        handlers.onError("El cliente y el servidor no coinciden. Recargá la página.");
        ws.close();
        return;
      }
      handlers.onWelcome(message);
      return;
    }
    if (message.type === "waiting") {
      handlers.onWaiting(message.waiting);
      return;
    }
    if (pending && message.requestId === pending.id) {
      pending.resolve(message.payload);
      pending = null;
      return;
    }
    if (pending) return;
    handlers.onState(message.payload);
  };

  ws.onclose = () => {
    failPending(new Error("Se cortó la conexión"));
    if (!closedByUs) handlers.onClose();
  };

  const request = (body: { type: "draw" } | { type: "play"; tileIds: number[]; melds?: number[][] } | { type: "nextRound" }) =>
    new Promise<GamePayload>((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error("No hay conexión con la sala"));
        return;
      }
      if (pending) {
        reject(new Error("Esperá la jugada anterior"));
        return;
      }
      const requestId = crypto.randomUUID();
      pending = { id: requestId, resolve, reject };
      ws.send(JSON.stringify({ ...body, requestId }));
    });

  return {
    draw: () => request({ type: "draw" }),
    play: (tileIds, melds) => request({ type: "play", tileIds, melds }),
    nextRound: () => request({ type: "nextRound" }),
    leave: () => {
      closedByUs = true;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "leave" }));
      ws.onclose = null;
      ws.onmessage = null;
      failPending(new Error("Se cortó la conexión"));
      ws.close();
    },
    close: () => {
      closedByUs = true;
      ws.onclose = null;
      ws.onmessage = null;
      failPending(new Error("Se cortó la conexión"));
      ws.close();
    },
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  if (!multiplayerConfigured()) throw new Error("El servidor de salas no está configurado.");
  let response: Response;
  try {
    response = await fetch(`${multiplayerBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("No se pudo conectar con el servidor de salas.");
  }
  const data = (await response.json().catch(() => ({}))) as T & ErrorBody;
  if (!response.ok) throw new Error(data.error || "No se pudo hablar con la sala");
  return data;
}

function socketUrl(creds: RoomCredentials): string {
  const params = new URLSearchParams({
    code: creds.code,
    v: String(PROTOCOL_VERSION),
  });
  const base = multiplayerBase();
  if (!base) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws?${params}`;
  }
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = params.toString();
  return url.toString();
}
