import assert from "node:assert/strict";
import { test } from "node:test";
import { BLACK, parseTiles, tileRank } from "../tile";
import { GROUP, RUN, meldCanonicalKey, type Meld } from "../meld";
import { tableHash, tableCanonicalKey } from "../table";
import { makeRun, TableValidationError, tryMakeMeld, validateEntireTable } from "../validator";
import { group, run, tableOf } from "./helpers";

test("valid group and run", () => {
  validateEntireTable(tableOf(group("3R 3B 3N"), run("8A 9A 10A 11A 12A")));
});

test("group rejects duplicate color", () => {
  const tiles = parseTiles("7R 7R 7B");
  const meld: Meld = { kind: GROUP, tiles, bindings: [] };
  assert.throws(() => validateEntireTable({ melds: [meld] }), TableValidationError);
});

test("run allows wrap around 13", () => {
  validateEntireTable(tableOf(run("12R 13R 1R"), run("13N 1N 2N")));
  const wrapped = makeRun(parseTiles("12R 13R 1R"));
  assert.deepEqual(wrapped.tiles.map(tileRank), [12, 13, 1]);
  assert.notDeepEqual(meldCanonicalKey(wrapped), meldCanonicalKey(run("1R 2R 3R")));
});

test("run rejects broken sequence", () => {
  const tiles = parseTiles("1R 2R 4R");
  const meld: Meld = { kind: RUN, tiles, bindings: [] };
  assert.throws(() => validateEntireTable({ melds: [meld] }), TableValidationError);
  assert.throws(() => makeRun(parseTiles("4B 5B")), TableValidationError);
});

test("table rejects duplicate tile ids", () => {
  const meldA = run("1R 2R 3R");
  const meldB: Meld = { kind: RUN, tiles: meldA.tiles, bindings: [] };
  assert.throws(() => validateEntireTable({ melds: [meldA, meldB] }), TableValidationError);
});

test("joker in run needs binding", () => {
  const tiles = parseTiles("4N 5N J");
  makeRun(tiles, [{ jokerId: tiles[2].id, color: BLACK, rank: 6 }]);
});

test("tryMakeMeld group and visual run", () => {
  const groupMeld = tryMakeMeld(parseTiles("7R 7B 7A"));
  assert.equal(groupMeld.kind, GROUP);
  const runMeld = tryMakeMeld(parseTiles("4N 5N J"));
  assert.equal(runMeld.kind, RUN);
  assert.equal(runMeld.bindings[0].rank, 6);
});

test("tryMakeMeld joker leads run", () => {
  const meld = tryMakeMeld(parseTiles("J 4R 5R"));
  assert.equal(meld.kind, RUN);
  assert.equal(meld.bindings[0].rank, 3);
});

test("tryMakeMeld wrap run", () => {
  const meld = tryMakeMeld(parseTiles("13N 1N 2N"));
  assert.equal(meld.kind, RUN);
  assert.deepEqual(meld.tiles.map(tileRank), [13, 1, 2]);
});

test("tryMakeMeld rejects short and hashes commute", () => {
  assert.throws(() => tryMakeMeld(parseTiles("4B 5B")), TableValidationError);
  const a = tableOf(group("5R 5B 5N"), run("1A 2A 3A"));
  const b = tableOf(run("1A 2A 3A"), group("5R 5B 5N"));
  assert.equal(tableHash(a), tableHash(b));
  assert.equal(JSON.stringify(tableCanonicalKey(a)), JSON.stringify(tableCanonicalKey(b)));
});
