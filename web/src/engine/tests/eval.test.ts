import assert from "node:assert/strict";
import { test } from "node:test";
import { OpponentModel, RummyBot, SeededRng, StateEvaluator } from "../bot";
import { makeGroup, makeRun, tryMakeMeld } from "../validator";
import { BLACK, BLUE, ORANGE, RED, jokerTile, numberedTile, parseTiles, tileStr } from "../tile";
import { configOf, group, run, tableOf, viewOf } from "./helpers";

test("going out dominates", () => {
  const view = viewOf("5R 6R 7R");
  const evaluator = new StateEvaluator();
  const leftover = configOf(tableOf(run("5R 6R 7R")), parseTiles("5R 6R 7R"));
  const keep = configOf(tableOf(run("5R 6R 7R")), parseTiles("5R 6R"), parseTiles("7R"));
  const out = evaluator.evaluatePlay(view, leftover);
  const held = evaluator.evaluatePlay(view, keep);
  assert.ok(out.total > held.total);
  assert.ok("rummikub" in out.terms);
});

test("open group and short run score the same table flex", () => {
  const evaluator = new StateEvaluator();
  const withGroup = evaluator.evaluateView(viewOf("1A", { table: tableOf(group("10R 10B 10N")) }));
  const withRun = evaluator.evaluateView(viewOf("1A", { table: tableOf(run("10R 11R 12R")) }));
  assert.equal(withGroup.terms.table_flexibility, withRun.terms.table_flexibility);
});

test("flexible hand beats isolated at same size", () => {
  const evaluator = new StateEvaluator();
  const flexScore = evaluator.evaluateView(viewOf("4R 5R 6R 7R 5B 5N 8R 9R"));
  const isoScore = evaluator.evaluateView(viewOf("13R 1B 12N 2A 10B 11N 3A 9N"));
  assert.ok(flexScore.total > isoScore.total);
  assert.ok(flexScore.terms.flexibility > isoScore.terms.flexibility);
});

test("gifting a hot run end scores worse than a quiet extension", () => {
  const evaluator = new StateEvaluator();
  const table = tableOf(run("2R 3R 4R"), run("8B 9B 10B"));
  const rack = parseTiles("5R 11B");
  const view = viewOf(rack, { table, rackSizes: [2, 4], poolSize: 20 });
  const belief = OpponentModel.fromView(view, 1);
  belief.addHeat(RED, 6, 8);
  const gift = configOf(tableOf(run("2R 3R 4R 5R"), run("8B 9B 10B")), [rack[0]], [rack[1]]);
  const safe = configOf(tableOf(run("2R 3R 4R"), run("8B 9B 10B 11B")), [rack[1]], [rack[0]]);
  const giftScore = evaluator.evaluatePlay(view, gift, belief);
  const safeScore = evaluator.evaluatePlay(view, safe, belief);
  assert.ok(safeScore.total > giftScore.total);
  assert.ok((giftScore.terms.opponent_blocking ?? 0) < (safeScore.terms.opponent_blocking ?? 0));
});

test("dumping a connector from your own set scores worse than keeping it", () => {
  const evaluator = new StateEvaluator();
  const table = tableOf(run("2R 3R 4R"), run("8B 9B 10B"));
  const rack = parseTiles("4R 5R 6R 11B");
  const five = rack.find((t) => tileStr(t) === "5R")!;
  const eleven = rack.find((t) => tileStr(t) === "11B")!;
  const leftoverDump = rack.filter((t) => t.id !== five.id);
  const leftoverKeep = rack.filter((t) => t.id !== eleven.id);
  const view = viewOf(rack, { table, rackSizes: [4, 10], poolSize: 20 });
  const dump = configOf(tableOf(run("2R 3R 4R 5R"), run("8B 9B 10B")), [five], leftoverDump);
  const keep = configOf(tableOf(run("2R 3R 4R"), run("8B 9B 10B 11B")), [eleven], leftoverKeep);
  const dumpScore = evaluator.evaluatePlay(view, dump);
  const keepScore = evaluator.evaluatePlay(view, keep);
  assert.ok(keepScore.total > dumpScore.total);
  assert.ok((dumpScore.terms.self_connectors ?? 0) < 0);
});

test("spending the only joker with a long leftover loses to a numbered extension", () => {
  const evaluator = new StateEvaluator();
  const table = tableOf(run("2R 3R 4R"));
  const rack = parseTiles("J 5R 1B 8N 12A 3A 9B 11N 13A");
  const joker = rack[0];
  const five = rack.find((t) => tileStr(t) === "5R")!;
  const view = viewOf(rack, { table, rackSizes: [9, 10], poolSize: 20 });
  const jokerMeld = tryMakeMeld([...table.melds[0].tiles, joker]);
  const spend = configOf({ melds: [jokerMeld] }, [joker], rack.filter((t) => t.id !== joker.id));
  const numbered = configOf(tableOf(run("2R 3R 4R 5R")), [five], rack.filter((t) => t.id !== five.id));
  const spendScore = evaluator.evaluatePlay(view, spend);
  const numberedScore = evaluator.evaluatePlay(view, numbered);
  assert.ok(numberedScore.total > spendScore.total);
  assert.ok((spendScore.terms.joker_spend ?? 0) < 0);
});

test("dumping a ready meld beats drawing", { timeout: 20000 }, () => {
  const table = tableOf(
    makeRun([numberedTile(BLACK, 12), numberedTile(BLACK, 13), numberedTile(BLACK, 1)]),
    makeGroup([numberedTile(RED, 10), numberedTile(BLACK, 10), numberedTile(ORANGE, 10)]),
    makeGroup(
      [numberedTile(RED, 2), numberedTile(BLUE, 2), jokerTile(0)],
      [{ jokerId: jokerTile(0).id, color: BLACK, rank: 2 }],
    ),
  );
  const rack = [
    numberedTile(RED, 3), numberedTile(RED, 5), numberedTile(RED, 6),
    numberedTile(RED, 7), numberedTile(RED, 8), numberedTile(RED, 13),
    numberedTile(BLUE, 3), numberedTile(BLUE, 5), numberedTile(BLUE, 6),
    numberedTile(BLUE, 12), numberedTile(BLUE, 13),
    numberedTile(BLACK, 1, 1), numberedTile(BLACK, 2), numberedTile(BLACK, 4),
    numberedTile(BLACK, 5), numberedTile(BLACK, 6), numberedTile(BLACK, 7),
    numberedTile(BLACK, 8), numberedTile(BLACK, 11), numberedTile(BLACK, 12, 1),
    numberedTile(ORANGE, 2), numberedTile(ORANGE, 4), numberedTile(ORANGE, 4, 1),
    numberedTile(ORANGE, 6), numberedTile(ORANGE, 7), numberedTile(ORANGE, 9),
    numberedTile(ORANGE, 10, 1),
  ];
  const view = viewOf(rack, {
    table,
    rackSizes: [27, 5],
    poolSize: 20,
    difficulties: ["extreme", "easy"],
  });
  const evaluator = new StateEvaluator();
  const draw = evaluator.evaluateDraw(view, null);
  const move = new RummyBot().chooseMove(view, "extreme", false, new SeededRng(1));
  assert.ok(move.config, "Extreme must dump ready melds instead of drawing");
  const play = evaluator.evaluatePlay(view, move.config);
  assert.ok(play.total > draw.total);
  assert.ok(move.config.rackUsed.length >= 3);
});
