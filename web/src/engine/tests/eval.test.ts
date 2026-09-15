import assert from "node:assert/strict";
import { test } from "node:test";
import { RummyBot, SeededRng, StateEvaluator } from "../bot";
import { makeGroup, makeRun } from "../validator";
import { BLACK, BLUE, ORANGE, RED, jokerTile, numberedTile, parseTiles } from "../tile";
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
