import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRoom,
  drawFor,
  joinRoom,
  payloadFor,
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
