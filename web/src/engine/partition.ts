import { GROUP, RUN, pointValue, type JokerBinding, type Meld } from "./meld";
import { runRanksFromStart } from "./runs";
import { emptyTable, type Table } from "./table";
import { MAX_RANK, MIN_RANK, NUM_COLORS, NUM_RANKS, isJoker, rackValue, type Tile } from "./tile";
import { TileBag, consumeNumbered, undoConsume } from "./tileset";
import { validateEntireTable } from "./validator";

export type SolverMode = "add_only" | "local" | "full" | "initial";

export interface TableConfiguration {
  table: Table;
  rackUsed: Tile[];
  rackLeft: Tile[];
  solverMode: SolverMode;
  nodes: number;
  cacheHits: number;
  timeMs: number;
}

export function tilesPlayed(cfg: TableConfiguration): number {
  return cfg.rackUsed.length;
}

export function remainingDeadwood(cfg: TableConfiguration): number {
  return cfg.rackLeft.reduce((s, t) => s + rackValue(t), 0);
}

interface Part {
  kind: typeof GROUP | typeof RUN;
  items: [string, number, number][];
}

function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const n = arr.length;
  if (k === 0) return [[]];
  if (k > n) return out;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    out.push(idx.map((i) => arr[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return out;
}

export class PartitionSearch {
  tableTiles: Tile[];
  rackTiles: Tile[];
  frozenMelds: Meld[];
  minRackPlayed: number;
  maxConfigs: number;
  timeLimitS: number;
  minInitialPoints: number;
  mode: SolverMode;
  must: TileBag;
  opt: TileBag;
  skipped: TileBag;
  current: Part[] = [];
  failCache = new Set<string>();
  seenTable = new Set<string>();
  configs: TableConfiguration[] = [];
  nodes = 0;
  cacheHits = 0;
  timedOut = false;
  private deadline = 0;

  constructor(
    tableTiles: Tile[],
    rackTiles: Tile[],
    opts: {
      frozenMelds?: Meld[];
      minRackPlayed?: number;
      maxConfigs?: number;
      timeLimitMs?: number;
      minInitialPoints?: number;
      mode?: SolverMode;
    } = {},
  ) {
    this.tableTiles = tableTiles;
    this.rackTiles = rackTiles;
    this.frozenMelds = opts.frozenMelds ?? [];
    this.minRackPlayed = opts.minRackPlayed ?? 1;
    this.maxConfigs = opts.maxConfigs ?? 64;
    this.timeLimitS = (opts.timeLimitMs ?? 200) / 1000;
    this.minInitialPoints = opts.minInitialPoints ?? 0;
    this.mode = opts.mode ?? "full";
    this.must = TileBag.fromTiles(tableTiles);
    this.opt = TileBag.fromTiles(rackTiles);
    this.skipped = new TileBag();
  }

  solve(): TableConfiguration[] {
    const start = performance.now();
    this.deadline = start + this.timeLimitS * 1000;
    this.search();
    const timeMs = performance.now() - start;
    this.configs.sort((a, b) => {
      const da = remainingDeadwood(a);
      const db = remainingDeadwood(b);
      return tilesPlayed(b) - tilesPlayed(a) || da - db;
    });
    return this.configs.map((cfg) => ({
      ...cfg,
      solverMode: this.mode,
      nodes: this.nodes,
      cacheHits: this.cacheHits,
      timeMs,
    }));
  }

  private timedOutNow(): boolean {
    if (this.timedOut) return true;
    if ((this.nodes & 63) === 0 && performance.now() >= this.deadline) {
      this.timedOut = true;
      return true;
    }
    return false;
  }

  private overBudget(): boolean {
    return this.timedOutNow() || this.configs.length >= this.maxConfigs;
  }

  private search(): boolean {
    this.nodes += 1;
    if (this.overBudget()) return this.configs.length > 0;
    if (!this.must.hasNumbered() && this.must.jokers === 0) {
      this.record();
      this.tryExtraFromOpt();
      return true;
    }
    const key = this.must.key() + "|" + this.opt.key();
    if (this.failCache.has(key)) {
      this.cacheHits += 1;
      return false;
    }
    let found = false;
    if (this.must.hasNumbered()) {
      const cr = this.must.firstNumbered()!;
      found = this.tryKinds(cr[0], cr[1]) || found;
    } else {
      found = this.tryJokerAnchor() || found;
    }
    if (!found && !this.timedOut && this.configs.length < this.maxConfigs) this.failCache.add(key);
    return found;
  }

  private tryExtraFromOpt(): void {
    if (this.overBudget() || !this.opt.hasNumbered()) return;
    const [color, rank] = this.opt.firstNumbered()!;
    if (this.minInitialPoints) {
      this.skipOptTile(color, rank);
      if (this.overBudget()) return;
      this.forceOptTile(color, rank);
    } else {
      this.forceOptTile(color, rank);
      if (this.overBudget()) return;
      this.skipOptTile(color, rank);
    }
  }

  private forceOptTile(color: number, rank: number): void {
    this.tryKinds(color, rank);
  }

  private tryKinds(color: number, rank: number): boolean {
    const groupsFirst = (color + rank) % 2 === 0;
    const first = groupsFirst
      ? (c: number, r: number) => this.tryGroups(c, r)
      : (c: number, r: number) => this.tryRuns(c, r);
    const second = groupsFirst
      ? (c: number, r: number) => this.tryRuns(c, r)
      : (c: number, r: number) => this.tryGroups(c, r);
    const saved = this.maxConfigs;
    if (!this.current.length) {
      const remaining = Math.max(0, saved - this.configs.length);
      this.maxConfigs = this.configs.length + remaining - Math.floor(remaining / 2);
    }
    let found = false;
    try {
      found = first(color, rank);
    } finally {
      this.maxConfigs = saved;
    }
    if (!this.timedOutNow()) found = second(color, rank) || found;
    return found;
  }

  private skipOptTile(color: number, rank: number): void {
    this.opt.take(color, rank);
    this.skipped.put(color, rank);
    this.tryExtraFromOpt();
    this.skipped.take(color, rank);
    this.opt.put(color, rank);
  }

  private tryGroups(color: number, rank: number): boolean {
    let found = false;
    const others = [0, 1, 2, 3].filter((c) => c !== color);
    for (const extraN of [3, 2]) {
      for (const extra of combinations(others, extraN)) {
        if (this.playGroup([color, ...extra], rank)) found = true;
        if (this.overBudget()) return found;
      }
    }
    return found;
  }

  private playGroup(colors: number[], rank: number, requireMustJoker = false): boolean {
    const sources: [string, number, number][] = [];
    for (const c of colors) {
      const src = consumeNumbered(this.must, this.opt, c, rank);
      if (src === null) {
        for (let i = sources.length - 1; i >= 0; i--) {
          undoConsume(this.must, this.opt, sources[i][0], sources[i][1], sources[i][2]);
        }
        return false;
      }
      sources.push([src, c, rank]);
    }
    if (requireMustJoker && !sources.some(([s]) => s === "joker_must")) {
      for (let i = sources.length - 1; i >= 0; i--) {
        undoConsume(this.must, this.opt, sources[i][0], sources[i][1], sources[i][2]);
      }
      return false;
    }
    this.current.push({ kind: GROUP, items: sources });
    const found = this.search();
    this.current.pop();
    for (let i = sources.length - 1; i >= 0; i--) {
      undoConsume(this.must, this.opt, sources[i][0], sources[i][1], sources[i][2]);
    }
    return found;
  }

  private tryRuns(color: number, rank: number): boolean {
    let found = false;
    for (const ranks of runArcsContaining(rank)) {
      if (this.playRun(color, ranks)) found = true;
      if (this.overBudget()) return found;
    }
    return found;
  }

  private playRun(color: number, ranks: number[], requireMustJoker = false): boolean {
    const sources: [string, number, number][] = [];
    let ok = true;
    for (const rnk of ranks) {
      const src = consumeNumbered(this.must, this.opt, color, rnk);
      if (src === null) {
        ok = false;
        break;
      }
      sources.push([src, color, rnk]);
    }
    let found = false;
    if (ok && (!requireMustJoker || sources.some(([s]) => s === "joker_must"))) {
      this.current.push({ kind: RUN, items: sources });
      found = this.search();
      this.current.pop();
    }
    for (let i = sources.length - 1; i >= 0; i--) {
      undoConsume(this.must, this.opt, sources[i][0], sources[i][1], sources[i][2]);
    }
    return found;
  }

  private tryJokerAnchor(): boolean {
    const groupsFirst = this.nodes % 2 === 0;
    const saved = this.maxConfigs;
    const remaining = Math.max(0, saved - this.configs.length);
    this.maxConfigs = this.configs.length + remaining - Math.floor(remaining / 2);
    const first = groupsFirst ? () => this.jokerGroups() : () => this.jokerRuns();
    const second = groupsFirst ? () => this.jokerRuns() : () => this.jokerGroups();
    let found = false;
    try {
      found = first();
    } finally {
      this.maxConfigs = saved;
    }
    if (!this.timedOutNow()) found = second() || found;
    return found;
  }

  private jokerGroups(): boolean {
    let found = false;
    const others = [0, 1, 2, 3];
    for (let rank = MIN_RANK; rank <= MAX_RANK; rank++) {
      for (const extraN of [3, 4]) {
        for (const colors of combinations(others, extraN)) {
          if (this.playGroup(colors, rank, true)) found = true;
          if (this.overBudget()) return found;
        }
      }
    }
    return found;
  }

  private jokerRuns(): boolean {
    let found = false;
    for (let color = 0; color < NUM_COLORS; color++) {
      for (const ranks of allRunArcs()) {
        if (this.playRun(color, ranks, true)) found = true;
        if (this.overBudget()) return found;
      }
    }
    return found;
  }

  private optUsedCount(): number {
    let used = 0;
    for (const part of this.current) {
      for (const [source] of part.items) {
        if (source === "opt" || source === "joker_opt") used += 1;
      }
    }
    return used;
  }

  private record(): void {
    if (this.optUsedCount() < this.minRackPlayed) return;
    let config: TableConfiguration;
    try {
      config = this.materialize();
    } catch {
      return;
    }
    try {
      validateEntireTable(config.table);
    } catch {
      return;
    }
    if (this.minInitialPoints) {
      const newMelds = config.table.melds.slice(this.frozenMelds.length);
      if (newMelds.some((m) => m.tiles.some(isJoker))) return;
      const points = newMelds.reduce((s, m) => s + pointValue(m), 0);
      if (points < this.minInitialPoints) return;
    }
    const key = JSON.stringify([config.table.melds.map((m) => m.tiles.map((t) => t.id)), config.rackUsed.map((t) => t.id)]);
    if (this.seenTable.has(key)) return;
    this.seenTable.add(key);
    this.configs.push(config);
  }

  private materialize(): TableConfiguration {
    const tablePool = poolFrom(this.tableTiles);
    const rackPool = poolFrom(this.rackTiles);
    const built: Meld[] = this.frozenMelds.map((m) => ({
      kind: m.kind,
      tiles: [...m.tiles],
      bindings: [...m.bindings],
    }));
    const usedIds = new Set<number>();
    for (const part of this.current) {
      const { meld, ids } = meldFromPart(part, tablePool, rackPool);
      built.push(meld);
      for (const id of ids) usedIds.add(id);
    }
    const table: Table = { melds: built };
    return {
      table,
      rackUsed: this.rackTiles.filter((t) => usedIds.has(t.id)),
      rackLeft: this.rackTiles.filter((t) => !usedIds.has(t.id)),
      solverMode: this.mode,
      nodes: 0,
      cacheHits: 0,
      timeMs: 0,
    };
  }
}

function poolFrom(tiles: Tile[]): Map<string, Tile[]> {
  const pool = new Map<string, Tile[]>();
  for (const t of tiles) {
    const key = t.id >= 104 ? "J" : `${Math.floor((t.id % 52) / 13)},${(t.id % 13) + 1}`;
    const bucket = pool.get(key) ?? [];
    bucket.push(t);
    pool.set(key, bucket);
  }
  return pool;
}

function pop(pool: Map<string, Tile[]>, key: string): Tile {
  const bucket = pool.get(key);
  if (!bucket?.length) throw new Error(key);
  return bucket.pop()!;
}

function meldFromPart(
  part: Part,
  tablePool: Map<string, Tile[]>,
  rackPool: Map<string, Tile[]>,
): { meld: Meld; ids: number[] } {
  const tiles: Tile[] = [];
  const bindings: JokerBinding[] = [];
  const ids: number[] = [];
  for (const [source, color, rank] of part.items) {
    let t: Tile;
    if (source === "joker_must" || source === "joker_opt") {
      t = pop(source === "joker_must" ? tablePool : rackPool, "J");
      bindings.push({ jokerId: t.id, color, rank });
    } else {
      t = pop(source === "must" ? tablePool : rackPool, `${color},${rank}`);
    }
    tiles.push(t);
    ids.push(t.id);
  }
  return { meld: { kind: part.kind, tiles, bindings }, ids };
}

let ALL_RUN_ARCS: number[][] | null = null;

function allRunArcs(): number[][] {
  if (!ALL_RUN_ARCS) {
    const seen = new Set<string>();
    const arcs: number[][] = [];
    for (let length = 3; length <= NUM_RANKS; length++) {
      for (let start = MIN_RANK; start <= MAX_RANK; start++) {
        const ranks = runRanksFromStart(start, length);
        const key = [...ranks].sort((a, b) => a - b).join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        arcs.push(ranks);
      }
    }
    arcs.sort((a, b) => b.length - a.length);
    ALL_RUN_ARCS = arcs;
  }
  return ALL_RUN_ARCS;
}

function runArcsContaining(rank: number): number[][] {
  return allRunArcs().filter((arc) => arc.includes(rank));
}

export { emptyTable };
