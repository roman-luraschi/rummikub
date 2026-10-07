import type { JokerBindingData, MeldData, TileData } from "./types";

export type Pile = {
  id: number;
  tiles: TileData[];
};

export type DragOrigin =
  | { place: "rack" }
  | { place: "pile"; pile: number; index: number };

export type DropTarget =
  | { place: "rack" }
  | { place: "felt" }
  | { place: "pile"; pile: number; index: number };

export type DragState = {
  tile: TileData;
  origin: DragOrigin;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
};

export type PileStatus = {
  kind: "group" | "run" | "building" | "invalid";
  label: string;
  bindings: JokerBindingData[];
};

let nextPileId = 1;

export function pilesFromMelds(melds: MeldData[]): Pile[] {
  return melds.map((meld) => ({
    id: nextPileId++,
    tiles: [...meld.tiles],
  }));
}

function circularRunOrder(ranks: number[]) {
  const unique = [...new Set(ranks)].sort((a, b) => a - b);
  const n = unique.length;
  if (n === 13) return Array.from({ length: 13 }, (_, i) => i + 1);
  if (n === 0) return [];
  let bestStart = unique[0];
  let bestGap = unique[0] + 13 - unique[n - 1];
  for (let i = 0; i < n - 1; i++) {
    const gap = unique[i + 1] - unique[i];
    if (gap > bestGap) {
      bestGap = gap;
      bestStart = unique[i + 1];
    }
  }
  const ordered: number[] = [];
  let rank = bestStart;
  for (let i = 0; i < n; i++) {
    ordered.push(rank);
    rank = rank === 13 ? 1 : rank + 1;
  }
  return ordered;
}

function stepRank(rank: number, steps: number) {
  return ((((rank - 1 + steps) % 13) + 13) % 13) + 1;
}

export function pileTileIds(piles: Pile[]) {
  return new Set(piles.flatMap((pile) => pile.tiles.map((tile) => tile.id)));
}

export function layoutSignature(piles: Pile[]) {
  return piles
    .filter((pile) => pile.tiles.length)
    .map((pile) =>
      [...pile.tiles.map((tile) => tile.id)]
        .sort((a, b) => a - b)
        .join(",")
    )
    .sort()
    .join("|");
}

export function committedSignature(melds: MeldData[]) {
  return melds
    .map((meld) =>
      [...meld.tiles.map((tile) => tile.id)]
        .sort((a, b) => a - b)
        .join(",")
    )
    .sort()
    .join("|");
}

function tileSetKey(tiles: { id: number }[]) {
  return [...tiles.map((tile) => tile.id)].sort((a, b) => a - b).join(",");
}

export function samePileGroups(piles: Pile[], melds: MeldData[]): boolean {
  const fromPiles = piles
    .filter((pile) => pile.tiles.length)
    .map((pile) => tileSetKey(pile.tiles))
    .sort();
  const fromMelds = melds.map((meld) => tileSetKey(meld.tiles)).sort();
  return fromPiles.length === fromMelds.length && fromPiles.every((key, i) => key === fromMelds[i]);
}

function mergePileWithMeld(pile: Pile, meld: MeldData): Pile {
  const keep = new Set(meld.tiles.map((tile) => tile.id));
  let tiles = pile.tiles.filter((tile) => keep.has(tile.id));
  const have = new Set(tiles.map((tile) => tile.id));
  for (const tile of meld.tiles) {
    if (have.has(tile.id)) continue;
    const at = insertIndexForMeld({ id: pile.id, tiles }, meld, tile.id);
    tiles = [...tiles.slice(0, at), tile, ...tiles.slice(at)];
    have.add(tile.id);
  }
  return { id: pile.id, tiles };
}

export function reconcilePiles(current: Pile[], melds: MeldData[]): Pile[] {
  if (!melds.length) return [];
  if (!current.length) return pilesFromMelds(melds);
  if (samePileGroups(current, melds)) return current;

  const assigned = bindMeldsToPiles(current, melds);
  const pileToMeld = new Map<number, number>();
  assigned.forEach((pileId, meldIdx) => {
    if (pileId >= 0) pileToMeld.set(pileId, meldIdx);
  });

  const next: Pile[] = [];
  const placed = new Set<number>();
  for (const pile of current) {
    const meldIdx = pileToMeld.get(pile.id);
    if (meldIdx === undefined) continue;
    next.push(mergePileWithMeld(pile, melds[meldIdx]));
    placed.add(meldIdx);
  }
  for (let i = 0; i < melds.length; i++) {
    if (placed.has(i)) continue;
    next.push({ id: nextPileId++, tiles: [...melds[i].tiles] });
  }
  return next;
}

function sameTileOrder(left: { id: number }[], right: { id: number }[]): boolean {
  return left.length === right.length && left.every((tile, index) => tile.id === right[index].id);
}

export function classifyPile(tiles: TileData[], committed: MeldData[] = []): PileStatus {
  const kept = committed.find((meld) => sameTileOrder(meld.tiles, tiles));
  if (kept) {
    return {
      kind: kept.kind,
      label: kept.kind === "group" ? "Grupo" : "Escalera",
      bindings: kept.bindings,
    };
  }
  if (tiles.length === 0) {
    return { kind: "building", label: "Vacío", bindings: [] };
  }
  if (tiles.length < 3) {
    return { kind: "building", label: "Armando…", bindings: [] };
  }
  const numbered = tiles.filter((tile) => !tile.isJoker);
  const jokers = tiles.filter((tile) => tile.isJoker);
  if (!numbered.length) {
    return { kind: "invalid", label: "Inválido", bindings: [] };
  }
  const ranks = new Set(numbered.map((tile) => tile.rank));
  const colors = numbered.map((tile) => tile.color);
  if (ranks.size === 1 && new Set(colors).size === colors.length && tiles.length <= 4) {
    const rank = numbered[0].rank ?? 0;
    const used = new Set(colors);
    const missing = ["red", "blue", "black", "orange"].filter((color) => !used.has(color));
    const bindings = jokers.map((joker, i) => ({
      jokerId: joker.id,
      color: missing[i] ?? "joker",
      rank,
    }));
    return { kind: "group", label: "Grupo", bindings };
  }
  const run = visualRun(tiles);
  if (run) return run;
  if (!jokers.length) {
    const byCircle = circularRunOrder(numbered.map((tile) => tile.rank ?? 0));
    const byRank = new Map(numbered.map((tile) => [tile.rank ?? 0, tile]));
    const ordered = byCircle.map((rank) => byRank.get(rank)!).filter(Boolean);
    const sorted = visualRun(ordered);
    if (sorted) return sorted;
  }
  return { kind: "invalid", label: "Inválido", bindings: [] };
}

function visualRun(tiles: TileData[]): PileStatus | null {
  const numbered = tiles
    .map((tile, index) => ({ tile, index }))
    .filter((item) => !item.tile.isJoker);
  if (!numbered.length) return null;
  const color = numbered[0].tile.color;
  if (numbered.some((item) => item.tile.color !== color)) return null;
  if (tiles.length > 13) return null;
  const start = stepRank(numbered[0].tile.rank ?? 0, -numbered[0].index);
  let expected = start;
  const seen = new Set<number>();
  const bindings: JokerBindingData[] = [];
  for (const tile of tiles) {
    if (seen.has(expected)) return null;
    seen.add(expected);
    if (tile.isJoker) {
      bindings.push({ jokerId: tile.id, color, rank: expected });
    } else if (tile.color !== color || tile.rank !== expected) {
      return null;
    }
    expected = stepRank(expected, 1);
  }
  return { kind: "run", label: "Escalera", bindings };
}

export function applyDrop(
  piles: Pile[],
  tile: TileData,
  origin: DragOrigin,
  dest: DropTarget,
  committedIds: Set<number>,
  hasOpened: boolean,
): { piles: Pile[]; error?: string } {
  if (dest.place === "rack") {
    if (committedIds.has(tile.id)) {
      return { piles, error: "Las fichas de la mesa no pueden volver al atril." };
    }
    return { piles: removeTile(piles, origin, tile.id) };
  }

  if (!hasOpened && committedIds.has(tile.id)) {
    return { piles, error: "Todavía no abriste: no podés desarmar la mesa." };
  }

  if (!hasOpened && tile.isJoker) {
    return { piles, error: "La apertura de 30 puntos no puede usar comodines." };
  }

  if (!hasOpened && dest.place === "pile") {
    const target = piles[dest.pile];
    const destHasCommitted = target?.tiles.some((item) => committedIds.has(item.id));
    if (destHasCommitted && !committedIds.has(tile.id)) {
      return { piles, error: "La apertura no puede tocar las combinaciones que ya están en la mesa." };
    }
  }

  let destPile = dest.place === "pile" ? dest.pile : -1;
  let destIndex = dest.place === "pile" ? dest.index : 0;
  if (origin.place === "pile" && dest.place === "pile") {
    if (origin.pile === dest.pile && destIndex > origin.index) {
      destIndex -= 1;
    }
    const originWillEmpty = piles[origin.pile]?.tiles.length === 1;
    if (originWillEmpty && destPile > origin.pile) {
      destPile -= 1;
    }
  }

  const next = removeTile(piles, origin, tile.id);
  if (dest.place === "felt") {
    return { piles: [...next, { id: nextPileId++, tiles: [tile] }] };
  }
  if (destPile < 0 || destPile >= next.length) {
    return { piles: [...next, { id: nextPileId++, tiles: [tile] }] };
  }
  const copy = next.map((pile) => ({ ...pile, tiles: [...pile.tiles] }));
  const insertAt = Math.max(0, Math.min(destIndex, copy[destPile].tiles.length));
  copy[destPile].tiles.splice(insertAt, 0, tile);
  return { piles: copy.filter((pile) => pile.tiles.length > 0) };
}

function removeTile(piles: Pile[], origin: DragOrigin, tileId: number): Pile[] {
  if (origin.place === "rack") {
    return piles.map((pile) => ({ ...pile, tiles: [...pile.tiles] }));
  }
  return piles
    .map((pile, index) => {
      if (index !== origin.pile) return { ...pile, tiles: [...pile.tiles] };
      return { ...pile, tiles: pile.tiles.filter((tile) => tile.id !== tileId) };
    })
    .filter((pile) => pile.tiles.length > 0);
}

export function newPile(tiles: TileData[] = []): Pile {
  return { id: nextPileId++, tiles: [...tiles] };
}

export function clonePiles(piles: Pile[]): Pile[] {
  return piles.map((pile) => ({ ...pile, tiles: [...pile.tiles] }));
}

export function removeTileFromPiles(piles: Pile[], tileId: number): Pile[] {
  return piles.map((pile) => ({ ...pile, tiles: pile.tiles.filter((tile) => tile.id !== tileId) }));
}

export function insertTileInPile(piles: Pile[], pileId: number, tile: TileData, index: number): Pile[] {
  return piles.map((pile) => {
    if (pile.id !== pileId) return pile;
    const tiles = pile.tiles.filter((item) => item.id !== tile.id);
    const at = Math.max(0, Math.min(index, tiles.length));
    return { ...pile, tiles: [...tiles.slice(0, at), tile, ...tiles.slice(at)] };
  });
}

export function insertIndexForMeld(pile: Pile | undefined, destMeld: MeldData, tileId: number): number {
  if (!pile) return 0;
  const destOrder = destMeld.tiles.map((tile) => tile.id);
  const destPos = destOrder.indexOf(tileId);
  if (destPos < 0) return pile.tiles.length;
  const before = new Set(destOrder.slice(0, destPos));
  return pile.tiles.filter((tile) => before.has(tile.id)).length;
}

export function bindMeldsToPiles(piles: Pile[], afterMelds: MeldData[]): number[] {
  const tableIds = pileTileIds(piles);
  const used = new Set<number>();
  const assigned = afterMelds.map(() => -1);
  const ranked = afterMelds
    .map((meld, index) => ({
      index,
      score: meld.tiles.filter((tile) => tableIds.has(tile.id)).length,
    }))
    .sort((a, b) => b.score - a.score);

  for (const item of ranked) {
    if (item.score === 0) continue;
    const ids = new Set(afterMelds[item.index].tiles.map((tile) => tile.id));
    let bestId = -1;
    let best = 0;
    for (const pile of piles) {
      if (used.has(pile.id)) continue;
      const score = pile.tiles.filter((tile) => ids.has(tile.id)).length;
      if (score > best) {
        best = score;
        bestId = pile.id;
      }
    }
    if (bestId >= 0 && best > 0) {
      used.add(bestId);
      assigned[item.index] = bestId;
    }
  }
  return assigned;
}

export function dropFromPoint(x: number, y: number): DropTarget | null {
  const under = document.elementFromPoint(x, y);
  if (!(under instanceof Element)) return null;
  const slot = under.closest("[data-drop-slot]");
  if (slot instanceof HTMLElement) {
    return {
      place: "pile",
      pile: Number(slot.dataset.dropPile),
      index: Number(slot.dataset.dropSlot),
    };
  }
  const pile = under.closest("[data-drop-pile]");
  if (pile instanceof HTMLElement) {
    return {
      place: "pile",
      pile: Number(pile.dataset.dropPile),
      index: Number(pile.dataset.dropCount ?? 0),
    };
  }
  if (under.closest("[data-drop='rack']")) {
    return { place: "rack" };
  }
  if (under.closest("[data-drop='felt']")) {
    return { place: "felt" };
  }
  return null;
}
