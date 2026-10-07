import assert from "node:assert/strict";
import { test } from "node:test";
import { SeededRng } from "../bot";
import type { GameState } from "../game";
import { buildDeck } from "../tile";
import {
  clientError,
  createRoom,
  dispatchSocket,
  drawFor,
  indexesToClose,
  joinRoom,
  nextRoundFor,
  payloadFor,
  RoomError,
  setConnected,
  seatIndex,
  syncFor,
  type RoomSnapshot,
} from "../../online/room";
import type { GamePayload, GameView } from "../../types";

function visibleIds(payload: GamePayload): Set<number> {
  const ids = new Set<number>();
  const take = (view: GameView) => {
    for (const tile of view.rack) ids.add(tile.id);
    for (const meld of view.table.melds) for (const tile of meld.tiles) ids.add(tile.id);
    for (const event of view.history) for (const tile of event.tilesFromRack) ids.add(tile.id);
  };
  take(payload.view);
  for (const step of payload.steps ?? []) take(step.view);
  return ids;
}

function hiddenRack(room: RoomSnapshot, seat: number): number[] {
  return room.state?.players[seat].rack.map((tile) => tile.id) ?? [];
}

test("two humans hide racks and the shuffle seed", () => {
  const opened = createRoom({
    hostName: "Ana",
    seats: [{ kind: "human" }, { kind: "human" }],
    code: "mesa1",
    seed: 424242,
  });
  assert.equal(opened.room.phase, "lobby");
  assert.equal(opened.room.state, null);
  const waiting = syncFor(opened.room, opened.token);
  assert.equal(waiting.payload, null);
  assert.equal(waiting.waiting?.seats[1].filled, false);
  assert.equal(JSON.stringify(waiting).includes("424242"), false);

  const guest = joinRoom(opened.room, "Luis");
  assert.equal(opened.room.phase, "playing");
  const state = opened.room.state;
  if (!state) throw new Error("expected a game");
  assert.equal(state.seed, 424242);

  const hostView = payloadFor(opened.room, opened.token);
  const guestView = payloadFor(opened.room, guest.token);
  assert.equal(hostView.view.seed, null);
  assert.equal(guestView.view.seed, null);
  assert.equal(hostView.lastDecision, null);
  assert.equal(JSON.stringify(hostView).includes('"seed":424242'), false);
  assert.equal(JSON.stringify(guestView).includes('"seed":424242'), false);
  assert.equal(hostView.yourTurn, true);
  assert.equal(guestView.yourTurn, false);

  const hostVisible = visibleIds(hostView);
  for (const id of hiddenRack(opened.room, 1)) assert.equal(hostVisible.has(id), false);
  const guestVisible = visibleIds(guestView);
  for (const id of hiddenRack(opened.room, 0)) assert.equal(guestVisible.has(id), false);

  const again = payloadFor(opened.room, opened.token);
  assert.deepEqual(
    again.view.rack.map((tile) => tile.id),
    hostView.view.rack.map((tile) => tile.id),
  );
});

test("a player cannot act on another turn", () => {
  const opened = createRoom({
    hostName: "Ana",
    seats: [{ kind: "human" }, { kind: "human" }],
    code: "mesa2",
    seed: 5,
  });
  const guest = joinRoom(opened.room, "Luis");
  const history = opened.room.state?.history.length;
  assert.throws(() => drawFor(opened.room, guest.token), /no es tu turno/i);
  assert.equal(opened.room.state?.history.length, history);
  assert.equal(opened.room.state?.current, 0);
  assert.throws(() => payloadFor(opened.room, "no-token"), /token inválido/i);
});

test("a bot plays after the human and its rack stays hidden", { timeout: 15000 }, () => {
  const opened = createRoom({
    hostName: "Ana",
    seats: [{ kind: "human" }, { kind: "bot", difficulty: "easy" }],
    code: "mesa3",
    seed: 11,
  });
  assert.equal(opened.room.phase, "playing");
  assert.equal(opened.room.state?.current, 0);

  const frames = drawFor(opened.room, opened.token);
  assert.ok(frames.length >= 2);
  const state = opened.room.state;
  assert.ok(state);
  assert.ok(state.over || state.current === 0);

  const hostView = payloadFor(opened.room, opened.token, frames);
  assert.equal(hostView.view.seed, null);
  assert.equal(hostView.lastDecision, null);
  assert.equal(JSON.stringify(hostView).includes('"seed":11'), false);
  for (const step of hostView.steps ?? []) assert.equal(step.lastDecision, null);

  const visible = visibleIds(hostView);
  for (const id of hiddenRack(opened.room, 1)) assert.equal(visible.has(id), false);

  const reconnected = payloadFor(opened.room, opened.token);
  assert.deepEqual(
    reconnected.view.rack.map((tile) => tile.id),
    hostView.view.rack.map((tile) => tile.id),
  );
});

function dealtOrder(state: GameState): number[] {
  const ids = state.pool.map((tile) => tile.id);
  for (let i = state.players.length - 1; i >= 0; i -= 1) ids.push(...state.players[i].rack.map((tile) => tile.id));
  return ids;
}

function uint32s(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff) out.push(value);
  else if (Array.isArray(value)) for (const item of value) uint32s(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) uint32s(item, out);
  return out;
}

function matchesSeed(order: number[], seed: number): boolean {
  const shuffled = new SeededRng(seed).shuffle(buildDeck()).map((tile) => tile.id);
  return shuffled.length === order.length && shuffled.every((id, index) => id === order[index]);
}

function assertNotStoredSeed(room: RoomSnapshot): number[] {
  const state = room.state;
  assert.ok(state);
  assert.equal(room.seed, null);
  assert.equal(state.seed, null);
  const order = dealtOrder(state);
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    buildDeck().map((tile) => tile.id).sort((a, b) => a - b),
  );
  for (const seed of new Set(uint32s(room))) assert.equal(matchesSeed(order, seed), false);
  return order;
}

function assertSeatPayload(room: RoomSnapshot, token: string, opponent: number, order: number[]): void {
  const packed = payloadFor(room, token);
  assert.equal(packed.view.seed, null);
  const visible = visibleIds(packed);
  for (const id of hiddenRack(room, opponent)) assert.equal(visible.has(id), false);
  for (const seed of new Set(uint32s(packed))) assert.equal(matchesSeed(order, seed), false);
}

test("online deals are not a stored 32-bit seed", () => {
  const seeded = createRoom({
    hostName: "Ana",
    seats: [{ kind: "human" }, { kind: "bot", difficulty: "easy" }],
    code: "SEED99",
    seed: 99,
  });
  assert.equal(matchesSeed(dealtOrder(seeded.room.state!), 99), true);

  const first = createRoom({
    hostName: "Ana",
    seats: [{ kind: "human" }, { kind: "human" }],
  });
  const second = createRoom({
    hostName: "Ana",
    seats: [{ kind: "human" }, { kind: "human" }],
  });
  assert.equal(first.room.code.length, 8);
  assert.equal(second.room.code.length, 8);
  const firstGuest = joinRoom(first.room, "Luis");
  const secondGuest = joinRoom(second.room, "Luis");
  const firstOrder = assertNotStoredSeed(first.room);
  const secondOrder = assertNotStoredSeed(second.room);
  assert.notDeepEqual(firstOrder, secondOrder);
  assertSeatPayload(first.room, first.token, 1, firstOrder);
  assertSeatPayload(first.room, firstGuest.token, 0, firstOrder);
  assertSeatPayload(second.room, second.token, 1, secondOrder);
  assertSeatPayload(second.room, secondGuest.token, 0, secondOrder);

  const state = first.room.state;
  assert.ok(state);
  state.over = true;
  state.scores = [10, 0];
  const scores = [...state.scores];
  const starter = (state.firstPlayer + 1) % state.players.length;
  nextRoundFor(first.room, first.token);
  assert.equal(first.room.state?.round, 2);
  assert.deepEqual(first.room.state?.scores, scores);
  assert.equal(first.room.state?.current, starter);
  assert.equal(first.room.state?.firstPlayer, starter);
  const nextOrder = assertNotStoredSeed(first.room);
  assertSeatPayload(first.room, first.token, 1, nextOrder);
  assertSeatPayload(first.room, firstGuest.token, 0, nextOrder);
});

test("a command before auth does not change the room, leave invalidates the token, and a second connection closes the first", () => {
  const opened = createRoom({
    hostName: "Ana",
    seats: [{ kind: "human" }, { kind: "human" }],
    code: "mesa4",
    seed: 9,
  });
  const before = structuredClone(opened.room);
  const early = dispatchSocket(opened.room, null, JSON.stringify({ type: "draw", requestId: "req-1" }));
  assert.equal(early.type, "close");
  assert.deepEqual(opened.room, before);

  const guest = joinRoom(opened.room, "Luis");
  const racks = opened.room.state?.players.map((player) => player.rack.map((tile) => tile.id));
  const left = dispatchSocket(opened.room, opened.token, JSON.stringify({ type: "leave" }));
  assert.equal(left.type, "left");
  assert.throws(() => seatIndex(opened.room, opened.token), /token inválido/i);
  assert.throws(() => joinRoom(opened.room, "Otra"), /ya empezó/i);
  assert.deepEqual(
    opened.room.state?.players.map((player) => player.rack.map((tile) => tile.id)),
    racks,
  );
  assert.equal(opened.room.seats[1].token, guest.token);
  assert.equal(opened.room.phase, "playing");

  assert.deepEqual(indexesToClose(["abc", null], 1, "abc"), [0]);
  assert.deepEqual(indexesToClose(["abc", "abc"], 1, "abc"), [0]);
  assert.deepEqual(indexesToClose([null, "abc"], 1, "abc"), []);
});

test("only the host starts the next online round while connected", () => {
  const opened = createRoom({
    hostName: "Ana",
    seats: [{ kind: "human" }, { kind: "human" }],
    code: "mesa6",
    seed: 4,
  });
  const guest = joinRoom(opened.room, "Luis");
  const state = opened.room.state;
  assert.ok(state);
  state.over = true;
  state.scores = [12, 3];
  const racks = state.players.map((player) => player.rack.map((tile) => tile.id));
  assert.throws(() => nextRoundFor(opened.room, guest.token), /Solo el anfitrión puede empezar la ronda siguiente/);
  assert.equal(opened.room.state?.round, 1);
  assert.deepEqual(
    opened.room.state?.players.map((player) => player.rack.map((tile) => tile.id)),
    racks,
  );

  setConnected(opened.room, opened.token, false);
  assert.throws(() => nextRoundFor(opened.room, opened.token), /No podés empezar la ronda siguiente/);
  assert.equal(opened.room.state?.round, 1);
  nextRoundFor(opened.room, guest.token);
  assert.equal(opened.room.state?.round, 2);
  assert.deepEqual(opened.room.state?.scores, [12, 3]);
  assert.equal(opened.room.state?.current, 1);
  assert.equal(opened.room.state?.firstPlayer, 1);
});

test("internal errors stay generic", () => {
  const full = clientError(new RoomError("La sala está llena"));
  assert.equal(full.status, 400);
  assert.equal(full.message, "La sala está llena");
  assert.equal(full.expose, true);

  const exists = clientError(new Error("La sala ya existe"));
  assert.equal(exists.status, 400);
  assert.equal(exists.message, "La sala ya existe");
  assert.equal(exists.expose, true);

  const leaked = clientError(new Error("sqlite failed at /tmp/secret-rack"));
  assert.equal(leaked.status, 500);
  assert.equal(leaked.expose, false);
  assert.equal(leaked.message, "Error interno");
  assert.equal(leaked.message.includes("sqlite"), false);
  assert.equal(leaked.message.includes("secret"), false);
});
