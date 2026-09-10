import type { GamePayload } from "./types";
import { RummyBot, type BotMove, type PlayerView } from "./engine/bot";
import {
  createGame as createLocal,
  drawTile as drawLocal,
  playTiles as playLocal,
  previewPlay as previewLocal,
  setMoveChooser,
  tickGame as tickLocal,
} from "./engine/session";

const fallback = new RummyBot();
let reqId = 1;
const pending = new Map<number, { resolve: (move: BotMove) => void; reject: (e: Error) => void }>();

function failPending(error: Error): void {
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
}

let worker: Worker | null = null;
try {
  worker = new Worker(new URL("./engine/worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent) => {
    const { id, ok, move, error } = event.data as {
      id: number;
      ok: boolean;
      move?: BotMove;
      error?: string;
    };
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    if (ok && move) waiter.resolve(move);
    else waiter.reject(new Error(error || "Worker error"));
  };
  worker.onerror = () => {
    failPending(new Error("Worker error"));
    worker = null;
  };
} catch {
  worker = null;
}

setMoveChooser(async (view: PlayerView, difficulty: string, debug: boolean) => {
  if (!worker) return fallback.chooseMove(view, difficulty, debug);
  const id = reqId++;
  return new Promise<BotMove>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, view, difficulty, debug });
  });
});

export async function createGame(body: {
  seed?: number;
  difficulty: string;
  opponents: number;
  debug: boolean;
  spectator?: boolean;
  botCount?: number;
  difficulties?: string[];
}): Promise<GamePayload> {
  return createLocal(body);
}

export async function drawTile(id: string): Promise<GamePayload> {
  return drawLocal(id);
}

export async function previewPlay(id: string, tileIds: number[]) {
  return previewLocal(id, tileIds);
}

export async function playTiles(id: string, tileIds: number[], melds?: number[][]): Promise<GamePayload> {
  return playLocal(id, tileIds, melds);
}

export async function tickGame(id: string): Promise<GamePayload> {
  return tickLocal(id);
}
