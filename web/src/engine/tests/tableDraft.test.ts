import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDrop, arrangePile, type Pile } from "../../tableDraft";
import type { TileData } from "../../types";

function tile(id: number, color: string, rank: number): TileData {
  return { id, isJoker: false, label: String(rank), color, rank };
}

function joker(id: number): TileData {
  return { id, isJoker: true, label: "J", color: "joker", rank: null };
}

function ranks(tiles: TileData[]): Array<number | null> {
  return tiles.map((item) => item.rank);
}

test("a loose run is ordered, including a wrap and a joker gap", () => {
  assert.deepEqual(ranks(arrangePile([
    tile(6, "blue", 6),
    tile(7, "blue", 7),
    tile(8, "blue", 8),
    tile(4, "blue", 4),
    tile(5, "blue", 5),
    tile(9, "blue", 9),
  ])), [4, 5, 6, 7, 8, 9]);

  assert.deepEqual(ranks(arrangePile([
    tile(1, "black", 1),
    tile(2, "black", 2),
    tile(13, "black", 13),
  ])), [13, 1, 2]);

  assert.deepEqual(ranks(arrangePile([
    tile(13, "black", 13),
    tile(1, "black", 1),
    tile(2, "black", 2),
  ])), [13, 1, 2]);

  const withJoker = arrangePile([
    tile(7, "red", 7),
    tile(5, "red", 5),
    joker(50),
  ]);
  assert.deepEqual(withJoker.map((item) => item.id), [5, 50, 7]);
});

test("a group stays in the order it was dropped", () => {
  const group = [
    tile(1, "blue", 1),
    tile(2, "red", 1),
    tile(3, "orange", 1),
    tile(4, "black", 1),
  ];
  assert.deepEqual(arrangePile(group).map((item) => item.id), [1, 2, 3, 4]);
});

test("dropping the last tile of a run sorts that pile", () => {
  const piles: Pile[] = [{ id: 1, tiles: [tile(6, "blue", 6), tile(4, "blue", 4)] }];
  const dropped = applyDrop(piles, tile(5, "blue", 5), { place: "rack" }, { place: "pile", pile: 0, index: 1 }, new Set(), true);
  assert.deepEqual(dropped.piles[0].tiles.map((item) => item.rank), [4, 5, 6]);
});
