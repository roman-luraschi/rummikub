import { GROUP, RUN, type JokerBinding, type Meld, represented } from "./meld";
import { PartitionSearch, remainingDeadwood, tilesPlayed, type SolverMode, type TableConfiguration } from "./partition";
import { nextRank, prevRank, runDisplayOrder } from "./runs";
import { tableCanonicalKey, tableTileIds, type Table } from "./table";
import { NUM_COLORS, NUM_RANKS, isJoker, tileColor, tileRank, type Tile } from "./tile";
import { makeGroup, makeRun, TableValidationError, tryMakeMeld, validateEntireTable } from "./validator";

export class NoLegalPlay extends Error {}

export class TableSolver {
  solve(
    table: Table,
    rack: Tile[],
    opts: {
      mode?: SolverMode;
      minRackPlayed?: number;
      maxConfigs?: number;
      timeLimitMs?: number;
      maxUnfreeze?: number;
      minInitialPoints?: number;
    } = {},
  ): TableConfiguration[] {
    const mode = opts.mode ?? "full";
    const minRackPlayed = opts.minRackPlayed ?? 1;
    const maxConfigs = opts.maxConfigs ?? 64;
    const timeLimitMs = opts.timeLimitMs ?? 200;
    const minInitialPoints = opts.minInitialPoints ?? 30;
    if (mode === "initial") {
      return new PartitionSearch([], rack, {
        frozenMelds: table.melds,
        minRackPlayed,
        maxConfigs,
        timeLimitMs,
        minInitialPoints,
        mode: "initial",
      }).solve();
    }
    if (mode === "add_only") return this.addOnly(table, rack, minRackPlayed, maxConfigs, timeLimitMs);
    if (mode === "local") {
      return this.local(table, rack, minRackPlayed, maxConfigs, timeLimitMs, opts.maxUnfreeze ?? 2);
    }
    return new PartitionSearch(allTableTiles(table), rack, {
      minRackPlayed,
      maxConfigs,
      timeLimitMs,
      mode: "full",
    }).solve();
  }

  private addOnly(
    table: Table,
    rack: Tile[],
    minRackPlayed: number,
    maxConfigs: number,
    timeLimitMs: number,
  ): TableConfiguration[] {
    const configs: TableConfiguration[] = [];
    const seen = new Set<string>();

    const rec = (index: number, remaining: Tile[], built: Meld[], used: Tile[]) => {
      if (configs.length >= maxConfigs) return;
      if (index === table.melds.length) {
        const minMore = Math.max(0, minRackPlayed - used.length);
        const search = new PartitionSearch([], remaining, {
          frozenMelds: built,
          minRackPlayed: minMore,
          maxConfigs: maxConfigs - configs.length,
          timeLimitMs,
          mode: "add_only",
        });
        for (const cfg of search.solve()) {
          const mergedUsed = [...used, ...cfg.rackUsed];
          if (mergedUsed.length < minRackPlayed) continue;
          const merged: TableConfiguration = {
            ...cfg,
            rackUsed: mergedUsed,
            solverMode: "add_only",
          };
          try {
            validateEntireTable(merged.table);
          } catch {
            continue;
          }
          const key = JSON.stringify([tableCanonicalKey(merged.table), merged.rackUsed.map((t) => t.id)]);
          if (!seen.has(key)) {
            seen.add(key);
            configs.push(merged);
          }
        }
        return;
      }
      const meld = table.melds[index];
      for (const [newMeld, consumed] of extensionOptions(meld, remaining)) {
        const consumedIds = new Set(consumed.map((t) => t.id));
        rec(
          index + 1,
          remaining.filter((t) => !consumedIds.has(t.id)),
          [...built, newMeld],
          [...used, ...consumed],
        );
      }
    };

    rec(0, [...rack], [], []);
    configs.sort((a, b) => tilesPlayed(b) - tilesPlayed(a) || remainingDeadwood(a) - remainingDeadwood(b));
    return configs.slice(0, maxConfigs);
  }

  private local(
    table: Table,
    rack: Tile[],
    minRackPlayed: number,
    maxConfigs: number,
    timeLimitMs: number,
    maxUnfreeze: number,
  ): TableConfiguration[] {
    const configs: TableConfiguration[] = [];
    const seen = new Set<string>();
    const n = table.melds.length;
    if (n === 0) {
      return this.solve(table, rack, { mode: "full", minRackPlayed, maxConfigs, timeLimitMs });
    }
    const limit = Math.min(maxUnfreeze, n);
    const perBudget = Math.max(20, timeLimitMs / Math.max(1, limit * n));
    for (let k = 1; k <= limit; k++) {
      for (const idxs of combinations(range(n), k)) {
        if (configs.length >= maxConfigs) break;
        const idxSet = new Set(idxs);
        const frozen = table.melds.filter((_, i) => !idxSet.has(i));
        const free: Tile[] = [];
        for (const i of idxs) free.push(...table.melds[i].tiles);
        const search = new PartitionSearch(free, rack, {
          frozenMelds: frozen,
          minRackPlayed,
          maxConfigs,
          timeLimitMs: perBudget,
          mode: "local",
        });
        for (const cfg of search.solve()) {
          const key = JSON.stringify([tableCanonicalKey(cfg.table), cfg.rackUsed.map((t) => t.id)]);
          if (!seen.has(key)) {
            seen.add(key);
            configs.push(cfg);
          }
        }
      }
    }
    configs.sort((a, b) => tilesPlayed(b) - tilesPlayed(a) || remainingDeadwood(a) - remainingDeadwood(b));
    return configs.slice(0, maxConfigs);
  }
}

function allTableTiles(table: Table): Tile[] {
  return table.melds.flatMap((m) => m.tiles);
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
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

export function findPlayForSelectedTiles(
  table: Table,
  rack: Tile[],
  tileIds: number[],
  hasInitialMeld: boolean,
  minInitialPoints = 30,
  maxConfigs = 48,
  timeLimitMs = 450,
): TableConfiguration {
  const wanted = new Set(tileIds);
  if (!tileIds.length) throw new NoLegalPlay("A play must use at least one rack tile");
  if (wanted.size !== tileIds.length) throw new NoLegalPlay("Duplicate tile in selection");
  const byId = new Map(rack.map((t) => [t.id, t]));
  for (const id of tileIds) {
    if (!byId.has(id)) throw new NoLegalPlay("Selected tiles are not in your rack");
  }
  const selected = tileIds.map((id) => byId.get(id)!);
  const single = playAsSingleNewMeld(table, rack, selected, hasInitialMeld, minInitialPoints);
  if (single) return single;
  const solver = new TableSolver();
  if (hasInitialMeld) {
    for (const mode of ["add_only", "full"] as SolverMode[]) {
      const configs = solver.solve(table, selected, {
        mode,
        minRackPlayed: 1,
        maxConfigs,
        timeLimitMs,
        minInitialPoints: 0,
      });
      const cfg = pickSelectedConfig(configs, wanted, rack);
      if (cfg) return cfg;
    }
    throw new NoLegalPlay("No legal table rearrangement uses those tiles");
  }
  const configs = solver.solve(table, selected, {
    mode: "initial",
    minRackPlayed: 1,
    maxConfigs,
    timeLimitMs,
    minInitialPoints,
  });
  const cfg = pickSelectedConfig(configs, wanted, rack);
  if (cfg) return cfg;
  if (
    table.melds.length &&
    selectionPlaysOnTable(solver, table, selected, wanted, rack, maxConfigs, timeLimitMs)
  ) {
    throw new NoLegalPlay(
      "Todavía no abriste: no se puede usar la mesa. La apertura tiene que sumar 30 puntos con combinaciones nuevas del atril, sin comodines.",
    );
  }
  throw new NoLegalPlay("Esas fichas no forman una apertura de 30 puntos sin usar la mesa ni comodines.");
}

function pickSelectedConfig(
  configs: TableConfiguration[],
  wanted: Set<number>,
  rack: Tile[],
): TableConfiguration | null {
  const exact = configs.filter((c) => {
    const used = new Set(c.rackUsed.map((t) => t.id));
    return used.size === wanted.size && [...used].every((id) => wanted.has(id));
  });
  if (exact.length) {
    return withRemainingRack(
      exact.reduce((a, b) =>
        tilesPlayed(a) > tilesPlayed(b) ||
        (tilesPlayed(a) === tilesPlayed(b) && remainingDeadwood(a) < remainingDeadwood(b))
          ? a
          : b,
      ),
      rack,
    );
  }
  const partial = configs.filter((c) => c.rackUsed.length && c.rackUsed.every((t) => wanted.has(t.id)));
  if (partial.length) {
    return withRemainingRack(
      partial.reduce((a, b) =>
        tilesPlayed(a) > tilesPlayed(b) ||
        (tilesPlayed(a) === tilesPlayed(b) && remainingDeadwood(a) < remainingDeadwood(b))
          ? a
          : b,
      ),
      rack,
    );
  }
  return null;
}

function selectionPlaysOnTable(
  solver: TableSolver,
  table: Table,
  selected: Tile[],
  wanted: Set<number>,
  rack: Tile[],
  maxConfigs: number,
  timeLimitMs: number,
): boolean {
  for (const mode of ["add_only", "full"] as SolverMode[]) {
    const configs = solver.solve(table, selected, {
      mode,
      minRackPlayed: 1,
      maxConfigs,
      timeLimitMs: Math.min(200, timeLimitMs),
      minInitialPoints: 0,
    });
    if (pickSelectedConfig(configs, wanted, rack)) return true;
  }
  return false;
}

function playAsSingleNewMeld(
  table: Table,
  rack: Tile[],
  selected: Tile[],
  hasInitialMeld: boolean,
  minInitialPoints: number,
): TableConfiguration | null {
  if (!hasInitialMeld && selected.some(isJoker)) return null;
  const meld = singleMeldFrom(selected);
  if (!meld) return null;
  if (!hasInitialMeld && pointValueSafe(meld) < minInitialPoints) return null;
  const usedIds = new Set(selected.map((t) => t.id));
  return {
    table: { melds: [...table.melds, meld] },
    rackUsed: rack.filter((t) => usedIds.has(t.id)),
    rackLeft: rack.filter((t) => !usedIds.has(t.id)),
    solverMode: hasInitialMeld ? "full" : "initial",
    nodes: 0,
    cacheHits: 0,
    timeMs: 0,
  };
}

function pointValueSafe(meld: Meld): number {
  return meld.tiles.reduce((s, t) => s + (isJoker(t) ? 0 : tileRank(t)), 0);
}

function singleMeldFrom(tiles: Tile[]): Meld | null {
  if (tiles.length < 3 || tiles.some(isJoker)) return null;
  for (const factory of [makeRun, makeGroup]) {
    try {
      return factory([...tiles]);
    } catch (err) {
      if (err instanceof TableValidationError) continue;
      throw err;
    }
  }
  return null;
}

function withRemainingRack(cfg: TableConfiguration, rack: Tile[]): TableConfiguration {
  const used = new Set(cfg.rackUsed.map((t) => t.id));
  return { ...cfg, rackLeft: rack.filter((t) => !used.has(t.id)) };
}

function extensionOptions(meld: Meld, rack: Tile[]): [Meld, Tile[]][] {
  const options: [Meld, Tile[]][] = [[meld, []]];
  if (meld.kind === GROUP) options.push(...groupExtensions(meld, rack));
  else options.push(...runExtensions(meld, rack));
  return options;
}

function groupExtensions(meld: Meld, rack: Tile[]): [Meld, Tile[]][] {
  if (meld.tiles.length !== 3) return [];
  const slots = represented(meld);
  const rank = slots[0][1];
  const usedColors = new Set(slots.map((s) => s[0]));
  const results: [Meld, Tile[]][] = [];
  for (let color = 0; color < NUM_COLORS; color++) {
    if (usedColors.has(color)) continue;
    const copy = [...rack];
    const t = takeFromList(copy, color, rank);
    if (!t) continue;
    const bindings: JokerBinding[] = isJoker(t)
      ? [...meld.bindings, { jokerId: t.id, color, rank }]
      : [...meld.bindings];
    results.push([makeGroup([...meld.tiles, t], bindings), [t]]);
  }
  return results;
}

function runExtensions(meld: Meld, rack: Tile[]): [Meld, Tile[]][] {
  const slots = represented(meld);
  const color = slots[0][0];
  const ranks = runDisplayOrder(slots.map((s) => s[1]));
  const occupied = new Set(ranks);
  const results: [Meld, Tile[]][] = [];
  const maxGrow = NUM_RANKS - ranks.length;

  const grow = (left: number, right: number) => {
    if (left === 0 && right === 0) return;
    const remaining = [...rack];
    const leftConsumed: Tile[] = [];
    const rightConsumed: Tile[] = [];
    const bindings = [...meld.bindings];
    const taken = new Set(occupied);
    let ok = true;
    let rank = ranks[0];
    for (let i = 0; i < left; i++) {
      rank = prevRank(rank);
      if (taken.has(rank)) {
        ok = false;
        break;
      }
      const t = takeFromList(remaining, color, rank);
      if (!t) {
        ok = false;
        break;
      }
      taken.add(rank);
      leftConsumed.push(t);
      if (isJoker(t)) bindings.push({ jokerId: t.id, color, rank });
    }
    if (ok) {
      rank = ranks[ranks.length - 1];
      for (let i = 0; i < right; i++) {
        rank = nextRank(rank);
        if (taken.has(rank)) {
          ok = false;
          break;
        }
        const t = takeFromList(remaining, color, rank);
        if (!t) {
          ok = false;
          break;
        }
        taken.add(rank);
        rightConsumed.push(t);
        if (isJoker(t)) bindings.push({ jokerId: t.id, color, rank });
      }
    }
    const consumed = [...leftConsumed, ...rightConsumed];
    if (!ok || !consumed.length) return;
    results.push([
      makeRun([...leftConsumed.reverse(), ...meld.tiles, ...rightConsumed], bindings),
      consumed,
    ]);
  };

  for (let left = 0; left <= maxGrow; left++) {
    for (let right = 0; right <= maxGrow - left; right++) grow(left, right);
  }
  return results;
}

function takeFromList(rack: Tile[], color: number, rank: number): Tile | null {
  const i = rack.findIndex((t) => !isJoker(t) && tileColor(t) === color && tileRank(t) === rank);
  if (i >= 0) return rack.splice(i, 1)[0];
  const j = rack.findIndex(isJoker);
  if (j >= 0) return rack.splice(j, 1)[0];
  return null;
}

export function configurationFromLayout(
  committed: Table,
  rack: Tile[],
  groups: number[][],
  hasInitialMeld: boolean,
): TableConfiguration {
  const universe = new Map<number, Tile>();
  for (const t of allTableTiles(committed)) universe.set(t.id, t);
  for (const t of rack) universe.set(t.id, t);
  const seen = new Set<number>();
  const melds: Meld[] = [];
  for (const group of groups) {
    if (!group.length) continue;
    const tiles: Tile[] = [];
    for (const tileId of group) {
      if (seen.has(tileId)) throw new TableValidationError("La misma ficha aparece dos veces");
      const t = universe.get(tileId);
      if (!t) throw new TableValidationError("Hay una ficha que no está en juego");
      seen.add(tileId);
      tiles.push(t);
    }
    const kept = committed.melds.find((meld) =>
      meld.tiles.length === tiles.length && meld.tiles.every((tile, index) => tile.id === tiles[index].id),
    );
    melds.push(tryMakeMeld(tiles, kept));
  }
  const table: Table = { melds };
  validateEntireTable(table);
  const oldIds = tableTileIds(committed);
  const newIds = tableTileIds(table);
  for (const id of oldIds) {
    if (!newIds.has(id)) throw new TableValidationError("Las fichas de la mesa no pueden volver al atril");
  }
  const extra = [...newIds].filter((id) => !oldIds.has(id));
  const rackIds = new Set(rack.map((t) => t.id));
  if (extra.some((id) => !rackIds.has(id))) throw new TableValidationError("Solo se pueden agregar fichas del atril");
  if (!extra.length) throw new TableValidationError("Tenés que bajar al menos una ficha del atril");
  if (!hasInitialMeld && extra.some((id) => isJoker(universe.get(id)!))) {
    throw new TableValidationError("La apertura de 30 puntos no puede usar comodines");
  }
  const extraSet = new Set(extra);
  return {
    table,
    rackUsed: rack.filter((t) => extraSet.has(t.id)),
    rackLeft: rack.filter((t) => !extraSet.has(t.id)),
    solverMode: hasInitialMeld ? "full" : "initial",
    nodes: 0,
    cacheHits: 0,
    timeMs: 0,
  };
}
