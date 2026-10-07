import type { TableConfiguration } from "./partition";
import { pointValue } from "./meld";
import { tableHash, tableTileIds, type Table } from "./table";
import { buildDeck, isJoker, rackValue, type Tile } from "./tile";
import { validateEntireTable, TableValidationError } from "./validator";
import { SeededRng, openSlots, type PlayerView, type PublicEvent } from "./bot";

export const RACK_SIZE = 14;
export const INITIAL_MELD_POINTS = 30;
export const MATCH_TARGET = 500;

export class IllegalMove extends Error {}

export interface Player {
  id: number;
  name: string;
  rack: Tile[];
  hasInitialMeld: boolean;
  isBot: boolean;
  difficulty: string | null;
}

export interface GameState {
  players: Player[];
  pool: Tile[];
  table: Table;
  current: number;
  scores: number[];
  seed: number | null;
  history: PublicEvent[];
  winner: number | null;
  over: boolean;
  emptyPasses: number;
  round: number;
  roundPoints: number[];
  firstPlayer: number;
}

export function isMatchOver(state: GameState): boolean {
  return state.over && state.scores.some((score) => score >= MATCH_TARGET);
}

function rackPoints(rack: Tile[]): number {
  return rack.reduce((sum, tile) => sum + rackValue(tile), 0);
}

function clonePlayer(p: Player): Player {
  return { ...p, rack: [...p.rack] };
}

export function cloneState(state: GameState): GameState {
  return {
    players: state.players.map(clonePlayer),
    pool: [...state.pool],
    table: { melds: state.table.melds.map((m) => ({ ...m, tiles: [...m.tiles], bindings: [...m.bindings] })) },
    current: state.current,
    scores: [...state.scores],
    seed: state.seed,
    history: [...state.history],
    winner: state.winner,
    over: state.over,
    emptyPasses: state.emptyPasses,
    round: state.round,
    roundPoints: [...state.roundPoints],
    firstPlayer: state.firstPlayer,
  };
}

function cryptoBelow(limit: number): number {
  const range = 0x100000000;
  const max = range - (range % limit);
  const buf = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= max);
  return value % limit;
}

function cryptoShuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = cryptoBelow(i + 1);
    const current = copy[i];
    copy[i] = copy[j];
    copy[j] = current;
  }
  return copy;
}

export class GameEngine {
  newGame(
    nPlayers = 2,
    seed: number | null = 1,
    names?: string[],
    bots?: (string | null)[],
  ): GameState {
    if (nPlayers < 2 || nPlayers > 4) throw new Error("Rummikub supports 2-4 players");
    const deck = seed == null ? cryptoShuffle(buildDeck()) : new SeededRng(seed).shuffle(buildDeck());
    const players: Player[] = [];
    for (let i = 0; i < nPlayers; i++) {
      const rack = deck.splice(deck.length - RACK_SIZE, RACK_SIZE);
      const difficulty = bots?.[i] ?? null;
      players.push({
        id: i,
        name: names?.[i] ?? `P${i}`,
        rack,
        hasInitialMeld: false,
        isBot: difficulty != null,
        difficulty,
      });
    }
    return {
      players,
      pool: deck,
      table: { melds: [] },
      current: 0,
      scores: Array.from({ length: nPlayers }, () => 0),
      seed,
      history: [],
      winner: null,
      over: false,
      emptyPasses: 0,
      round: 1,
      roundPoints: Array.from({ length: nPlayers }, () => 0),
      firstPlayer: 0,
    };
  }

  view(state: GameState, playerId: number): PlayerView {
    const player = state.players[playerId];
    return {
      playerId,
      rack: [...player.rack],
      table: state.table,
      rackSizes: state.players.map((p) => p.rack.length),
      poolSize: state.pool.length,
      current: state.current,
      hasInitialMeld: state.players.map((p) => p.hasInitialMeld),
      scores: [...state.scores],
      history: state.history,
      names: state.players.map((p) => p.name),
      isBot: state.players.map((p) => p.isBot),
      difficulties: state.players.map((p) => p.difficulty),
      over: state.over,
      winner: state.winner,
      seedPublic: state.seed,
      round: state.round,
      roundPoints: [...state.roundPoints],
      rackValues: state.over ? state.players.map((p) => rackPoints(p.rack)) : state.players.map(() => 0),
      matchOver: isMatchOver(state),
    };
  }

  nextRound(state: GameState): GameState {
    if (!state.over) throw new IllegalMove("The round is still going");
    if (isMatchOver(state)) throw new IllegalMove("The match is already over");
    const names = state.players.map((p) => p.name);
    const bots = state.players.map((p) => p.difficulty);
    const starter = (state.firstPlayer + 1) % state.players.length;
    const nextSeed = state.seed == null ? null : state.seed + state.round;
    const fresh = this.newGame(state.players.length, nextSeed, names, bots);
    fresh.scores = [...state.scores];
    fresh.round = state.round + 1;
    fresh.current = starter;
    fresh.firstPlayer = starter;
    return fresh;
  }

  draw(state: GameState): GameState {
    this.ensureActive(state);
    const nxt = cloneState(state);
    const player = nxt.players[nxt.current];
    let drawn = false;
    if (nxt.pool.length) {
      player.rack.push(nxt.pool.pop()!);
      drawn = true;
      nxt.emptyPasses = 0;
    } else {
      nxt.emptyPasses += 1;
    }
    nxt.history.push({
      playerId: player.id,
      type: "draw",
      tilesFromRack: [],
      tableHash: tableHash(nxt.table),
      rackSize: player.rack.length,
      drawn,
      openSlots: openSlots(nxt.table),
    });
    if (!drawn && nxt.emptyPasses >= nxt.players.length) {
      this.finishStalemate(nxt);
      return nxt;
    }
    this.advance(nxt);
    return nxt;
  }

  play(state: GameState, config: TableConfiguration): GameState {
    this.ensureActive(state);
    const nxt = cloneState(state);
    const player = nxt.players[nxt.current];
    this.validatePlay(nxt, player, config);
    const usedIds = new Set(config.rackUsed.map((t) => t.id));
    player.rack = player.rack.filter((t) => !usedIds.has(t.id));
    nxt.table = config.table;
    nxt.emptyPasses = 0;
    let eventType: PublicEvent["type"] = "play";
    if (!player.hasInitialMeld) {
      eventType = "initial";
      player.hasInitialMeld = true;
    }
    nxt.history.push({
      playerId: player.id,
      type: eventType,
      tilesFromRack: [...config.rackUsed],
      tableHash: tableHash(config.table),
      rackSize: player.rack.length,
      drawn: false,
    });
    if (!player.rack.length) {
      this.finishRound(nxt, player.id);
      return nxt;
    }
    this.advance(nxt);
    return nxt;
  }

  private validatePlay(state: GameState, player: Player, config: TableConfiguration): void {
    try {
      validateEntireTable(config.table);
    } catch (err) {
      throw new IllegalMove(err instanceof TableValidationError ? err.message : String(err));
    }
    if (!config.rackUsed.length) throw new IllegalMove("A play must use at least one rack tile");
    const rackIds = new Set(player.rack.map((t) => t.id));
    const usedIds = config.rackUsed.map((t) => t.id);
    if (new Set(usedIds).size !== usedIds.length) throw new IllegalMove("Duplicate tile in rack_used");
    if (usedIds.some((id) => !rackIds.has(id))) throw new IllegalMove("Play uses tiles that are not in the rack");
    const oldIds = tableTileIds(state.table);
    const newIds = tableTileIds(config.table);
    for (const id of oldIds) {
      if (!newIds.has(id)) throw new IllegalMove("Table tiles cannot return to the rack");
    }
    const extra = [...newIds].filter((id) => !oldIds.has(id));
    if (extra.length !== usedIds.length || extra.some((id) => !usedIds.includes(id))) {
      throw new IllegalMove("New table tiles must be exactly the tiles played from the rack");
    }
    if (!player.hasInitialMeld) {
      if (oldIds.size) {
        const oldKeys = JSON.stringify(state.table.melds.map((m) => m.tiles.map((t) => t.id)));
        const newKeys = JSON.stringify(config.table.melds.slice(0, state.table.melds.length).map((m) => m.tiles.map((t) => t.id)));
        if (oldKeys !== newKeys) throw new IllegalMove("Initial meld cannot manipulate the table");
      }
      const newMelds = config.table.melds.slice(state.table.melds.length);
      const points = newMelds.reduce((s, m) => s + pointValue(m), 0);
      if (points < INITIAL_MELD_POINTS) {
        throw new IllegalMove(`Initial meld must total at least ${INITIAL_MELD_POINTS} (got ${points})`);
      }
      for (const meld of newMelds) {
        if (meld.tiles.some(isJoker)) {
          throw new IllegalMove("La apertura de 30 puntos no puede usar comodines");
        }
        if (meld.tiles.some((t) => oldIds.has(t.id))) {
          throw new IllegalMove("Initial meld must use only rack tiles");
        }
      }
    }
  }

  private finishRound(state: GameState, winnerId: number): void {
    state.over = true;
    state.winner = winnerId;
    state.roundPoints = state.players.map(() => 0);
    let award = 0;
    for (const player of state.players) {
      if (player.id === winnerId) continue;
      award += rackPoints(player.rack);
    }
    state.roundPoints[winnerId] = award;
    state.scores[winnerId] += award;
    state.history.push({
      playerId: winnerId,
      type: "win",
      tilesFromRack: [],
      tableHash: tableHash(state.table),
      rackSize: 0,
      drawn: false,
    });
  }

  private finishStalemate(state: GameState): void {
    const deadwood = state.players.map((p) => rackPoints(p.rack));
    const best = Math.min(...deadwood);
    const winners = deadwood.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    state.over = true;
    state.roundPoints = state.players.map(() => 0);
    if (winners.length !== 1) {
      state.winner = null;
      return;
    }
    const winnerId = winners[0];
    state.winner = winnerId;
    let others = 0;
    for (const player of state.players) {
      if (player.id === winnerId) continue;
      others += rackPoints(player.rack);
    }
    const award = Math.max(0, others - deadwood[winnerId]);
    state.roundPoints[winnerId] = award;
    state.scores[winnerId] += award;
    state.history.push({
      playerId: winnerId,
      type: "win",
      tilesFromRack: [],
      tableHash: tableHash(state.table),
      rackSize: state.players[winnerId].rack.length,
      drawn: false,
    });
  }

  private ensureActive(state: GameState): void {
    if (state.over) throw new IllegalMove("The round is already over");
  }

  private advance(state: GameState): void {
    state.current = (state.current + 1) % state.players.length;
  }
}
