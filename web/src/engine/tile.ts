export const RED = 0;
export const BLUE = 1;
export const BLACK = 2;
export const ORANGE = 3;

export const COLOR_NAMES = ["R", "B", "N", "A"] as const;
export const COLOR_UI = ["red", "blue", "black", "orange"] as const;
export const COLOR_FROM_CHAR: Record<string, number> = {
  R: RED,
  B: BLUE,
  N: BLACK,
  K: BLACK,
  A: ORANGE,
  O: ORANGE,
};

export const NUM_COLORS = 4;
export const MIN_RANK = 1;
export const MAX_RANK = 13;
export const NUM_RANKS = 13;
export const COPIES_PER_TILE = 2;
export const NUMBERED_COUNT = NUM_COLORS * NUM_RANKS * COPIES_PER_TILE;
export const JOKER_COUNT = 2;
export const TOTAL_TILES = NUMBERED_COUNT + JOKER_COUNT;
export const FIRST_JOKER_ID = NUMBERED_COUNT;
export const JOKER_RACK_VALUE = 30;

export interface Tile {
  id: number;
}

export function numberedId(color: number, rank: number, copy = 0): number {
  return copy * (NUM_COLORS * NUM_RANKS) + color * NUM_RANKS + (rank - 1);
}

export function jokerId(index: number): number {
  return FIRST_JOKER_ID + index;
}

export function tile(id: number): Tile {
  return { id };
}

export function numberedTile(color: number, rank: number, copy = 0): Tile {
  return { id: numberedId(color, rank, copy) };
}

export function jokerTile(index = 0): Tile {
  return { id: jokerId(index) };
}

export function isJoker(t: Tile): boolean {
  return t.id >= FIRST_JOKER_ID;
}

export function tileCopy(t: Tile): number {
  if (isJoker(t)) return t.id - FIRST_JOKER_ID;
  return Math.floor(t.id / (NUM_COLORS * NUM_RANKS));
}

export function tileColor(t: Tile): number {
  if (isJoker(t)) throw new Error("Joker has no inherent color");
  const remainder = t.id % (NUM_COLORS * NUM_RANKS);
  return Math.floor(remainder / NUM_RANKS);
}

export function tileRank(t: Tile): number {
  if (isJoker(t)) throw new Error("Joker has no inherent rank");
  return (t.id % NUM_RANKS) + 1;
}

export function rackValue(t: Tile): number {
  return isJoker(t) ? JOKER_RACK_VALUE : tileRank(t);
}

export function tileStr(t: Tile): string {
  if (isJoker(t)) return `J${tileCopy(t)}`;
  return `${tileRank(t)}${COLOR_NAMES[tileColor(t)]}`;
}

export function buildDeck(): Tile[] {
  const tiles: Tile[] = [];
  for (let copy = 0; copy < COPIES_PER_TILE; copy++) {
    for (let color = 0; color < NUM_COLORS; color++) {
      for (let rank = MIN_RANK; rank <= MAX_RANK; rank++) {
        tiles.push(numberedTile(color, rank, copy));
      }
    }
  }
  for (let i = 0; i < JOKER_COUNT; i++) tiles.push(jokerTile(i));
  return tiles;
}

export function parseTiles(spec: string): Tile[] {
  const used = new Map<string, number>();
  let jokerN = 0;
  const tiles: Tile[] = [];
  for (const token of spec.replaceAll(",", " ").split(/\s+/)) {
    const raw = token.trim().toUpperCase();
    if (!raw) continue;
    if (raw === "J" || raw === "JK" || raw === "*" || raw === "JOKER" || (raw.startsWith("J") && /^\d+$/.test(raw.slice(1)))) {
      tiles.push(jokerTile(jokerN));
      jokerN += 1;
      continue;
    }
    const rank = Number(raw.slice(0, -1));
    const color = COLOR_FROM_CHAR[raw.slice(-1)];
    if (!Number.isInteger(rank) || color == null) throw new Error(`Invalid tile: ${token}`);
    const key = `${color},${rank}`;
    const copy = used.get(key) ?? 0;
    if (copy > 1) throw new Error(`More than two copies of ${raw}`);
    tiles.push(numberedTile(color, rank, copy));
    used.set(key, copy + 1);
  }
  return tiles;
}
