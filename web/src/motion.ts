import type { GameEvent, GameStep, MeldData, TileData } from "./types";

export type FlyPiece = {
  id: string;
  tile: TileData;
  faceDown: boolean;
  x: number;
  y: number;
  moving: boolean;
  kind?: "table" | "rack";
};

export type PlannedFlight = {
  tile: TileData;
  from: { x: number; y: number };
  to: { x: number; y: number };
  fromRack: boolean;
};

const BACK_TILE: TileData = {
  id: -999,
  isJoker: false,
  label: "",
  color: "black",
  rank: 0,
};

const SHIFT_PX = 12;

export function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function elementTopLeft(selector: string, fallback?: { x: number; y: number }) {
  const el = document.querySelector(selector);
  if (!el) {
    return fallback ?? { x: window.innerWidth / 2 - 27, y: window.innerHeight / 3 };
  }
  const box = el.getBoundingClientRect();
  return { x: box.left, y: box.top };
}

export function anchorPoint(selector: string, fallback?: { x: number; y: number }) {
  const el = document.querySelector(selector);
  if (!el) {
    return fallback ?? { x: window.innerWidth / 2 - 27, y: window.innerHeight / 3 };
  }
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2 - 27, y: box.top + box.height / 2 - 37 };
}

export function tilePoint(tileId: number) {
  return anchorPoint(`[data-tile-id="${tileId}"]`, anchorPoint("[data-anchor='rack']"));
}

export function snapshotTilePoints() {
  const map = new Map<number, { x: number; y: number }>();
  document.querySelectorAll<HTMLElement>("[data-tile-id]").forEach((el) => {
    const id = Number(el.dataset.tileId);
    if (!Number.isFinite(id) || id < 0) return;
    if (el.closest("[data-anchor='rack']")) return;
    const box = el.getBoundingClientRect();
    map.set(id, { x: box.left, y: box.top });
  });
  return map;
}

export function stepBanner(event: GameEvent) {
  const who = event.isBot ? event.playerName : "Vos";
  if (event.type === "draw") {
    return event.drawn ? `${who} roba una ficha del pozo` : `${who} pasa — el pozo está vacío`;
  }
  if (event.type === "play" || event.type === "initial") {
    const n = event.tilesFromRack.length;
    return `${who} baja ${n} ficha${n === 1 ? "" : "s"} a la mesa`;
  }
  if (event.type === "win") {
    return `${who} cierra la ronda`;
  }
  return `${who} juega`;
}

export function flightOrigins(event: GameEvent, viewedPlayerId?: number) {
  const felt = anchorPoint("[data-anchor='felt']");
  const pool = anchorPoint("[data-anchor='pool']");
  const seat = anchorPoint(`[data-anchor='seat-${event.playerId}']`, pool);
  const rack = anchorPoint("[data-anchor='rack']");
  const fromSelf = !event.isBot || event.playerId === viewedPlayerId;
  if (event.type === "draw") {
    return {
      from: pool,
      to: fromSelf ? rack : seat,
      faceDown: !fromSelf,
    };
  }
  return {
    from: fromSelf ? rack : seat,
    to: felt,
    faceDown: !fromSelf,
  };
}

export function piecesForEvent(event: GameEvent): TileData[] {
  if (event.type === "draw") {
    return [{ ...BACK_TILE, id: -Math.abs(Date.now() % 100000) }];
  }
  if (event.tilesFromRack.length) {
    return event.tilesFromRack;
  }
  return [{ ...BACK_TILE, id: -1 }];
}

export function buildFlights(event: GameEvent, viewedPlayerId?: number): { start: FlyPiece[]; end: FlyPiece[] } {
  const { from, to, faceDown } = flightOrigins(event, viewedPlayerId);
  const tiles = piecesForEvent(event);
  const start: FlyPiece[] = [];
  const end: FlyPiece[] = [];
  const fromSelf = !event.isBot || event.playerId === viewedPlayerId;
  tiles.forEach((tile, index) => {
    const origin = event.type === "play" || event.type === "initial"
      ? (fromSelf ? tilePoint(tile.id) : from)
      : from;
    const dest = {
      x: to.x + (index - (tiles.length - 1) / 2) * 28,
      y: to.y + (event.type === "draw" ? 0 : 8),
    };
    const id = `fly-${event.playerId}-${event.type}-${index}-${tile.id}`;
    start.push({ id, tile, faceDown, x: origin.x, y: origin.y, moving: false, kind: "rack" });
    end.push({
      id,
      tile,
      faceDown: event.type === "draw",
      x: dest.x,
      y: dest.y,
      moving: true,
      kind: "rack",
    });
  });
  return { start, end };
}

export function planTablePlayFlights(opts: {
  afterMelds: MeldData[];
  origins: Map<number, { x: number; y: number }>;
  dests: Map<number, { x: number; y: number }>;
  rackIds: Set<number>;
  seat: { x: number; y: number };
  felt: { x: number; y: number };
}): { rearranges: PlannedFlight[]; fromRack: PlannedFlight[] } {
  const rearranges: PlannedFlight[] = [];
  const fromRack: PlannedFlight[] = [];
  opts.afterMelds.forEach((meld, meldIndex) => {
    meld.tiles.forEach((tile, tileIndex) => {
      const to = opts.dests.get(tile.id) ?? {
        x: opts.felt.x + tileIndex * 28,
        y: opts.felt.y + meldIndex * 24,
      };
      if (opts.rackIds.has(tile.id)) {
        const n = fromRack.length;
        fromRack.push({
          tile,
          from: { x: opts.seat.x + (n % 4) * 10, y: opts.seat.y + Math.floor(n / 4) * 8 },
          to,
          fromRack: true,
        });
        return;
      }
      const from = opts.origins.get(tile.id);
      if (!from) return;
      if (Math.hypot(to.x - from.x, to.y - from.y) < SHIFT_PX) return;
      rearranges.push({ tile, from, to, fromRack: false });
    });
  });
  return { rearranges, fromRack };
}

export function flightsFromPlan(plan: PlannedFlight[], moving: boolean): FlyPiece[] {
  return plan.map((item) => ({
    id: `fly-table-${item.tile.id}`,
    tile: item.tile,
    faceDown: item.fromRack && !moving,
    x: moving ? item.to.x : item.from.x,
    y: moving ? item.to.y : item.from.y,
    moving,
    kind: item.fromRack ? "rack" : "table",
  }));
}

export function pileDockPoint(pileId: number) {
  const pile = document.querySelector<HTMLElement>(`[data-pile-id="${pileId}"]`);
  if (!pile) {
    return elementTopLeft("[data-anchor='felt']");
  }
  const tiles = pile.querySelectorAll<HTMLElement>("[data-tile-id]");
  const last = tiles[tiles.length - 1];
  if (last) {
    const box = last.getBoundingClientRect();
    return { x: box.left + Math.min(32, box.width * 0.6), y: box.top };
  }
  const box = pile.getBoundingClientRect();
  return { x: box.left + 18, y: box.top + 22 };
}

export function tileTopLeft(tileId: number) {
  const el = document.querySelector<HTMLElement>(`[data-tile-id="${tileId}"]`);
  if (!el || el.closest("[data-anchor='rack']")) {
    return elementTopLeft("[data-anchor='felt']");
  }
  const box = el.getBoundingClientRect();
  return { x: box.left, y: box.top };
}

export async function waitForPaint() {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

export function landingTileIds(step: GameStep): number[] {
  const event = step.event;
  if (!event || (event.type !== "play" && event.type !== "initial")) {
    return [];
  }
  return event.tilesFromRack.map((tile) => tile.id);
}
