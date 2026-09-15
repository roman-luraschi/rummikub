import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLUE,
  RED,
  buildDeck,
  isJoker,
  jokerTile,
  numberedTile,
  parseTiles,
  rackValue,
  tileColor,
  tileCopy,
  tileRank,
  tileStr,
} from "../tile";

test("deck has 106 unique tiles", () => {
  const deck = buildDeck();
  assert.equal(deck.length, 106);
  assert.equal(new Set(deck.map((t) => t.id)).size, 106);
  assert.equal(deck.filter(isJoker).length, 2);
});

test("numbered encoding roundtrip", () => {
  const tile = numberedTile(RED, 12, 1);
  assert.equal(tileColor(tile), RED);
  assert.equal(tileRank(tile), 12);
  assert.equal(tileCopy(tile), 1);
  assert.equal(isJoker(tile), false);
  assert.equal(tileStr(tile), "12R");
});

test("parseTiles assigns copies", () => {
  const tiles = parseTiles("7R 7R 7B");
  assert.equal(tileCopy(tiles[0]), 0);
  assert.equal(tileCopy(tiles[1]), 1);
  assert.notEqual(tiles[0].id, tiles[1].id);
  assert.equal(tileColor(tiles[2]), BLUE);
});

test("joker rack value", () => {
  assert.equal(rackValue(jokerTile(0)), 30);
  assert.equal(rackValue(numberedTile(3, 13)), 13);
});
