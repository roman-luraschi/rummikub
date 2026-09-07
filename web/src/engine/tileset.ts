import { isJoker, NUM_COLORS, NUM_RANKS, tileColor, tileRank, type Tile } from "./tile";

export function slotIndex(color: number, rank: number): number {
  return (rank - 1) * NUM_COLORS + color;
}

export function colorRankFromIndex(index: number): [number, number] {
  const rank0 = Math.floor(index / NUM_COLORS);
  const color = index % NUM_COLORS;
  return [color, rank0 + 1];
}

export class TileBag {
  n: Uint8Array;
  jokers: number;

  constructor(n?: Uint8Array, jokers = 0) {
    this.n = n ? new Uint8Array(n) : new Uint8Array(NUM_COLORS * NUM_RANKS);
    this.jokers = jokers;
  }

  static fromTiles(tiles: Tile[]): TileBag {
    const bag = new TileBag();
    for (const t of tiles) bag.addTile(t);
    return bag;
  }

  addTile(t: Tile): void {
    if (isJoker(t)) {
      this.jokers += 1;
      return;
    }
    this.add(tileColor(t), tileRank(t));
  }

  add(color: number, rank: number, k = 1): void {
    this.n[slotIndex(color, rank)] += k;
  }

  count(color: number, rank: number): number {
    return this.n[slotIndex(color, rank)];
  }

  take(color: number, rank: number): boolean {
    const i = slotIndex(color, rank);
    if (this.n[i] === 0) return false;
    this.n[i] -= 1;
    return true;
  }

  put(color: number, rank: number): void {
    this.n[slotIndex(color, rank)] += 1;
  }

  takeJoker(): boolean {
    if (this.jokers <= 0) return false;
    this.jokers -= 1;
    return true;
  }

  putJoker(): void {
    this.jokers += 1;
  }

  firstNumbered(): [number, number] | null {
    for (let i = 0; i < this.n.length; i++) {
      if (this.n[i]) return colorRankFromIndex(i);
    }
    return null;
  }

  numberedTotal(): number {
    let s = 0;
    for (const c of this.n) s += c;
    return s;
  }

  hasNumbered(): boolean {
    return this.numberedTotal() > 0;
  }

  key(): string {
    return `${Array.from(this.n).join(",")}|${this.jokers}`;
  }
}

export function consumeNumbered(
  must: TileBag,
  opt: TileBag,
  color: number,
  rank: number,
): string | null {
  if (must.take(color, rank)) return "must";
  if (opt.take(color, rank)) return "opt";
  if (must.takeJoker()) return "joker_must";
  if (opt.takeJoker()) return "joker_opt";
  return null;
}

export function undoConsume(
  must: TileBag,
  opt: TileBag,
  source: string,
  color: number,
  rank: number,
): void {
  if (source === "must") must.put(color, rank);
  else if (source === "opt") opt.put(color, rank);
  else if (source === "joker_must") must.putJoker();
  else if (source === "joker_opt") opt.putJoker();
  else throw new Error(source);
}
