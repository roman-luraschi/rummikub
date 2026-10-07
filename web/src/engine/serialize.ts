import type { BotDecision, PlayerView, PublicEvent } from "./bot";
import { GROUP } from "./meld";
import { tableHash, tableStr, type Table } from "./table";
import { COLOR_UI, isJoker, tileColor, tileRank, tileStr, type Tile } from "./tile";
import type { GamePayload, GameStep, GameView, MeldData, TileData } from "../types";

export function tileToData(t: Tile): TileData {
  if (isJoker(t)) {
    return { id: t.id, isJoker: true, label: "J", color: "joker", rank: null };
  }
  return {
    id: t.id,
    isJoker: false,
    label: tileStr(t).replace(/J\d/, "J"),
    color: COLOR_UI[tileColor(t)],
    rank: tileRank(t),
  };
}

export function meldToData(meld: { kind: number; tiles: Tile[]; bindings: { jokerId: number; color: number; rank: number }[] }): MeldData {
  return {
    kind: meld.kind === GROUP ? "group" : "run",
    tiles: meld.tiles.map(tileToData),
    bindings: meld.bindings.map((b) => ({
      jokerId: b.jokerId,
      color: COLOR_UI[b.color],
      rank: b.rank,
    })),
    label: meld.tiles.map(tileStr).join(" "),
  };
}

export function tableToData(table: Table): GameView["table"] {
  return {
    melds: table.melds.map(meldToData),
    hash: tableHash(table),
    label: tableStr(table),
  };
}

function eventToData(event: PublicEvent, names: string[], isBot: boolean[]) {
  return {
    playerId: event.playerId,
    playerName: names[event.playerId] ?? `P${event.playerId}`,
    isBot: isBot[event.playerId] ?? false,
    type: event.type,
    tilesFromRack: event.tilesFromRack.map(tileToData),
    tableHash: event.tableHash,
    rackSize: event.rackSize,
    drawn: event.drawn,
    openSlots: event.openSlots,
  };
}

function rackSort(t: Tile): [number, number, number] {
  if (isJoker(t)) return [99, 0, t.id];
  return [tileColor(t), tileRank(t), t.id];
}

export function viewToData(view: PlayerView): GameView {
  const rack = [...view.rack].sort((a, b) => {
    const aa = rackSort(a);
    const bb = rackSort(b);
    return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
  });
  return {
    playerId: view.playerId,
    rack: rack.map(tileToData),
    table: tableToData(view.table),
    rackSizes: view.rackSizes,
    poolSize: view.poolSize,
    current: view.current,
    hasInitialMeld: view.hasInitialMeld,
    scores: view.scores,
    names: view.names,
    isBot: view.isBot,
    difficulties: view.difficulties,
    over: view.over,
    winner: view.winner,
    seed: view.seedPublic,
    round: view.round,
    roundPoints: view.roundPoints,
    rackValues: view.rackValues,
    matchOver: view.matchOver,
    history: view.history.slice(-24).map((e) => eventToData(e, view.names, view.isBot)),
  };
}

export function decisionToData(decision: BotDecision) {
  return {
    action: decision.action,
    score: Math.round(decision.score * 1000) / 1000,
    reasons: Object.fromEntries(Object.entries(decision.reasons).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
    initialHand: decision.initialHand,
    initialTable: decision.initialTable,
    finalTable: decision.finalTable,
    played: decision.discarded,
    searchDepth: decision.searchDepth,
    statesEvaluated: decision.statesEvaluated,
    cacheHits: decision.cacheHits,
    simulations: decision.simulationCount,
    timeMs: Math.round(decision.timeMs * 100) / 100,
    difficulty: decision.difficulty,
    topCandidates: decision.topCandidates.map((c) => ({
      action: c.action,
      score: Math.round(c.score * 1000) / 1000,
      rackUsed: c.rackUsed,
      tilesPlayed: c.tilesPlayed,
    })),
    log: decision.log,
  };
}

export function payload(
  id: string,
  view: PlayerView,
  lastDecision: BotDecision | null,
  yourTurn: boolean,
  spectator: boolean,
  steps: GameStep[] = [],
): GamePayload {
  return {
    id,
    view: viewToData(view),
    lastDecision: lastDecision ? decisionToData(lastDecision) : null,
    yourTurn,
    spectator,
    steps,
  };
}
