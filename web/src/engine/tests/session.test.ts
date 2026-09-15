import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GameEngine } from "../game";
import { createGame, previewPlay, putSession, resetSessions, tickGame, type GameSession } from "../session";
import { parseTiles } from "../tile";
import { run, tableOf } from "./helpers";

afterEach(() => {
  resetSessions();
});

test("spectator game is all bots and ticks", { timeout: 15000 }, async () => {
  const created = await createGame({
    spectator: true,
    botCount: 2,
    difficulties: ["easy", "easy"],
    seed: 42,
    debug: false,
    difficulty: "easy",
    opponents: 1,
  });
  assert.equal(created.spectator, true);
  assert.equal(created.yourTurn, false);
  assert.deepEqual(created.view.isBot, [true, true]);
  assert.deepEqual(created.view.names, ["Easy 1", "Easy 2"]);
  assert.deepEqual(created.steps, []);

  const ticked = await tickGame(created.id);
  assert.ok(ticked.steps.length);
  assert.ok(["draw", "play", "initial", "win"].includes(ticked.steps[0].event?.type ?? ""));
  assert.ok(ticked.view.history.length);
});

test("preview places tiles without ending the turn", async () => {
  const engine = new GameEngine();
  const state = engine.newGame(2, 1, ["You", "Bot"], [null, "easy"]);
  const rack = parseTiles("5R 1A 12N");
  state.players[0].rack = rack;
  state.players[0].hasInitialMeld = true;
  state.table = tableOf(run("2R 3R 4R"));
  state.current = 0;
  const session: GameSession = { state, humanId: 0, debug: false, lastDecision: null, spectator: false };
  putSession("preview", session);

  const body = await previewPlay("preview", [rack[0].id]);
  assert.deepEqual(body.tileIds, [rack[0].id]);
  assert.equal(body.table.melds[0].tiles.length, 4);
  assert.equal(session.state.current, 0);
  assert.equal(session.state.table.melds[0].tiles.length, 3);
  assert.deepEqual(session.state.history, []);
});

test("human game rejects tick on human turn", async () => {
  const created = await createGame({
    difficulty: "easy",
    opponents: 1,
    seed: 7,
    debug: false,
  });
  assert.equal(created.spectator, false);
  if (created.yourTurn) {
    await assert.rejects(() => tickGame(created.id), /not a bot turn/i);
  }
});
