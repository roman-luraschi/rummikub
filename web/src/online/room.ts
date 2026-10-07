import { parseDifficulty, RummyBot, type PublicEvent } from "../engine/bot";
import { GameEngine, isMatchOver, type GameState } from "../engine/game";
import { payload } from "../engine/serialize";
import { configurationFromLayout, findPlayForSelectedTiles } from "../engine/solver";
import type { GameEvent, GamePayload, GameStep } from "../types";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type SeatRequest,
  type ServerMessage,
  type WaitingInfo,
} from "./protocol";

export class RoomError extends Error {}

export interface RoomSeat {
  name: string;
  token: string | null;
  isBot: boolean;
  difficulty: string | null;
  connected: boolean;
}

export interface RoomSnapshot {
  code: string;
  phase: "lobby" | "playing";
  seats: RoomSeat[];
  state: GameState | null;
  seed: number;
}

const engine = new GameEngine();
const bot = new RummyBot();

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomCode(length = 5): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

export function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function cleanName(name: string, fallback: string): string {
  const trimmed = name.trim().slice(0, 24);
  return trimmed || fallback;
}

function botDifficulty(value: string | undefined): string {
  try {
    return parseDifficulty(value ?? "");
  } catch {
    throw new RoomError("Dificultad de bot inválida");
  }
}

function botLabel(difficulty: string, index: number, total: number): string {
  const label = difficulty.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
  return total > 1 ? `${label} ${index}` : label;
}

function commit(room: RoomSnapshot, draft: RoomSnapshot): void {
  room.phase = draft.phase;
  room.seats = draft.seats;
  room.state = draft.state;
}

export function createRoom(input: {
  hostName: string;
  seats: SeatRequest[];
  code?: string;
  seed?: number;
}): { room: RoomSnapshot; token: string; seat: number } {
  const seats = input.seats;
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 4) {
    throw new RoomError("La sala admite de 2 a 4 jugadores");
  }
  if (seats[0]?.kind !== "human") throw new RoomError("El anfitrión ocupa el primer asiento");

  const botCounts: Record<string, number> = {};
  for (const seat of seats) {
    if (seat.kind === "bot") {
      const difficulty = botDifficulty(seat.difficulty);
      botCounts[difficulty] = (botCounts[difficulty] ?? 0) + 1;
    } else if (seat.kind !== "human") {
      throw new RoomError("Asiento inválido");
    }
  }

  const seenBots: Record<string, number> = {};
  const token = randomToken();
  const room: RoomSnapshot = {
    code: normalizeCode(input.code ?? randomCode()),
    phase: "lobby",
    seed: input.seed ?? Math.floor(Math.random() * 1_000_000),
    state: null,
    seats: seats.map((seat) => {
      if (seat.kind === "bot") {
        const difficulty = botDifficulty(seat.difficulty);
        seenBots[difficulty] = (seenBots[difficulty] ?? 0) + 1;
        return {
          name: botLabel(difficulty, seenBots[difficulty], botCounts[difficulty]),
          token: null,
          isBot: true,
          difficulty,
          connected: true,
        };
      }
      return {
        name: "Esperando",
        token: null,
        isBot: false,
        difficulty: null,
        connected: false,
      };
    }),
  };
  if (!room.code) throw new RoomError("Código de sala inválido");
  room.seats[0].name = cleanName(input.hostName, "Anfitrión");
  room.seats[0].token = token;
  room.seats[0].connected = true;
  maybeStart(room);
  return { room, token, seat: 0 };
}

export function joinRoom(room: RoomSnapshot, name: string): { token: string; seat: number; frames: GameState[] } {
  if (room.phase === "playing") throw new RoomError("La partida ya empezó");
  const seat = room.seats.findIndex((item) => !item.isBot && !item.token);
  if (seat < 0) throw new RoomError("La sala está llena");
  const draft = structuredClone(room);
  const token = randomToken();
  draft.seats[seat].name = cleanName(name, "Jugador");
  draft.seats[seat].token = token;
  draft.seats[seat].connected = true;
  const frames = maybeStart(draft);
  commit(room, draft);
  return { token, seat, frames };
}

export function seatIndex(room: RoomSnapshot, token: string): number {
  const seat = room.seats.findIndex((item) => item.token === token);
  if (seat < 0) throw new RoomError("Token inválido");
  return seat;
}

export function setConnected(room: RoomSnapshot, token: string, connected: boolean): void {
  const seat = seatIndex(room, token);
  room.seats[seat].connected = connected;
}

export function drawFor(room: RoomSnapshot, token: string): GameState[] {
  const draft = structuredClone(room);
  const frames = act(draft, token, (state) => engine.draw(state));
  commit(room, draft);
  return frames;
}

export function playFor(room: RoomSnapshot, token: string, tileIds: number[], melds?: number[][]): GameState[] {
  const draft = structuredClone(room);
  const frames = act(draft, token, (state, seat) => {
    const player = state.players[seat];
    if (!melds?.length && !tileIds.length) throw new RoomError("Elegí al menos una ficha");
    try {
      const config = melds?.length
        ? configurationFromLayout(state.table, player.rack, melds, player.hasInitialMeld)
        : findPlayForSelectedTiles(state.table, player.rack, tileIds, player.hasInitialMeld);
      return engine.play(state, config);
    } catch (error: unknown) {
      throw new RoomError(error instanceof Error ? error.message : "Jugada inválida");
    }
  });
  commit(room, draft);
  return frames;
}

export function nextRoundFor(room: RoomSnapshot, token: string): GameState[] {
  const draft = structuredClone(room);
  seatIndex(draft, token);
  if (!draft.state || draft.phase !== "playing") throw new RoomError("La partida todavía no empezó");
  if (!draft.state.over) throw new RoomError("La ronda sigue en juego");
  if (isMatchOver(draft.state)) throw new RoomError("La partida ya terminó");
  draft.state = engine.nextRound(draft.state);
  const frames = playBots(draft);
  commit(room, draft);
  return frames;
}

export function applyCommand(room: RoomSnapshot, token: string, command: ClientMessage): GameState[] {
  if (command.type === "draw") return drawFor(room, token);
  if (command.type === "nextRound") return nextRoundFor(room, token);
  return playFor(room, token, command.tileIds, command.melds);
}

export function parseClientMessage(raw: string): ClientMessage {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new RoomError("Mensaje inválido");
  }
  if (!data || typeof data !== "object" || !("type" in data)) throw new RoomError("Mensaje inválido");
  const type = (data as { type: unknown }).type;
  const requestId = (data as { requestId?: unknown }).requestId;
  if (typeof requestId !== "string" || !requestId) throw new RoomError("Mensaje inválido");
  if (type === "draw" || type === "nextRound") return { type, requestId };
  if (type === "play") {
    const body = data as { tileIds?: unknown; melds?: unknown };
    if (!Array.isArray(body.tileIds) || body.tileIds.some((id) => typeof id !== "number")) {
      throw new RoomError("Mensaje inválido");
    }
    let melds: number[][] | undefined;
    if (body.melds != null) {
      if (
        !Array.isArray(body.melds) ||
        body.melds.some((group) => !Array.isArray(group) || group.some((id) => typeof id !== "number"))
      ) {
        throw new RoomError("Mensaje inválido");
      }
      melds = body.melds as number[][];
    }
    return { type: "play", requestId, tileIds: body.tileIds as number[], melds };
  }
  throw new RoomError("Mensaje inválido");
}

export function syncFor(
  room: RoomSnapshot,
  token: string,
  frames: GameState[] = [],
): { payload: GamePayload | null; waiting: WaitingInfo | null } {
  const seat = seatIndex(room, token);
  if (room.phase !== "playing" || !room.state) {
    return { payload: null, waiting: waitingFor(room, seat) };
  }
  return { payload: packSeat(room, seat, frames), waiting: null };
}

export function payloadFor(room: RoomSnapshot, token: string, frames: GameState[] = []): GamePayload {
  const sync = syncFor(room, token, frames);
  if (!sync.payload) throw new RoomError("La partida todavía no empezó");
  return sync.payload;
}

export function welcomeFor(room: RoomSnapshot, token: string): ServerMessage {
  const seat = seatIndex(room, token);
  const sync = syncFor(room, token);
  return {
    type: "welcome",
    version: PROTOCOL_VERSION,
    code: room.code,
    seat,
    payload: sync.payload,
    waiting: sync.waiting,
  };
}

export function broadcastFor(room: RoomSnapshot, token: string, frames: GameState[] = []): ServerMessage {
  const sync = syncFor(room, token, frames);
  if (sync.payload) return { type: "state", payload: sync.payload };
  if (!sync.waiting) throw new RoomError("La sala no tiene vista");
  return { type: "waiting", waiting: sync.waiting };
}

function maybeStart(room: RoomSnapshot): GameState[] {
  const waiting = room.seats.some((seat) => !seat.isBot && !seat.token);
  if (waiting) return [];
  const names = room.seats.map((seat) => seat.name);
  const bots = room.seats.map((seat) => (seat.isBot ? seat.difficulty : null));
  room.state = engine.newGame(room.seats.length, room.seed, names, bots);
  room.phase = "playing";
  return playBots(room);
}

function act(
  room: RoomSnapshot,
  token: string,
  apply: (state: GameState, seat: number) => GameState,
): GameState[] {
  const seat = seatIndex(room, token);
  const state = room.state;
  if (room.phase !== "playing" || !state) throw new RoomError("La partida todavía no empezó");
  if (state.over || state.current !== seat) throw new RoomError("No es tu turno");
  room.state = apply(state, seat);
  const frames = [structuredClone(room.state)];
  frames.push(...playBots(room));
  return frames;
}

function playBots(room: RoomSnapshot): GameState[] {
  const frames: GameState[] = [];
  let guard = 0;
  while (
    room.state &&
    !room.state.over &&
    room.state.players[room.state.current].isBot &&
    guard < 12
  ) {
    const state = room.state;
    const player = state.players[state.current];
    const view = engine.view(state, player.id);
    const move = bot.chooseMove(view, player.difficulty || "easy", false);
    room.state = move.action === "DRAW" || !move.config ? engine.draw(state) : engine.play(state, move.config);
    frames.push(structuredClone(room.state));
    guard += 1;
  }
  return frames;
}

function waitingFor(room: RoomSnapshot, seat: number): WaitingInfo {
  return {
    code: room.code,
    yourSeat: seat,
    seats: room.seats.map((item) => ({
      name: item.name,
      isBot: item.isBot,
      filled: item.isBot || Boolean(item.token),
      connected: item.connected,
    })),
  };
}

function conceal(packed: GamePayload, room: RoomSnapshot): GamePayload {
  packed.view.seed = null;
  packed.lastDecision = null;
  packed.connected = room.seats.map((seat) => seat.connected);
  for (const step of packed.steps ?? []) {
    step.view.seed = null;
    step.lastDecision = null;
  }
  return packed;
}

function eventFrom(view: GamePayload["view"], raw: PublicEvent): GameEvent {
  const hist = view.history.filter((item) => item.playerId === raw.playerId && item.type === raw.type);
  const last = hist[hist.length - 1];
  return {
    playerId: raw.playerId,
    playerName: view.names[raw.playerId],
    isBot: view.isBot[raw.playerId],
    type: raw.type,
    tilesFromRack: last?.tilesFromRack ?? [],
    tableHash: raw.tableHash,
    rackSize: raw.rackSize,
    drawn: raw.drawn,
    openSlots: raw.openSlots ?? last?.openSlots,
  };
}

function stepsFor(room: RoomSnapshot, seat: number, frames: GameState[]): GameStep[] {
  return frames.map((state) => {
    const raw = state.history[state.history.length - 1];
    const packed = conceal(payload(room.code, engine.view(state, seat), null, yourTurn(state, seat), false), room);
    return {
      event: raw ? eventFrom(packed.view, raw) : null,
      view: packed.view,
      yourTurn: packed.yourTurn,
      lastDecision: null,
    };
  });
}

function yourTurn(state: GameState, seat: number): boolean {
  return !state.over && state.current === seat && !state.players[seat].isBot;
}

function packSeat(room: RoomSnapshot, seat: number, frames: GameState[]): GamePayload {
  const state = room.state;
  if (!state) throw new RoomError("La partida todavía no empezó");
  const packed = payload(room.code, engine.view(state, seat), null, yourTurn(state, seat), false, stepsFor(room, seat, frames));
  return conceal(packed, room);
}
