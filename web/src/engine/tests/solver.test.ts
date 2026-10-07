import assert from "node:assert/strict";
import { test } from "node:test";
import { GROUP, RUN, pointValue, represented } from "../meld";
import { runDisplayOrder } from "../runs";
import { configurationFromLayout, findPlayForSelectedTiles, NoLegalPlay, TableSolver } from "../solver";
import { tableTileIds } from "../table";
import { isJoker, jokerTile, ORANGE, parseTiles, tileStr } from "../tile";
import { makeGroup } from "../validator";
import { group, run, tableOf } from "./helpers";

test("add-only extends run", () => {
  const table = tableOf(run("1R 2R 3R 4R"));
  const configs = new TableSolver().solve(table, parseTiles("5R"), { mode: "add_only", timeLimitMs: 200 });
  assert.ok(configs.length);
  const best = configs[0];
  assert.equal(best.rackUsed.length, 1);
  const ranks = represented(best.table.melds[0])
    .map(([, r]) => r)
    .sort((a, b) => a - b);
  assert.deepEqual(ranks, [1, 2, 3, 4, 5]);
});

test("full reorganization is not hardcoded", () => {
  const table = tableOf(run("3R 4R 5R 6R"), run("7R 8R 9R"), group("5B 5N 5A"));
  const rack = parseTiles("6B 6N 7B 7N 10R");
  const solver = new TableSolver();
  const full = solver.solve(table, rack, { mode: "full", maxConfigs: 80, timeLimitMs: 1000 });
  assert.ok(full.length, "FULL solver returned no legal configurations");
  assert.equal(full[0].rackUsed.length, 5, `expected to play all 5 rack tiles, played ${full[0].rackUsed.length}`);
  assert.equal(full[0].rackLeft.length, 0);

  const addOnly = solver.solve(table, rack, { mode: "add_only", maxConfigs: 40, timeLimitMs: 400 });
  assert.ok(addOnly.length);
  assert.ok(addOnly[0].rackUsed.length < 5, "ADD_ONLY should not match FULL's rearrangement power");
});

test("initial opening cannot use joker", () => {
  const table = tableOf();
  const rack = parseTiles("10R 11R J 1A 2A 3A");
  const selected = rack.filter((t) => isJoker(t) || ["10R", "11R"].includes(tileStr(t)));
  assert.throws(
    () => findPlayForSelectedTiles(table, rack, selected.map((t) => t.id), false),
    (err: Error) => {
      assert.ok(err instanceof NoLegalPlay);
      assert.match(err.message, /comodines/);
      return true;
    },
  );
  const configs = new TableSolver().solve(table, rack, {
    mode: "initial",
    minInitialPoints: 30,
    maxConfigs: 40,
    timeLimitMs: 400,
  });
  assert.equal(configs.length, 0);
});

test("initial solver keeps numbered opening and leaves joker", () => {
  const configs = new TableSolver().solve(tableOf(), parseTiles("10R 11R 12R J 1A 2A"), {
    mode: "initial",
    minInitialPoints: 30,
    maxConfigs: 40,
    timeLimitMs: 400,
  });
  assert.ok(configs.length);
  for (const cfg of configs) {
    assert.ok(cfg.table.melds.every((meld) => meld.tiles.every((tile) => !isJoker(tile))));
  }
});

test("initial meld requires 30 points", () => {
  const configs = new TableSolver().solve(
    tableOf(),
    parseTiles("1R 2R 3R 4B 5B 6B 10N 11N 12N 13A 1A 2A 3A 4A"),
    { mode: "initial", minInitialPoints: 30, maxConfigs: 40, timeLimitMs: 400 },
  );
  assert.ok(configs.length);
  assert.ok(configs.every((cfg) => cfg.table.melds.reduce((s, m) => s + pointValue(m), 0) >= 30));
});

test("joker completes a run", () => {
  const configs = new TableSolver().solve(tableOf(run("2A 3A 4A")), parseTiles("J"), {
    mode: "add_only",
    timeLimitMs: 200,
  });
  assert.ok(configs.length);
  assert.equal(configs[0].rackUsed.length, 1);
  const ranks = represented(configs[0].table.melds[0])
    .map(([, r]) => r)
    .sort((a, b) => a - b);
  assert.ok(["1,2,3,4", "2,3,4,5"].includes(ranks.join(",")));
});

function screenshotRack() {
  return parseTiles(
    "1R 5R 5R 6R 6R 7R 8R 10R 10R 12R 12R 13R 2B 3B 6B " +
      "8B 9B 10B 12B 13B 1N 2N 3N 5N 7N 8N 10N 11N 11N 13N " +
      "1A 1A 3A 3A 4A 6A 8A 10A 11A 11A 12A 13A",
  );
}

test("initial play uses selected duplicate not the other copy", () => {
  const rack = screenshotRack();
  assert.equal(rack.length, 42);
  const tenA = rack.find((t) => tileStr(t) === "10A")!;
  const elevenCopies = rack.filter((t) => tileStr(t) === "11A");
  const twelveA = rack.find((t) => tileStr(t) === "12A")!;
  const selectedEleven = elevenCopies[0];
  const unusedEleven = elevenCopies[1];
  const cfg = findPlayForSelectedTiles(tableOf(), rack, [tenA.id, selectedEleven.id, twelveA.id], false);
  const used = new Set(cfg.rackUsed.map((t) => t.id));
  assert.deepEqual(used, new Set([tenA.id, selectedEleven.id, twelveA.id]));
  assert.ok(!used.has(unusedEleven.id));
  assert.equal(cfg.table.melds.reduce((s, m) => s + pointValue(m), 0), 33);
});

test("initial play rejects run under 30 points", () => {
  const rack = parseTiles("1A 2A 3A 10N 11N 12N");
  const low = rack.filter((t) => ["1A", "2A", "3A"].includes(tileStr(t)));
  assert.throws(
    () => findPlayForSelectedTiles(tableOf(), rack, low.map((t) => t.id), false),
    NoLegalPlay,
  );
});

test("initial play two melds from selection", () => {
  const rack = parseTiles("10R 11R 12R 8B 8N 8A 1A 2A");
  const selected = rack.filter((t) => !["1A", "2A"].includes(tileStr(t)));
  const cfg = findPlayForSelectedTiles(tableOf(), rack, selected.map((t) => t.id), false);
  assert.deepEqual(new Set(cfg.rackUsed.map((t) => t.id)), new Set(selected.map((t) => t.id)));
  assert.equal(cfg.table.melds.length, 2);
  assert.equal(cfg.table.melds.reduce((s, m) => s + pointValue(m), 0), 57);
});

test("cannot extend table run before opening", () => {
  const table = tableOf(run("9R 10R 11R"), group("13R 13B 13N 13A"));
  const rack = parseTiles("3R 11R 12R 1B 6B 13B 6N 6A 7A 10A");
  const twelve = rack.find((t) => tileStr(t) === "12R")!;
  assert.throws(
    () => findPlayForSelectedTiles(table, rack, [twelve.id], false),
    (err: Error) => {
      assert.ok(err instanceof NoLegalPlay);
      assert.match(err.message, /no se puede usar la mesa/);
      return true;
    },
  );
});

test("after opening extends run with selected tile", () => {
  const table = tableOf(run("9R 10R 11R"), group("13R 13B 13N 13A"));
  const rack = parseTiles("3R 11R 12R 1B 6B 13B 6N 6A 7A 10A");
  const twelve = rack.find((t) => tileStr(t) === "12R")!;
  const cfg = findPlayForSelectedTiles(table, rack, [twelve.id], true);
  assert.deepEqual(new Set(cfg.rackUsed.map((t) => t.id)), new Set([twelve.id]));
  const runRanks = represented(cfg.table.melds[0])
    .map(([, r]) => r)
    .sort((a, b) => a - b);
  assert.deepEqual(runRanks, [9, 10, 11, 12]);
});

test("after opening wraps 1 onto 13", () => {
  const table = tableOf(run("11N 12N 13N"), group("13R 13B 13A"));
  const rack = parseTiles("1N 1B 2A");
  const one = rack.find((t) => tileStr(t) === "1N")!;
  const cfg = findPlayForSelectedTiles(table, rack, [one.id], true);
  assert.deepEqual(new Set(cfg.rackUsed.map((t) => t.id)), new Set([one.id]));
  assert.deepEqual(
    runDisplayOrder(represented(cfg.table.melds[0]).map(([, r]) => r)),
    [11, 12, 13, 1],
  );
});

test("after opening puts 13 before 1", () => {
  const table = tableOf(run("1A 2A 3A"));
  const rack = parseTiles("13A 6B 7N");
  const thirteen = rack.find((t) => tileStr(t) === "13A")!;
  const cfg = findPlayForSelectedTiles(table, rack, [thirteen.id], true);
  assert.deepEqual(
    runDisplayOrder(represented(cfg.table.melds[0]).map(([, r]) => r)),
    [13, 1, 2, 3],
  );
});

test("solver keeps group and run when both are legal", () => {
  const configs = new TableSolver().solve(tableOf(), parseTiles("10R 10B 10N 10A 11R 12R"), {
    mode: "initial",
    minInitialPoints: 30,
    maxConfigs: 4,
    timeLimitMs: 400,
  });
  assert.ok(configs.length);
  const kinds = new Set(configs.flatMap((cfg) => cfg.table.melds.map((meld) => meld.kind)));
  assert.ok(kinds.has(GROUP));
  assert.ok(kinds.has(RUN));
});

test("solver never returns invalid table", () => {
  const table = tableOf(run("2B 3B 4B"), group("9R 9B 9N"));
  const rack = parseTiles("5B 9A 11R 12R 13R");
  const solver = new TableSolver();
  for (const mode of ["add_only", "local", "full"] as const) {
    const configs = solver.solve(table, rack, { mode, maxConfigs: 30, timeLimitMs: 300 });
    assert.ok(configs.length);
    for (const cfg of configs) {
      const ids = tableTileIds(cfg.table);
      for (const id of tableTileIds(table)) assert.ok(ids.has(id));
    }
  }
});

test("layout rejects joker on initial opening", () => {
  const rack = parseTiles("10R 11R J 1A 2A");
  const selected = rack.filter((t) => isJoker(t) || ["10R", "11R"].includes(tileStr(t)));
  assert.throws(
    () => configurationFromLayout(tableOf(), rack, [selected.map((t) => t.id)], false),
    /comodines/,
  );
});

test("configurationFromLayout uses player piles", () => {
  const table = tableOf(run("9R 10R 11R"));
  const rack = parseTiles("12R 5B 6B 7B");
  const twelve = rack.find((t) => tileStr(t) === "12R")!;
  const blues = rack.filter((t) => ["5B", "6B", "7B"].includes(tileStr(t)));
  const cfg = configurationFromLayout(
    table,
    rack,
    [[...table.melds[0].tiles.map((t) => t.id), twelve.id], blues.map((t) => t.id)],
    true,
  );
  assert.deepEqual(
    new Set(cfg.rackUsed.map((t) => t.id)),
    new Set([twelve.id, ...blues.map((t) => t.id)]),
  );
  assert.equal(cfg.table.melds.length, 2);
});

test("configurationFromLayout keeps a committed joker bound to orange", () => {
  const pair = parseTiles("7R 7B");
  const joker = jokerTile(0);
  const grouped = makeGroup([...pair, joker], [{ jokerId: joker.id, color: ORANGE, rank: 7 }]);
  const table = tableOf(grouped);
  const rack = parseTiles("1N 2N 3N");
  const cfg = configurationFromLayout(
    table,
    rack,
    [grouped.tiles.map((tile) => tile.id), rack.map((tile) => tile.id)],
    true,
  );
  assert.equal(cfg.table.melds[0].kind, GROUP);
  assert.equal(cfg.table.melds[0].bindings[0]?.jokerId, joker.id);
  assert.equal(cfg.table.melds[0].bindings[0]?.color, ORANGE);
  assert.equal(cfg.table.melds[1].kind, RUN);
});

test("layout accepts 1 after 13", () => {
  const table = tableOf(run("11N 12N 13N"));
  const rack = parseTiles("1N");
  const one = rack[0];
  const cfg = configurationFromLayout(table, rack, [[...table.melds[0].tiles.map((t) => t.id), one.id]], true);
  assert.deepEqual(new Set(cfg.rackUsed.map((t) => t.id)), new Set([one.id]));
  assert.deepEqual(
    runDisplayOrder(represented(cfg.table.melds[0]).map(([, r]) => r)),
    [11, 12, 13, 1],
  );
});
