import { meldCanonicalKey, meldStr, type Meld } from "./meld";
import type { Tile } from "./tile";

export interface Table {
  melds: Meld[];
}

export function emptyTable(): Table {
  return { melds: [] };
}

export function allTiles(table: Table): Tile[] {
  return table.melds.flatMap((m) => m.tiles);
}

export function tableTileIds(table: Table): Set<number> {
  const ids = new Set<number>();
  for (const meld of table.melds) {
    for (const t of meld.tiles) ids.add(t.id);
  }
  return ids;
}

export function tableCanonicalKey(table: Table): unknown {
  return [...table.melds.map(meldCanonicalKey)].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
}

export function tableHash(table: Table): string {
  const raw = JSON.stringify(tableCanonicalKey(table));
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function tableStr(table: Table): string {
  if (!table.melds.length) return "(empty table)";
  return table.melds.map(meldStr).join(" | ");
}
