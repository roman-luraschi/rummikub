import { GROUP, RUN, type JokerBinding, type Meld, represented } from "./meld";
import { ranksFormRun, nextRank, stepRank } from "./runs";
import type { Table } from "./table";
import { MAX_RANK, MIN_RANK, NUM_COLORS, NUM_RANKS, isJoker, tileColor, tileRank, type Tile } from "./tile";

export class TableValidationError extends Error {}

export function validateMeld(meld: Meld): void {
  if (meld.tiles.length < 3) throw new TableValidationError(`Meld too short`);
  const ids = meld.tiles.map((t) => t.id);
  if (new Set(ids).size !== ids.length) throw new TableValidationError("Duplicate tile in meld");
  const jokers = meld.tiles.filter(isJoker);
  const bound = new Set(meld.bindings.map((b) => b.jokerId));
  const actual = new Set(jokers.map((t) => t.id));
  if (bound.size !== actual.size || [...bound].some((id) => !actual.has(id))) {
    throw new TableValidationError("Joker bindings mismatch");
  }
  for (const b of meld.bindings) {
    if (b.rank < MIN_RANK || b.rank > MAX_RANK) throw new TableValidationError("Invalid joker rank");
    if (b.color < 0 || b.color >= NUM_COLORS) throw new TableValidationError("Invalid joker color");
  }
  const slots = represented(meld);
  if (meld.kind === GROUP) validateGroup(meld, slots);
  else if (meld.kind === RUN) validateRun(meld, slots);
  else throw new TableValidationError("Unknown meld kind");
}

function validateGroup(_meld: Meld, slots: [number, number][]): void {
  if (slots.length < 3 || slots.length > 4) throw new TableValidationError("Group must have 3 or 4 tiles");
  if (new Set(slots.map((s) => s[1])).size !== 1) throw new TableValidationError("Group ranks must match");
  const colors = slots.map((s) => s[0]);
  if (new Set(colors).size !== colors.length) throw new TableValidationError("Group colors must be unique");
}

function validateRun(_meld: Meld, slots: [number, number][]): void {
  if (new Set(slots.map((s) => s[0])).size !== 1) throw new TableValidationError("Run colors must match");
  if (!ranksFormRun(slots.map((s) => s[1]))) throw new TableValidationError("Run not consecutive");
}

export function validateEntireTable(table: Table): void {
  const seen = new Set<number>();
  for (const meld of table.melds) {
    validateMeld(meld);
    for (const t of meld.tiles) {
      if (seen.has(t.id)) throw new TableValidationError("Tile appears twice on the table");
      seen.add(t.id);
    }
  }
}

export function makeGroup(tiles: Tile[], bindings: JokerBinding[] = []): Meld {
  const meld: Meld = { kind: GROUP, tiles: [...tiles], bindings: [...bindings] };
  validateMeld(meld);
  return meld;
}

export function makeRun(tiles: Tile[], bindings: JokerBinding[] = []): Meld {
  const meld: Meld = { kind: RUN, tiles: [...tiles], bindings: [...bindings] };
  validateMeld(meld);
  return meld;
}

export function inferGroupBindings(tiles: Tile[], rank: number): JokerBinding[] {
  const used = new Set(tiles.filter((t) => !isJoker(t)).map(tileColor));
  const missing = [0, 1, 2, 3].filter((c) => !used.has(c));
  const jokers = tiles.filter(isJoker);
  if (jokers.length > missing.length) throw new TableValidationError("Too many jokers for group");
  return jokers.map((j, i) => ({ jokerId: j.id, color: missing[i], rank }));
}

function sameTileOrder(left: { id: number }[], right: { id: number }[]): boolean {
  return left.length === right.length && left.every((tile, index) => tile.id === right[index].id);
}

export function tryMakeMeld(tiles: Tile[], kept?: Meld | null): Meld {
  if (kept && sameTileOrder(kept.tiles, tiles)) {
    return {
      kind: kept.kind,
      tiles: [...kept.tiles],
      bindings: kept.bindings.map((binding) => ({ ...binding })),
    };
  }
  if (tiles.length < 3) throw new TableValidationError("Hace falta un juego de al menos 3 fichas");
  const numbered = tiles.filter((t) => !isJoker(t));
  const jokers = tiles.filter(isJoker);
  if (numbered.length) {
    const ranks = new Set(numbered.map(tileRank));
    const colors = numbered.map(tileColor);
    if (ranks.size === 1 && colors.length === new Set(colors).size && tiles.length <= 4) {
      const rank = tileRank(numbered[0]);
      const bindings = jokers.length ? inferGroupBindings(tiles, rank) : [];
      return makeGroup(tiles, bindings);
    }
  }
  if (numbered.length) {
    try {
      return runFromVisualOrder(tiles);
    } catch (err) {
      if (err instanceof TableValidationError && !jokers.length) {
        return makeRun(tiles);
      }
      throw err;
    }
  }
  throw new TableValidationError("No se puede armar un juego solo con comodines");
}

function runFromVisualOrder(tiles: Tile[]): Meld {
  const numbered = tiles
    .map((t, i) => [i, t] as const)
    .filter(([, t]) => !isJoker(t));
  if (!numbered.length) throw new TableValidationError("La escalera necesita al menos un número");
  const colors = new Set(numbered.map(([, t]) => tileColor(t)));
  if (colors.size !== 1) throw new TableValidationError("La escalera tiene que ser del mismo color");
  if (tiles.length > NUM_RANKS) throw new TableValidationError("La escalera no puede repetir números");
  const color = tileColor(numbered[0][1]);
  const [firstI, first] = numbered[0];
  let expected = stepRank(tileRank(first), -firstI);
  const bindings: JokerBinding[] = [];
  const seen = new Set<number>();
  for (const t of tiles) {
    if (seen.has(expected)) throw new TableValidationError("La escalera no puede repetir números");
    seen.add(expected);
    if (isJoker(t)) bindings.push({ jokerId: t.id, color, rank: expected });
    else if (tileColor(t) !== color || tileRank(t) !== expected) {
      throw new TableValidationError("Las fichas no forman una escalera en ese orden");
    }
    expected = nextRank(expected);
  }
  return makeRun(tiles, bindings);
}
