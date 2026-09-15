import assert from "node:assert/strict";
import { test } from "node:test";
import { GameEngine, IllegalMove, type GameState, type Player } from "../game";
import { findPlayForSelectedTiles, TableSolver } from "../solver";
import { allTiles } from "../table";
import { buildDeck, parseTiles, tileStr } from "../tile";
import { validateEntireTable } from "../validator";
import { configOf, run, tableOf } from "./helpers";

function player(partial: Partial<Player> & Pick<Player, "id" | "rack">): Player {
  return {
    name: `P${partial.id}`,
    hasInitialMeld: false,
    isBot: false,
    difficulty: null,
    ...partial,
  };
}

function stateOf(players: Player[], extras: Partial<GameState> = {}): GameState {
  return {
    players,
    pool: extras.pool ?? [],
    table: extras.table ?? { melds: [] },
    current: extras.current ?? 0,
    scores: extras.scores ?? players.map(() => 0),
    seed: extras.seed ?? 0,
    history: extras.history ?? [],
    winner: extras.winner ?? null,
    over: extras.over ?? false,
    emptyPasses: extras.emptyPasses ?? 0,
  };
}

test("new game is reproducible", () => {
  const engine = new GameEngine();
  const a = engine.newGame(2, 12345);
  const b = engine.newGame(2, 12345);
  assert.deepEqual(
    a.players[0].rack.map((t) => t.id),
    b.players[0].rack.map((t) => t.id),
  );
  assert.deepEqual(
    a.pool.map((t) => t.id),
    b.pool.map((t) => t.id),
  );
  assert.equal(a.players[0].rack.length, 14);
  assert.equal(a.pool.length, 106 - 14 * 2);
});

test("tile conservation", () => {
  const state = new GameEngine().newGame(3, 7);
  const ids = [...state.players.flatMap((p) => p.rack), ...state.pool].map((t) => t.id);
  assert.deepEqual([...ids].sort((a, b) => a - b), buildDeck().map((t) => t.id).sort((a, b) => a - b));
});

test("bot view hides other racks and pool", () => {
  const engine = new GameEngine();
  const state = engine.newGame(2, 3);
  const view = engine.view(state, 0);
  assert.deepEqual(
    new Set(view.rack.map((t) => t.id)),
    new Set(state.players[0].rack.map((t) => t.id)),
  );
  assert.equal(view.rackSizes[1], 14);
  assert.equal(view.poolSize, state.pool.length);
  const hidden = new Set(state.players[1].rack.map((t) => t.id));
  assert.ok([...hidden].every((id) => !view.rack.some((t) => t.id === id)));
});

test("play and draw roundtrip", () => {
  const engine = new GameEngine();
  const state = engine.newGame(2, 21);
  const configs = new TableSolver().solve(state.table, state.players[0].rack, {
    mode: "initial",
    maxConfigs: 20,
    timeLimitMs: 400,
  });
  if (!configs.length) {
    const nxt = engine.draw(state);
    assert.equal(nxt.players[0].rack.length, 15);
    assert.equal(nxt.current, 1);
    return;
  }
  const nxt = engine.play(state, configs[0]);
  validateEntireTable(nxt.table);
  assert.equal(nxt.players[0].hasInitialMeld, true);
  assert.equal(nxt.current, 1);
});

test("cannot return table tiles to rack", () => {
  const engine = new GameEngine();
  const rack = parseTiles("4R 5B 6N");
  const state = stateOf(
    [
      player({ id: 0, name: "P0", rack, hasInitialMeld: true }),
      player({ id: 1, name: "P1", rack: parseTiles("7A 8A 9A"), hasInitialMeld: true }),
    ],
    { table: tableOf(run("1R 2R 3R")) },
  );
  const forged = configOf({ melds: [] }, [rack[0]], rack.slice(1));
  assert.throws(() => engine.play(state, forged), (err: Error) => {
    assert.ok(err instanceof IllegalMove);
    assert.match(err.message, /cannot return/i);
    return true;
  });
});

test("engine rejects joker on initial meld", () => {
  const engine = new GameEngine();
  const opening = run("10R 11R J");
  const leftover = parseTiles("1A 2A");
  const rack = [...opening.tiles, ...leftover];
  const state = stateOf([
    player({ id: 0, name: "P0", rack, hasInitialMeld: false }),
    player({ id: 1, name: "P1", rack: parseTiles("7A 8A 9A"), hasInitialMeld: true }),
  ]);
  const forged = configOf({ melds: [opening] }, opening.tiles, leftover, "initial");
  assert.throws(() => engine.play(state, forged), (err: Error) => {
    assert.ok(err instanceof IllegalMove);
    assert.match(err.message, /comodines/);
    return true;
  });
});

test("initial play accepts selected 30-point run with duplicate nearby", () => {
  const engine = new GameEngine();
  const rack = parseTiles(
    "1R 5R 5R 6R 6R 7R 8R 10R 10R 12R 12R 13R 2B 3B 6B " +
      "8B 9B 10B 12B 13B 1N 2N 3N 5N 7N 8N 10N 11N 11N 13N " +
      "1A 1A 3A 3A 4A 6A 8A 10A 11A 11A 12A 13A",
  );
  const elevenCopies = rack.filter((t) => tileStr(t) === "11A");
  const selected = [
    rack.find((t) => tileStr(t) === "10A")!,
    elevenCopies[0],
    rack.find((t) => tileStr(t) === "12A")!,
  ];
  const state = stateOf([
    player({ id: 0, name: "P0", rack, hasInitialMeld: false }),
    player({ id: 1, name: "P1", rack: parseTiles("7A 8A 9A"), hasInitialMeld: true }),
  ]);
  const cfg = findPlayForSelectedTiles(state.table, state.players[0].rack, selected.map((t) => t.id), false);
  const nxt = engine.play(state, cfg);
  assert.equal(nxt.players[0].hasInitialMeld, true);
  assert.deepEqual(
    new Set(allTiles(nxt.table).map((t) => t.id)),
    new Set(selected.map((t) => t.id)),
  );
  assert.ok(nxt.players[0].rack.some((t) => t.id === elevenCopies[1].id));
});
