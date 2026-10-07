import { RoomObject } from "./roomObject";
import { RoomError, normalizeCode, randomCode } from "../../web/src/online/room";
import { PROTOCOL_VERSION, type CreateRoomBody, type ErrorBody, type JoinRoomBody, type RoomCredentials } from "../../web/src/online/protocol";

export { RoomObject };

export interface Env {
  ROOMS: DurableObjectNamespace<RoomObject>;
}

const ALLOWED_ORIGINS = new Set([
  "https://rummi-online.com",
  "https://www.rummi-online.com",
  "https://rummikub-ai.pages.dev",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

function allowedOrigin(origin: string | null): origin is string {
  return Boolean(origin && ALLOWED_ORIGINS.has(origin));
}

function withCors(origin: string | null, response: Response): Response {
  const headers = new Headers(response.headers);
  if (allowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return new Response(response.body, { status: response.status, headers });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new RoomError("Mensaje inválido");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigin(origin)) {
      return new Response("Origen no permitido", { status: 403 });
    }
    if (request.method === "OPTIONS") return withCors(origin, new Response(null, { status: 204 }));

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    try {
      if (path === "/api/rooms" && request.method === "POST") {
        return withCors(origin, await create(request, env));
      }
      if (path === "/api/rooms/join" && request.method === "POST") {
        return withCors(origin, await join(request, env));
      }
      if (path === "/ws") return socket(request, env, url);
    } catch (error: unknown) {
      const body: ErrorBody = { error: errorMessage(error, "Error") };
      const status = error instanceof RoomError ? 400 : 500;
      return withCors(origin, Response.json(body, { status }));
    }

    return withCors(origin, new Response("No encontrado", { status: 404 }));
  },
};

async function create(request: Request, env: Env): Promise<Response> {
  const body = (await readJson(request)) as CreateRoomBody;
  let last = "No se pudo crear la sala";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      const creds = await env.ROOMS.getByName(code).openRoom(body, code);
      return Response.json(creds);
    } catch (error: unknown) {
      last = errorMessage(error, last);
      if (!last.includes("ya existe")) break;
    }
  }
  return Response.json({ error: last } satisfies ErrorBody, { status: 400 });
}

async function join(request: Request, env: Env): Promise<Response> {
  const body = (await readJson(request)) as JoinRoomBody;
  const code = normalizeCode(body.code ?? "");
  if (!code) return Response.json({ error: "Falta el código" } satisfies ErrorBody, { status: 400 });
  try {
    const creds: RoomCredentials = await env.ROOMS.getByName(code).enterRoom(body.name ?? "");
    return Response.json(creds);
  } catch (error: unknown) {
    return Response.json({ error: errorMessage(error, "No se pudo entrar") } satisfies ErrorBody, { status: 400 });
  }
}

function socket(request: Request, env: Env, url: URL): Response | Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Se espera WebSocket", { status: 426 });
  }
  if (url.searchParams.get("v") !== String(PROTOCOL_VERSION)) {
    return new Response("El cliente y el servidor no coinciden", { status: 400 });
  }
  const code = normalizeCode(url.searchParams.get("code") ?? "");
  if (!code) return new Response("Falta el código", { status: 400 });
  return env.ROOMS.getByName(code).fetch(request);
}
