/** Cliente HTTP contra FastAPI (legacy). La UI usa `localApi.ts`. */
import type { GamePayload } from "./types";

async function parse(res: Response) {
  const data = await res.json().catch(() => ({}));
  const message =
    typeof data.detail === "string"
      ? data.detail
      : Array.isArray(data.detail)
        ? data.detail.map((item: { msg?: string }) => item.msg || "").filter(Boolean).join(" ")
        : data.message;
  if (!res.ok) {
    throw new Error(message || `HTTP ${res.status}`);
  }
  return data;
}

export async function createGame(body: {
  seed?: number;
  difficulty: string;
  opponents: number;
  debug: boolean;
  spectator?: boolean;
  botCount?: number;
  difficulties?: string[];
}): Promise<GamePayload> {
  return parse(
    await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

export async function fetchGame(id: string): Promise<GamePayload> {
  return parse(await fetch(`/api/games/${id}`));
}

export async function drawTile(id: string): Promise<GamePayload> {
  return parse(await fetch(`/api/games/${id}/draw`, { method: "POST" }));
}

export async function previewPlay(
  id: string,
  tileIds: number[],
): Promise<{ table: GamePayload["view"]["table"]; tileIds: number[] }> {
  return parse(
    await fetch(`/api/games/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tileIds }),
    })
  );
}

export async function playTiles(
  id: string,
  tileIds: number[],
  melds?: number[][],
): Promise<GamePayload> {
  return parse(
    await fetch(`/api/games/${id}/play`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(melds ? { melds } : { tileIds }),
    })
  );
}

export async function tickGame(id: string): Promise<GamePayload> {
  return parse(await fetch(`/api/games/${id}/tick`, { method: "POST" }));
}
