import { runDisplayOrder } from "./runs";
import { COLOR_NAMES, isJoker, tileColor, tileRank, type Tile } from "./tile";

export const GROUP = 1;
export const RUN = 2;

export interface JokerBinding {
  jokerId: number;
  color: number;
  rank: number;
}

export interface Meld {
  kind: typeof GROUP | typeof RUN;
  tiles: Tile[];
  bindings: JokerBinding[];
}

export function bindingFor(meld: Meld, jokerId: number): JokerBinding | undefined {
  return meld.bindings.find((b) => b.jokerId === jokerId);
}

export function represented(meld: Meld): [number, number][] {
  return meld.tiles.map((t) => {
    if (isJoker(t)) {
      const b = bindingFor(meld, t.id);
      if (!b) throw new Error(`Joker ${t.id} has no binding`);
      return [b.color, b.rank];
    }
    return [tileColor(t), tileRank(t)];
  });
}

export function pointValue(meld: Meld): number {
  let total = 0;
  for (const t of meld.tiles) {
    if (isJoker(t)) {
      const b = bindingFor(meld, t.id);
      if (!b) throw new Error(`Joker ${t.id} has no binding`);
      total += b.rank;
    } else {
      total += tileRank(t);
    }
  }
  return total;
}

export function meldCanonicalKey(meld: Meld): unknown {
  if (meld.kind === GROUP) {
    const slots = represented(meld).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const rank = slots[0]?.[1];
    const colors = slots.map((s) => s[0]);
    const jokerFlags = meld.tiles.map((t) => (isJoker(t) ? 1 : 0)).sort();
    return [meld.kind, rank, colors, jokerFlags];
  }
  const slots = represented(meld);
  const color = slots[0][0];
  const order = runDisplayOrder(slots.map((s) => s[1]));
  const jokerRanks = [...meld.bindings.map((b) => b.rank)].sort((a, b) => a - b);
  return [meld.kind, color, order[0], order.length, jokerRanks];
}

export function meldStr(meld: Meld): string {
  const parts = meld.tiles.map((t) => {
    if (!isJoker(t)) return `${tileRank(t)}${COLOR_NAMES[tileColor(t)]}`;
    const b = bindingFor(meld, t.id)!;
    return `J(${b.rank}${COLOR_NAMES[b.color]})`;
  });
  return `${meld.kind === GROUP ? "G" : "R"}[${parts.join(" ")}]`;
}
