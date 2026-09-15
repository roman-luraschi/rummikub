import { RUN, pointValue, represented } from "./meld";
import { remainingDeadwood, tilesPlayed, type SolverMode, type TableConfiguration } from "./partition";
import { nextRank, prevRank, runDisplayOrder } from "./runs";
import { tableStr, type Table } from "./table";
import {
  isJoker,
  rackValue,
  tileColor,
  tileRank,
  tileStr,
  TOTAL_TILES,
  type Tile,
} from "./tile";
import { TableSolver } from "./solver";

export type Difficulty = "easy" | "normal" | "hard" | "very_hard" | "extreme";

export interface DifficultyConfig {
  searchDepth: number;
  timeLimitMs: number;
  simulationCount: number;
  randomness: number;
  opponentModelAccuracy: number;
  useMonteCarlo: boolean;
  useOpponentModel: boolean;
  solverMode: SolverMode;
  beamK: number;
  lookaheadTop: number;
}

export const CONFIGS: Record<Difficulty, DifficultyConfig> = {
  easy: {
    searchDepth: 0,
    timeLimitMs: 50,
    simulationCount: 0,
    randomness: 0.55,
    opponentModelAccuracy: 0,
    useMonteCarlo: false,
    useOpponentModel: false,
    solverMode: "add_only",
    beamK: 8,
    lookaheadTop: 0,
  },
  normal: {
    searchDepth: 1,
    timeLimitMs: 100,
    simulationCount: 0,
    randomness: 0.28,
    opponentModelAccuracy: 0.25,
    useMonteCarlo: false,
    useOpponentModel: false,
    solverMode: "local",
    beamK: 12,
    lookaheadTop: 0,
  },
  hard: {
    searchDepth: 1,
    timeLimitMs: 200,
    simulationCount: 8,
    randomness: 0.12,
    opponentModelAccuracy: 0.55,
    useMonteCarlo: false,
    useOpponentModel: true,
    solverMode: "full",
    beamK: 20,
    lookaheadTop: 0,
  },
  very_hard: {
    searchDepth: 2,
    timeLimitMs: 500,
    simulationCount: 24,
    randomness: 0.06,
    opponentModelAccuracy: 0.8,
    useMonteCarlo: true,
    useOpponentModel: true,
    solverMode: "full",
    beamK: 36,
    lookaheadTop: 4,
  },
  extreme: {
    searchDepth: 3,
    timeLimitMs: 1000,
    simulationCount: 48,
    randomness: 0.02,
    opponentModelAccuracy: 1,
    useMonteCarlo: true,
    useOpponentModel: true,
    solverMode: "full",
    beamK: 64,
    lookaheadTop: 6,
  },
};

export function parseDifficulty(value: string): Difficulty {
  const key = value.trim().toLowerCase().replace("-", "_") as Difficulty;
  if (!(key in CONFIGS)) throw new Error(`Unknown difficulty: ${value}`);
  return key;
}

export interface OpenSlot {
  color: number;
  rank: number;
}

export interface PublicEvent {
  playerId: number;
  type: "draw" | "play" | "initial" | "win";
  tilesFromRack: Tile[];
  tableHash: string;
  rackSize: number;
  drawn: boolean;
  openSlots?: OpenSlot[];
}

export function slotKey(color: number, rank: number): string {
  return `${color},${rank}`;
}

export function openSlots(table: Table): OpenSlot[] {
  const slots: OpenSlot[] = [];
  const seen = new Set<string>();
  const push = (color: number, rank: number) => {
    const key = slotKey(color, rank);
    if (seen.has(key)) return;
    seen.add(key);
    slots.push({ color, rank });
  };
  for (const meld of table.melds) {
    const reps = represented(meld);
    if (meld.kind === RUN) {
      const color = reps[0][0];
      const order = runDisplayOrder(reps.map((s) => s[1]));
      const occupied = new Set(order);
      const low = prevRank(order[0]);
      const high = nextRank(order[order.length - 1]);
      if (!occupied.has(low)) push(color, low);
      if (!occupied.has(high)) push(color, high);
    } else if (reps.length === 3) {
      const used = new Set(reps.map((s) => s[0]));
      const rank = reps[0][1];
      for (let color = 0; color < 4; color++) {
        if (!used.has(color)) push(color, rank);
      }
    }
  }
  return slots;
}

export function addedOpenSlots(before: Table, after: Table): OpenSlot[] {
  const old = new Set(openSlots(before).map((s) => slotKey(s.color, s.rank)));
  return openSlots(after).filter((s) => !old.has(slotKey(s.color, s.rank)));
}

export interface PlayerView {
  playerId: number;
  rack: Tile[];
  table: Table;
  rackSizes: number[];
  poolSize: number;
  current: number;
  hasInitialMeld: boolean[];
  scores: number[];
  history: PublicEvent[];
  names: string[];
  isBot: boolean[];
  difficulties: (string | null)[];
  over: boolean;
  winner: number | null;
  seedPublic: number | null;
}

export interface ScoreBreakdown {
  total: number;
  terms: Record<string, number>;
}

function addTerm(bd: ScoreBreakdown, name: string, value: number): void {
  bd.terms[name] = value;
  bd.total += value;
}

export class OpponentModel {
  knownIds = new Set<number>();
  unknown: Tile[] = [];
  rackSizes: number[] = [];
  poolSize = 0;
  playerId = 0;
  hotSlots = new Map<string, number>();
  accuracy = 1;

  static fromView(view: PlayerView, accuracy = 1): OpponentModel {
    const known = new Set(view.rack.map((t) => t.id));
    for (const meld of view.table.melds) for (const t of meld.tiles) known.add(t.id);
    const unknown: Tile[] = [];
    for (let i = 0; i < TOTAL_TILES; i++) if (!known.has(i)) unknown.push({ id: i });
    const model = new OpponentModel();
    model.knownIds = known;
    model.unknown = unknown;
    model.rackSizes = view.rackSizes;
    model.poolSize = view.poolSize;
    model.playerId = view.playerId;
    model.accuracy = accuracy;
    for (const meld of view.table.melds) {
      const slots = represented(meld);
      if (meld.kind === RUN) {
        const color = slots[0][0];
        const low = Math.min(...slots.map((s) => s[1]));
        const high = Math.max(...slots.map((s) => s[1]));
        if (low > 1) model.addHeat(color, low - 1, 1.2);
        if (high < 13) model.addHeat(color, high + 1, 1.2);
      } else {
        const used = new Set(slots.map((s) => s[0]));
        const rank = slots[0][1];
        for (let color = 0; color < 4; color++) {
          if (!used.has(color)) model.addHeat(color, rank, 0.9);
        }
      }
    }
    for (const event of view.history) {
      if ((event.type === "play" || event.type === "initial") && event.playerId !== view.playerId) {
        for (const t of event.tilesFromRack) {
          if (isJoker(t)) continue;
          const color = tileColor(t);
          const rank = tileRank(t);
          for (const delta of [-2, -1, 1, 2]) {
            const nxt = rank + delta;
            if (nxt >= 1 && nxt <= 13) model.addHeat(color, nxt, 0.45 * accuracy);
          }
          for (let other = 0; other < 4; other++) {
            if (other !== color) model.addHeat(other, rank, 0.25 * accuracy);
          }
        }
      }
      if (event.type === "draw" && event.playerId !== view.playerId) {
        const refused = event.openSlots ?? [];
        for (const slot of refused) model.addHeat(slot.color, slot.rank, -2.5 * accuracy);
      }
    }
    return model;
  }

  addHeat(color: number, rank: number, v: number): void {
    const k = slotKey(color, rank);
    this.hotSlots.set(k, (this.hotSlots.get(k) ?? 0) + v);
  }

  heatSlot(color: number, rank: number): number {
    return this.hotSlots.get(slotKey(color, rank)) ?? 0;
  }

  heat(t: Tile): number {
    if (isJoker(t)) return 1.4;
    return this.heatSlot(tileColor(t), tileRank(t));
  }

  sampleHidden(count: number, rng: () => number): Tile[] {
    if (count <= 0) return [];
    if (count >= this.unknown.length) return [...this.unknown];
    const pool = this.unknown.map((t) => ({
      t,
      w: Math.max(0.05, 0.2 + (0.35 + this.heat(t)) * this.accuracy),
    }));
    const picked: Tile[] = [];
    for (let n = 0; n < count; n++) {
      const sum = pool.reduce((s, x) => s + x.w, 0);
      let r = rng() * sum;
      let idx = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        r -= pool[i].w;
        if (r <= 0) {
          idx = i;
          break;
        }
      }
      picked.push(pool[idx].t);
      pool.splice(idx, 1);
    }
    return picked;
  }
}

export class StateEvaluator {
  evaluateView(view: PlayerView, belief: OpponentModel | null = null): ScoreBreakdown {
    return this.scoreRack(view, view.rack, view.table, belief, false, []);
  }

  evaluatePlay(view: PlayerView, config: TableConfiguration, belief: OpponentModel | null = null): ScoreBreakdown {
    return this.scoreRack(view, config.rackLeft, config.table, belief, config.rackLeft.length === 0, config.rackUsed);
  }

  evaluateDraw(view: PlayerView, belief: OpponentModel | null): ScoreBreakdown {
    const breakdown = this.scoreRack(view, view.rack, view.table, belief, false, []);
    addTerm(breakdown, "draw_tempo", -18);
    if (view.poolSize === 0) addTerm(breakdown, "empty_pool", -80);
    const minOpp = Math.min(...view.rackSizes.filter((_, i) => i !== view.playerId));
    if (minOpp <= 3) addTerm(breakdown, "draw_while_opponent_close", -22);
    return breakdown;
  }

  private scoreRack(
    view: PlayerView,
    rack: Tile[],
    table: Table,
    belief: OpponentModel | null,
    justWentOut: boolean,
    played: Tile[],
  ): ScoreBreakdown {
    const score: ScoreBreakdown = { total: 0, terms: {} };
    if (justWentOut) {
      addTerm(score, "rummikub", 10000);
      return score;
    }
    const n = rack.length;
    const deadwood = rack.reduce((s, t) => s + rackValue(t), 0);
    addTerm(score, "tiles_remaining", -12 * n);
    addTerm(score, "deadwood", -0.55 * deadwood);
    if (played.length) addTerm(score, "tiles_played", 14 * played.length);
    const [flex, isolated, jokers] = rackShape(rack);
    addTerm(score, "flexibility", 0.55 * flex);
    addTerm(score, "isolated", -2.8 * isolated);
    addTerm(score, "joker_reserve", 28 * jokers);
    const tableFlex = tableFlexibility(table);
    addTerm(score, "table_flexibility", 0.9 * tableFlex);
    addTerm(score, "future_move_potential", 0.4 * (flex + tableFlex * 0.15 + jokers * 2));
    const minOpp = Math.min(...view.rackSizes.filter((_, i) => i !== view.playerId));
    addTerm(score, "race", -3.5 * Math.max(0, n - minOpp));
    const raceCritical = minOpp <= 2;
    if (belief && played.length) {
      const added = addedOpenSlots(view.table, table);
      const heat = added.reduce((s, slot) => s + Math.max(0, belief.heatSlot(slot.color, slot.rank)), 0);
      const base = added.length * (minOpp <= 6 ? -17 : -4);
      addTerm(score, "opponent_blocking", base + (minOpp <= 6 ? -6.5 : -1.8) * heat);
    }
    if (played.length && !raceCritical) {
      const connectors = selfConnectors(played, rack);
      if (connectors) addTerm(score, "self_connectors", -22 * connectors);
    }
    if (played.some(isJoker) && n > 3 && !raceCritical) {
      addTerm(score, "joker_spend", -24);
    }
    if (played.length && !view.hasInitialMeld[view.playerId]) {
      scoreOpening(score, view, table, played, minOpp);
    }
    return score;
  }
}

function rackShape(rack: Tile[]): [number, number, number] {
  const numbered = rack.filter((t) => !isJoker(t));
  const jokers = rack.length - numbered.length;
  const byColor = new Map<number, Set<number>>();
  const byRank = new Map<number, Set<number>>();
  for (const t of numbered) {
    const c = tileColor(t);
    const r = tileRank(t);
    if (!byColor.has(c)) byColor.set(c, new Set());
    byColor.get(c)!.add(r);
    if (!byRank.has(r)) byRank.set(r, new Set());
    byRank.get(r)!.add(c);
  }
  let flexible = 0;
  let isolated = 0;
  for (const t of numbered) {
    const color = tileColor(t);
    const rank = tileRank(t);
    const runLinks = [-2, -1, 1, 2].filter((d) => byColor.get(color)?.has(rank + d)).length;
    const groupLinks = (byRank.get(rank)?.size ?? 1) - 1;
    if (runLinks || groupLinks) flexible += 1 + runLinks + groupLinks;
    else isolated += 1;
  }
  return [flexible, isolated, jokers];
}

function leftoverIndex(rack: Tile[]) {
  const byColor = new Map<number, Set<number>>();
  const byRank = new Map<number, Set<number>>();
  for (const t of rack) {
    if (isJoker(t)) continue;
    const c = tileColor(t);
    const r = tileRank(t);
    if (!byColor.has(c)) byColor.set(c, new Set());
    byColor.get(c)!.add(r);
    if (!byRank.has(r)) byRank.set(r, new Set());
    byRank.get(r)!.add(c);
  }
  return { byColor, byRank };
}

function selfConnectors(played: Tile[], leftover: Tile[]): number {
  const { byColor, byRank } = leftoverIndex(leftover);
  let n = 0;
  for (const t of played) {
    if (isJoker(t)) continue;
    const color = tileColor(t);
    const rank = tileRank(t);
    const colors = byColor.get(color);
    if (colors?.has(prevRank(rank)) && colors.has(nextRank(rank))) n += 1;
    const groupColors = byRank.get(rank)?.size ?? 0;
    if (groupColors >= 2) n += 1;
  }
  return n;
}

function openingPoints(table: Table, played: Tile[]): number {
  const used = new Set(played.map((t) => t.id));
  return table.melds
    .filter((meld) => meld.tiles.some((t) => used.has(t.id)))
    .reduce((s, meld) => s + pointValue(meld), 0);
}

function scoreOpening(
  score: ScoreBreakdown,
  view: PlayerView,
  table: Table,
  played: Tile[],
  minOpp: number,
): void {
  const points = openingPoints(table, played);
  addTerm(score, "opening_quality", 2.2 * Math.max(0, points - 30) + 1.5 * Math.max(0, played.length - 3));
  const weak = points <= 33;
  const canWait = minOpp >= 8 && view.poolSize > 10;
  if (minOpp <= 4 || view.poolSize <= 8) {
    addTerm(score, "force_open", 18);
  } else if (weak && canWait) {
    addTerm(score, "wait_to_open", -120);
  }
}

function tableFlexibility(table: Table): number {
  let value = 0;
  for (const meld of table.melds) {
    const slots = represented(meld);
    if (meld.kind === RUN) {
      value += 2;
      if (slots.length >= 5) value += 1;
    } else if (slots.length === 3) value += 2;
  }
  return value;
}

export interface BotDecision {
  action: string;
  score: number;
  reasons: Record<string, number>;
  initialHand: string;
  initialTable: string;
  finalTable: string;
  discarded: string;
  searchDepth: number;
  statesEvaluated: number;
  cacheHits: number;
  simulationCount: number;
  timeMs: number;
  difficulty: string;
  topCandidates: { action: string; score: number; rackUsed: string; tilesPlayed: number }[];
  log: string;
}

export interface BotMove {
  action: string;
  config: TableConfiguration | null;
  score: number;
  decision: BotDecision;
}

export class SeededRng {
  private s: number;
  constructor(seed = Date.now()) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s += 0x6d2b79f5;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

export class RummyBot {
  evaluator = new StateEvaluator();
  solver = new TableSolver();

  chooseMove(view: PlayerView, difficulty: string, debug = true, rng = new SeededRng()): BotMove {
    if (view.current !== view.playerId) throw new Error("It is not this player's turn");
    const diff = parseDifficulty(difficulty);
    const cfg = CONFIGS[diff];
    const started = performance.now();
    const deadline = started + cfg.timeLimitMs;
    const plyReserve =
      cfg.searchDepth >= 3 ? Math.min(340, cfg.timeLimitMs * 0.34) :
      cfg.searchDepth >= 2 ? Math.min(170, cfg.timeLimitMs * 0.34) :
      0;
    const opened = view.hasInitialMeld[view.playerId];
    const configs = this.collectConfigs(view, cfg, opened, deadline - plyReserve);
    const belief = cfg.useOpponentModel
      ? OpponentModel.fromView(view, cfg.opponentModelAccuracy)
      : null;
    const scored: [string, TableConfiguration | null, ScoreBreakdown][] = [];
    let nodes = 0;
    let cacheHits = 0;
    for (const config of configs) {
      scored.push(["PLAY", config, this.evaluator.evaluatePlay(view, config, belief)]);
      nodes += config.nodes;
      cacheHits += config.cacheHits;
    }
    let simulations = 0;
    if (cfg.searchDepth >= 2 && cfg.useMonteCarlo && scored.length && performance.now() < deadline) {
      simulations = this.lookahead(view, scored, cfg, belief, rng, deadline);
    }
    scored.push(["DRAW", null, this.evaluator.evaluateDraw(view, belief)]);
    const goingOut = scored.filter((item) => item[0] === "PLAY" && item[1] && item[1].rackLeft.length === 0);
    const pool = goingOut.length ? goingOut : scored;
    const [chosenAction, chosenConfig, chosenBreak] = this.select(pool, cfg, rng, view.poolSize, opened);
    const elapsed = performance.now() - started;
    const top = [...scored].sort((a, b) => b[2].total - a[2].total).slice(0, 10);
    const usedStr = chosenConfig ? chosenConfig.rackUsed.map(tileStr).join(" ") : "";
    const decision: BotDecision = {
      action: chosenConfig ? `PLAY ${usedStr}` : chosenAction,
      score: chosenBreak.total,
      reasons: { ...chosenBreak.terms },
      initialHand: view.rack.map(tileStr).join(" "),
      initialTable: tableStr(view.table),
      finalTable: chosenConfig ? tableStr(chosenConfig.table) : tableStr(view.table),
      discarded: chosenConfig ? usedStr : "(draw)",
      searchDepth: cfg.searchDepth,
      statesEvaluated: nodes + scored.length,
      cacheHits,
      simulationCount: simulations,
      timeMs: elapsed,
      difficulty: diff,
      topCandidates: debug
        ? top.map(([action, config, bd]) => ({
            action: config ? "PLAY" : action,
            score: bd.total,
            rackUsed: config ? config.rackUsed.map(tileStr).join(" ") : "DRAW",
            tilesPlayed: config ? tilesPlayed(config) : 0,
          }))
        : [],
      log: "",
    };
    decision.log = formatDecision(decision);
    return { action: chosenAction, config: chosenConfig, score: chosenBreak.total, decision };
  }

  private collectConfigs(
    view: PlayerView,
    cfg: DifficultyConfig,
    opened: boolean,
    deadline: number,
  ): TableConfiguration[] {
    const rack = [...view.rack];
    const table = view.table;
    const remainingMs = Math.max(20, deadline - performance.now());
    if (!opened) {
      return this.solver.solve(table, rack, {
        mode: "initial",
        minRackPlayed: 1,
        maxConfigs: cfg.beamK,
        timeLimitMs: remainingMs,
        minInitialPoints: 30,
      });
    }
    const addBudget = cfg.solverMode === "add_only" ? remainingMs : Math.min(140, remainingMs * 0.25);
    const configs = this.solver.solve(table, rack, {
      mode: "add_only",
      minRackPlayed: 1,
      maxConfigs: cfg.beamK,
      timeLimitMs: addBudget,
    });
    if (cfg.solverMode === "add_only") return configs;
    let continued: TableConfiguration[] = [];
    if (configs.length) {
      const seed = configs.reduce((a, b) =>
        tilesPlayed(a) > tilesPlayed(b) ||
        (tilesPlayed(a) === tilesPlayed(b) && remainingDeadwood(a) < remainingDeadwood(b))
          ? a
          : b,
      );
      const continueBudget = Math.max(20, (deadline - performance.now()) * 0.65);
      continued = this.continueTurn(seed, cfg, continueBudget);
    }
    const extra = this.solver.solve(table, rack, {
      mode: cfg.solverMode,
      minRackPlayed: 1,
      maxConfigs: cfg.beamK,
      timeLimitMs: Math.max(20, deadline - performance.now()),
    });
    return mergeConfigs(configs, mergeConfigs(continued, extra));
  }

  private continueTurn(seed: TableConfiguration, cfg: DifficultyConfig, budgetMs: number): TableConfiguration[] {
    if (!seed.rackLeft.length || budgetMs < 15) return [];
    const started = performance.now();
    const extras = this.solver.solve(seed.table, seed.rackLeft, {
      mode: cfg.solverMode,
      minRackPlayed: 1,
      maxConfigs: cfg.beamK,
      timeLimitMs: Math.max(20, budgetMs * 0.8),
    });
    const continued = extras.map((extra) => composeConfigs(seed, extra)).filter((c): c is TableConfiguration => !!c);
    if (!continued.length) return [];
    const best = continued.reduce((a, b) =>
      tilesPlayed(a) > tilesPlayed(b) ||
      (tilesPlayed(a) === tilesPlayed(b) && remainingDeadwood(a) < remainingDeadwood(b))
        ? a
        : b,
    );
    const mopBudget = budgetMs - (performance.now() - started);
    if (mopBudget >= 15 && best.rackLeft.length) {
      const more = this.solver.solve(best.table, best.rackLeft, {
        mode: "add_only",
        minRackPlayed: 1,
        maxConfigs: cfg.beamK,
        timeLimitMs: mopBudget,
      });
      continued.push(
        ...more.map((extra) => composeConfigs(best, extra)).filter((c): c is TableConfiguration => !!c),
      );
    }
    return continued;
  }

  private select(
    scored: [string, TableConfiguration | null, ScoreBreakdown][],
    cfg: DifficultyConfig,
    rng: SeededRng,
    poolSize: number,
    opened: boolean,
  ): [string, TableConfiguration | null, ScoreBreakdown] {
    let ranked = [...scored].sort((a, b) => b[2].total - a[2].total);
    const plays = ranked.filter((i) => i[0] === "PLAY");
    const draws = ranked.filter((i) => i[0] === "DRAW");
    const slack = 8 + 40 * cfg.randomness;
    if (plays.length) {
      if (poolSize === 0) {
        ranked = plays;
      } else {
        const bestPlay = plays[0][2].total;
        const bestDraw = draws[0]?.[2].total ?? -Infinity;
        const waiting = !opened && "wait_to_open" in plays[0][2].terms;
        if (!waiting && bestPlay >= bestDraw - slack) ranked = plays;
      }
    }
    const bestScore = ranked[0][2].total;
    const margin = 18 + 55 * cfg.randomness;
    const eligible = ranked.filter((i) => bestScore - i[2].total <= margin);
    if (cfg.randomness <= 0 || eligible.length === 1) return ranked[0];
    const temp = Math.max(0.8, cfg.randomness * 28);
    const weights = eligible.map((i) => Math.exp((i[2].total - bestScore) / temp));
    let r = rng.next() * weights.reduce((s, w) => s + w, 0);
    for (let i = 0; i < eligible.length; i++) {
      r -= weights[i];
      if (r <= 0) return eligible[i];
    }
    return eligible[eligible.length - 1];
  }

  private lookahead(
    view: PlayerView,
    scored: [string, TableConfiguration | null, ScoreBreakdown][],
    cfg: DifficultyConfig,
    belief: OpponentModel | null,
    rng: SeededRng,
    deadline: number,
  ): number {
    let plays = scored.filter((i) => i[0] === "PLAY" && i[1]);
    plays.sort((a, b) => b[2].total - a[2].total);
    plays = plays.slice(0, cfg.lookaheadTop);
    if (!plays.length || !belief) return 0;
    const oppSize = view.rackSizes
      .map((size, i) => ({ size, i }))
      .filter((x) => x.i !== view.playerId)
      .sort((a, b) => a.size - b.size)[0].size;
    const samples = Math.max(1, Math.floor(cfg.simulationCount / Math.max(1, plays.length)));
    const perSolveMs = cfg.searchDepth >= 3 ? 25 : 18;
    const racks: Tile[][] = [];
    for (let s = 0; s < samples; s++) {
      if (performance.now() + perSolveMs > deadline) break;
      racks.push(belief.sampleHidden(oppSize, () => rng.next()));
    }
    if (!racks.length) return 0;
    const dumpOn = (table: Table): [number, number] => {
      let tiles = 0;
      let n = 0;
      for (const sample of racks) {
        if (performance.now() + perSolveMs > deadline) break;
        const replies = this.solver.solve(table, sample, {
          mode: "add_only",
          minRackPlayed: 1,
          maxConfigs: 8,
          timeLimitMs: perSolveMs,
        });
        tiles += replies[0]?.rackUsed.length ?? 0;
        n += 1;
      }
      return [n ? tiles / n : 0, n];
    };
    const [baseline, baselineN] = dumpOn(view.table);
    if (!baselineN) return 0;
    let used = baselineN;
    for (const item of plays) {
      if (performance.now() + perSolveMs > deadline) break;
      const [gifted, n] = dumpOn(item[1]!.table);
      used += n;
      if (n) addTerm(item[2], "simulated_opponent_replies", -24 * (gifted - baseline));
    }
    return used;
  }
}

function composeConfigs(first: TableConfiguration, second: TableConfiguration): TableConfiguration | null {
  const leftover = new Set(first.rackLeft.map((t) => t.id));
  const usedAgain = second.rackUsed.map((t) => t.id);
  if (!usedAgain.length || usedAgain.some((id) => !leftover.has(id))) return null;
  return {
    table: second.table,
    rackUsed: [...first.rackUsed, ...second.rackUsed],
    rackLeft: second.rackLeft,
    solverMode: second.solverMode,
    nodes: first.nodes + second.nodes,
    cacheHits: first.cacheHits + second.cacheHits,
    timeMs: first.timeMs + second.timeMs,
  };
}

function mergeConfigs(first: TableConfiguration[], second: TableConfiguration[]): TableConfiguration[] {
  const seen = new Set<string>();
  const merged: TableConfiguration[] = [];
  for (const config of [...first, ...second]) {
    const key = JSON.stringify([config.table.melds.map((m) => m.tiles.map((t) => t.id)), config.rackUsed.map((t) => t.id)]);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(config);
  }
  return merged;
}

function formatDecision(d: BotDecision): string {
  return [`BOT DECISION`, d.action, `Score: ${d.score.toFixed(2)}`, `Time: ${d.timeMs.toFixed(1)}ms`].join("\n");
}
