import assert from "node:assert/strict";
import { test } from "node:test";
import { CONFIGS, RummyBot, SeededRng } from "../bot";
import { GameEngine } from "../game";
import { parseTiles, tileStr } from "../tile";
import { group, run, tableOf, viewOf } from "./helpers";

test("bot chooses going out when available", () => {
  const view = viewOf("5R", {
    table: tableOf(run("2R 3R 4R")),
    rackSizes: [1, 8],
    poolSize: 20,
    difficulties: ["extreme", "easy"],
  });
  const move = new RummyBot().chooseMove(view, "hard", true, new SeededRng(1));
  assert.ok(move.config);
  assert.equal(move.config.rackLeft.length, 0);
  assert.ok(move.decision.statesEvaluated >= 1);
});

test("bot only needs player view", () => {
  const engine = new GameEngine();
  const state = engine.newGame(2, 9, undefined, ["easy", "easy"]);
  const view = engine.view(state, 0);
  const hidden = new Set(state.players[1].rack.map((t) => t.id));
  assert.ok([...hidden].every((id) => !view.rack.some((t) => t.id === id)));
  const move = new RummyBot().chooseMove(view, "easy", false, new SeededRng(2));
  assert.ok(move.action === "DRAW" || move.action === "PLAY" || move.config);
});

test("extreme does not skip a simple extension", { timeout: 15000 }, () => {
  const view = viewOf(parseTiles("5R 1A 12N"), {
    table: tableOf(run("2R 3R 4R"), run("8B 9B 10B"), group("7R 7B 7N")),
    rackSizes: [3, 8],
    poolSize: 20,
    difficulties: ["extreme", "easy"],
  });
  const move = new RummyBot().chooseMove(view, "extreme", false, new SeededRng(3));
  assert.ok(move.config);
  assert.ok(move.config.rackUsed.some((t) => tileStr(t) === "5R"));
});

test("extreme must play when the pool is empty", { timeout: 15000 }, () => {
  const view = viewOf(parseTiles("5R 1A 12N"), {
    table: tableOf(run("2R 3R 4R")),
    rackSizes: [3, 5],
    poolSize: 0,
    difficulties: ["extreme", "easy"],
  });
  const move = new RummyBot().chooseMove(view, "extreme", false, new SeededRng(1));
  assert.ok(move.config);
  assert.ok(move.config.rackUsed.some((t) => tileStr(t) === "5R"));
});

test("hard dumps then rearranges in the same turn", { timeout: 15000 }, () => {
  const view = viewOf(parseTiles("6B 6N 7B 7N 10R"), {
    table: tableOf(run("3R 4R 5R 6R"), run("7R 8R 9R"), group("5B 5N 5A")),
    rackSizes: [5, 8],
    poolSize: 20,
    difficulties: ["hard", "easy"],
  });
  const easy = new RummyBot().chooseMove(view, "easy", false, new SeededRng(1));
  const hard = new RummyBot().chooseMove(view, "hard", false, new SeededRng(1));
  assert.ok(easy.config);
  assert.ok(easy.config.rackUsed.length < 5);
  assert.ok(hard.config);
  assert.equal(hard.config.rackUsed.length, 5);
  assert.equal(hard.config.rackLeft.length, 0);
});

test("easy and hard use different solver modes", () => {
  assert.equal(CONFIGS.easy.solverMode, "add_only");
  assert.equal(CONFIGS.hard.solverMode, "full");
  assert.ok(CONFIGS.extreme.timeLimitMs > CONFIGS.easy.timeLimitMs);
  assert.ok(CONFIGS.easy.randomness > CONFIGS.extreme.randomness);
});
