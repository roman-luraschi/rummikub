import { GROUP, RUN } from "../engine/meld";
import { tableToData } from "../engine/serialize";
import { findPlayForSelectedTiles } from "../engine/solver";
import type { Table } from "../engine/table";
import { COLOR_UI, type Tile } from "../engine/tile";
import type { GameView } from "../types";

function colorIndex(color: string): number {
  const index = (COLOR_UI as readonly string[]).indexOf(color);
  if (index < 0) throw new Error("Color de ficha desconocido");
  return index;
}

export function tableFromView(view: GameView): Table {
  return {
    melds: view.table.melds.map((meld) => ({
      kind: meld.kind === "group" ? GROUP : RUN,
      tiles: meld.tiles.map((tile) => ({ id: tile.id })),
      bindings: meld.bindings.map((binding) => ({
        jokerId: binding.jokerId,
        color: colorIndex(binding.color),
        rank: binding.rank,
      })),
    })),
  };
}

export function previewSelection(view: GameView, tileIds: number[]) {
  const rack: Tile[] = view.rack.map((tile) => ({ id: tile.id }));
  const config = findPlayForSelectedTiles(
    tableFromView(view),
    rack,
    tileIds,
    view.hasInitialMeld[view.playerId],
  );
  return {
    table: tableToData(config.table),
    tileIds: config.rackUsed.map((tile) => tile.id),
  };
}
