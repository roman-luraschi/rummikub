import { RummyBot, type BotDecision, type BotMove, type PlayerView } from "./bot";
import { GameEngine, IllegalMove, type GameState } from "./game";
import { payload, tableToData, viewToData } from "./serialize";
import { configurationFromLayout, findPlayForSelectedTiles } from "./solver";
import type { GameEvent, GamePayload, GameStep } from "../types";

export interface GameSession {
  state: GameState;
  humanId: number;
  debug: boolean;
  lastDecision: BotDecision | null;
  spectator: boolean;
}

const GAMES = new Map<string, GameSession>();
const engine = new GameEngine();
const fallbackBot = new RummyBot();

type Chooser = (view: PlayerView, difficulty: string, debug: boolean) => Promise<BotMove>;
let chooseMove: Chooser = async (view, difficulty, debug) =>
  fallbackBot.chooseMove(view, difficulty, debug);

export function setMoveChooser(fn: Chooser): void {
  chooseMove = fn;
}

function sessionOf(id: string): GameSession {
  const s = GAMES.get(id);
  if (!s) throw new Error("Game not found");
  return s;
}

function viewerId(session: GameSession, acting?: number): number {
  if (!session.spectator) return session.humanId;
  if (acting != null) return acting;
  if (session.state.over) return session.state.winner ?? 0;
  return session.state.current;
}

function isYourTurn(session: GameSession): boolean {
  return !session.spectator && !session.state.over && session.state.current === session.humanId;
}

function eventFromView(view: ReturnType<typeof viewToData>, raw: GameSession["state"]["history"][number]): GameEvent {
  const hist = view.history.filter((h) => h.playerId === raw.playerId && h.type === raw.type);
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
  };
}

function stepFromLast(id: string, session: GameSession, acting?: number): GameStep {
  const raw = session.state.history[session.state.history.length - 1];
  const viewModel = engine.view(session.state, viewerId(session, acting));
  const packed = payload(id, viewModel, session.lastDecision, isYourTurn(session), session.spectator);
  return {
    event: raw ? eventFromView(packed.view, raw) : null,
    view: packed.view,
    yourTurn: packed.yourTurn,
    lastDecision: packed.lastDecision,
  };
}

function pack(id: string, session: GameSession, steps: GameStep[] = []): GamePayload {
  const view = engine.view(session.state, viewerId(session));
  return payload(id, view, session.lastDecision, isYourTurn(session), session.spectator, steps);
}

function botNames(diffs: string[]): string[] {
  const counts: Record<string, number> = {};
  for (const d of diffs) counts[d] = (counts[d] ?? 0) + 1;
  const seen: Record<string, number> = {};
  return diffs.map((diff) => {
    seen[diff] = (seen[diff] ?? 0) + 1;
    const label = diff.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return counts[diff] > 1 ? `${label} ${seen[diff]}` : label;
  });
}

function startPlayers(req: {
  spectator?: boolean;
  difficulties?: string[];
  botCount?: number;
  difficulty: string;
  opponents?: number;
  name?: string;
}): { n: number; names: string[]; bots: (string | null)[] } {
  if (req.spectator) {
    let diffs = req.difficulties?.length ? [...req.difficulties] : [];
    const n = Math.max(2, Math.min(4, Math.max(diffs.length, req.botCount ?? 2)));
    while (diffs.length < n) diffs.push(diffs.at(-1) ?? req.difficulty);
    diffs = diffs.slice(0, n);
    return { n, names: botNames(diffs), bots: diffs };
  }
  const opponents = Math.max(1, Math.min(3, req.opponents ?? 1));
  const names = [req.name ?? "You", ...Array.from({ length: opponents }, (_, i) => `Bot ${i + 1}`)];
  const bots: (string | null)[] = [null, ...Array.from({ length: opponents }, () => req.difficulty)];
  return { n: opponents + 1, names, bots };
}

async function playOneBot(id: string, session: GameSession): Promise<GameStep> {
  const state = session.state;
  const player = state.players[state.current];
  if (state.over || !player.isBot) throw new IllegalMove("It is not a bot turn");
  const view: PlayerView = engine.view(state, player.id);
  const move = await chooseMove(view, player.difficulty || "hard", session.debug);
  session.lastDecision = move.decision;
  if (move.action === "DRAW" || !move.config) session.state = engine.draw(state);
  else session.state = engine.play(state, move.config);
  return stepFromLast(id, session, session.spectator ? player.id : undefined);
}

async function playBots(id: string, session: GameSession): Promise<GameStep[]> {
  if (session.spectator) return [];
  const steps: GameStep[] = [];
  let guard = 0;
  while (!session.state.over && session.state.players[session.state.current].isBot && guard < 12) {
    steps.push(await playOneBot(id, session));
    guard += 1;
  }
  return steps;
}

function findHumanPlay(session: GameSession, tileIds: number[]) {
  const player = session.state.players[session.humanId];
  try {
    return findPlayForSelectedTiles(session.state.table, player.rack, tileIds, player.hasInitialMeld);
  } catch (err) {
    throw new IllegalMove(err instanceof Error ? err.message : String(err));
  }
}

export async function createGame(req: {
  seed?: number;
  difficulty: string;
  opponents: number;
  debug: boolean;
  spectator?: boolean;
  botCount?: number;
  difficulties?: string[];
  name?: string;
}): Promise<GamePayload> {
  const { n, names, bots } = startPlayers(req);
  const seed = req.seed ?? Math.floor(Math.random() * 1_000_000);
  const state = engine.newGame(n, seed, names, bots);
  const id = Math.random().toString(16).slice(2, 12);
  const session: GameSession = {
    state,
    humanId: 0,
    debug: req.debug,
    lastDecision: null,
    spectator: Boolean(req.spectator),
  };
  GAMES.set(id, session);
  const steps = await playBots(id, session);
  return pack(id, session, steps);
}

export async function drawTile(id: string): Promise<GamePayload> {
  const session = sessionOf(id);
  if (session.state.over || session.state.current !== session.humanId) {
    throw new Error("It is not your turn");
  }
  session.state = engine.draw(session.state);
  const steps = [stepFromLast(id, session), ...(await playBots(id, session))];
  return pack(id, session, steps);
}

export async function previewPlay(id: string, tileIds: number[]) {
  const session = sessionOf(id);
  if (session.state.over || session.state.current !== session.humanId) {
    throw new Error("It is not your turn");
  }
  if (!tileIds.length) throw new Error("Select at least one tile");
  const config = findHumanPlay(session, tileIds);
  return { table: tableToData(config.table), tileIds: config.rackUsed.map((t) => t.id) };
}

export async function playTiles(id: string, tileIds: number[], melds?: number[][]): Promise<GamePayload> {
  const session = sessionOf(id);
  if (session.state.over || session.state.current !== session.humanId) {
    throw new Error("It is not your turn");
  }
  if (!melds?.length && !tileIds.length) throw new Error("Select at least one tile");
  try {
    const player = session.state.players[session.humanId];
    const config = melds?.length
      ? configurationFromLayout(session.state.table, player.rack, melds, player.hasInitialMeld)
      : findHumanPlay(session, tileIds);
    session.state = engine.play(session.state, config);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }
  const steps = [stepFromLast(id, session), ...(await playBots(id, session))];
  return pack(id, session, steps);
}

export async function tickGame(id: string): Promise<GamePayload> {
  const session = sessionOf(id);
  if (session.state.over) throw new Error("The round is over");
  const player = session.state.players[session.state.current];
  if (!player.isBot) throw new Error("It is not a bot turn");
  const step = await playOneBot(id, session);
  return pack(id, session, [step]);
}
