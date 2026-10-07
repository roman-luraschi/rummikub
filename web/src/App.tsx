import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createGame, drawTile, nextRound, playTiles, previewPlay, tickGame } from "./localApi";
import {
  clearOnlineSession,
  connectRoom,
  createOnlineRoom,
  joinOnlineRoom,
  loadOnlineSession,
  saveOnlineSession,
  type RoomConnection,
} from "./online/client";
import { previewSelection } from "./online/preview";
import type { WaitingInfo } from "./online/protocol";
import { mayStartNextRound } from "./online/room";
import {
  buildFlights,
  elementTopLeft,
  flightsFromPlan,
  landingTileIds,
  pileDockPoint,
  sleep,
  stepBanner,
  tileTopLeft,
  waitForPaint,
  type FlyPiece,
} from "./motion";
import ResultModal from "./ResultModal";
import StartMenu, { type GameSetup, type OnlineCreate } from "./StartMenu";
import TileView from "./Tile";
import {
  applyDrop,
  bindMeldsToPiles,
  classifyPile,
  clonePiles,
  committedSignature,
  dropFromPoint,
  insertIndexForMeld,
  insertTileInPile,
  layoutSignature,
  newPile,
  pileTileIds,
  pilesFromMelds,
  reconcilePiles,
  removeTileFromPiles,
  type DragOrigin,
  type DragState,
  type DropTarget,
  type Pile,
} from "./tableDraft";
import type { GamePayload, GameStep, TileData } from "./types";

const EXTREME_TURN_SECONDS = 60;

function tileGroupKey(tiles: { id: number }[]) {
  return [...tiles.map((tile) => tile.id)].sort((a, b) => a - b).join(",");
}

function unfinishedPileIds(current: Pile[], committed: Parameters<typeof classifyPile>[1] = []) {
  return current
    .filter((pile) => {
      const kind = classifyPile(pile.tiles, committed).kind;
      return kind !== "group" && kind !== "run";
    })
    .map((pile) => pile.id);
}

const actionBtn = "w-full sm:w-auto";

function FaceDownRow({ count, compact, anchor }: { count: number; compact?: boolean; anchor?: string }) {
  const n = Math.min(count, compact ? 10 : 14);
  return (
    <div className="facedown-row" aria-label={`${count} fichas ocultas`} data-anchor={anchor}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="facedown-slot" style={{ zIndex: i }}>
          <TileView tile={{ id: -i, isJoker: false, label: "", color: "black", rank: 0 }} faceDown size="sm" />
        </div>
      ))}
      {count > n && <span className="ml-2 text-[13px] opacity-75">+{count - n}</span>}
    </div>
  );
}

function PoolPile({ count }: { count: number }) {
  const n = Math.min(count, 5);
  return (
    <div className="pool-pile" data-anchor="pool" aria-label={`${count} fichas en el pozo`}>
      {n === 0 ? (
        <div className="pool-empty" />
      ) : (
        Array.from({ length: n }, (_, i) => (
          <div key={i} className="pool-layer" style={{ zIndex: i, ["--i" as string]: i }}>
            <TileView tile={{ id: -i - 1, isJoker: false, label: "", color: "black", rank: 0 }} faceDown size="sm" />
          </div>
        ))
      )}
    </div>
  );
}

export default function App() {
  const [setup, setSetup] = useState<GameSetup>({
    mode: "play",
    difficulty: "hard",
    opponents: 1,
    botCount: 2,
    botDifficulties: ["hard", "hard"],
    seed: "",
  });
  const [game, setGame] = useState<GamePayload | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [flights, setFlights] = useState<FlyPiece[]>([]);
  const [hiddenIds, setHiddenIds] = useState<number[]>([]);
  const [landingIds, setLandingIds] = useState<number[]>([]);
  const [banner, setBanner] = useState("");
  const [dealing, setDealing] = useState(false);
  const [hideFrom, setHideFrom] = useState<{ seat?: number; pool?: boolean; count: number } | null>(null);
  const [piles, setPiles] = useState<Pile[]>([]);
  const [rejectedPlay, setRejectedPlay] = useState<{ layout: string; ids: number[] } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<DropTarget | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [turnLeft, setTurnLeft] = useState<number | null>(null);
  const [waiting, setWaiting] = useState<WaitingInfo | null>(null);
  const [onlineOn, setOnlineOn] = useState(false);
  const [reconnecting, setReconnecting] = useState(() => loadOnlineSession() != null);
  const [linkCode] = useState(() => new URLSearchParams(window.location.search).get("room")?.trim().toUpperCase() ?? "");
  const [leftOpen, setLeftOpen] = useState(false);
  const gameRef = useRef<GamePayload | null>(null);
  const pilesRef = useRef<Pile[]>([]);
  const lastGameId = useRef<string | null>(null);
  const playGen = useRef(0);
  const timedOut = useRef(false);
  const onlineRef = useRef<RoomConnection | null>(null);
  const onlineActive = useRef(false);
  const busyRef = useRef(false);
  const busyToken = useRef(0);
  const queuedRemote = useRef<{ payload: GamePayload; deal: boolean } | null>(null);
  const handlersRef = useRef({
    apply: (_payload: GamePayload, _deal: boolean) => {},
    fail: (_message: string) => {},
  });
  gameRef.current = game;
  pilesRef.current = piles;

  const view = game?.view;
  const spectator = Boolean(game?.spectator);
  const canAct = Boolean(game && game.yourTurn && !view?.over && !busy && !spectator);
  const abandonedSeats = game?.abandoned;
  const connectedSeats = game?.connected;
  const firstHuman = view
    ? view.isBot.findIndex((bot, index) => !bot && !abandonedSeats?.[index] && (connectedSeats ? Boolean(connectedSeats[index]) : true))
    : -1;
  const offerNextRound = Boolean(
    view &&
      view.over &&
      !view.matchOver &&
      !game?.opponentLeft &&
      mayStartNextRound({
        online: onlineOn,
        seat: view.playerId,
        hostConnected: Boolean(connectedSeats?.[0]) && !abandonedSeats?.[0],
        selfConnected: onlineOn ? Boolean(connectedSeats?.[view.playerId]) : true,
        isBot: view.isBot[view.playerId],
        hostAbandoned: Boolean(abandonedSeats?.[0]),
        selfAbandoned: Boolean(abandonedSeats?.[view.playerId]),
        firstHuman: firstHuman >= 0 ? firstHuman : undefined,
      }),
  );
  const timedTurn = Boolean(
    !onlineOn && !spectator && view && !view.over && view.difficulties.some((difficulty) => difficulty === "extreme")
  );
  const committedIds = useMemo(
    () => new Set(view?.table.melds.flatMap((meld) => meld.tiles.map((tile) => tile.id)) ?? []),
    [view?.table.hash]
  );
  const hasOpened = Boolean(view && view.hasInitialMeld[view.playerId]);
  const onTableIds = useMemo(() => pileTileIds(piles), [piles]);
  const rackTiles = view?.rack.filter((tile) => !onTableIds.has(tile.id)) ?? [];
  const dirty = Boolean(view && layoutSignature(piles) !== committedSignature(view.table.melds));
  const committedMelds = view?.table.melds ?? [];
  const tableReady =
    piles.length > 0 &&
    piles.every((pile) => {
      const kind = classifyPile(pile.tiles, committedMelds).kind;
      return kind === "group" || kind === "run";
    });
  const canFinishTurn = Boolean(canAct && dirty);
  const pileLayout = layoutSignature(piles);
  const rejectedIds = rejectedPlay?.layout === pileLayout ? rejectedPlay.ids : [];

  useEffect(() => {
    if (!view) {
      setPiles([]);
      lastGameId.current = null;
      return;
    }
    const isNewGame = lastGameId.current !== game?.id;
    lastGameId.current = game?.id ?? null;
    if (isNewGame) {
      setPiles(pilesFromMelds(view.table.melds));
      return;
    }
    setPiles((current) => reconcilePiles(current, view.table.melds));
  }, [view?.table.hash, game?.id]);

  useEffect(() => {
    setResultOpen(Boolean(view?.over));
  }, [game?.id, view?.over]);

  useEffect(() => {
    if (game?.opponentLeft) setLeftOpen(true);
  }, [game?.id, game?.opponentLeft]);

  const status = useMemo(() => {
    if (!view) return "Elegí dificultad y empezá una partida.";
    if (game?.opponentLeft) return "Se desconectó un contrincante. La partida terminó.";
    if (view.over) {
      if (view.matchOver && view.winner != null) {
        return `Partida terminada. Gana ${view.names[view.winner]} con ${view.scores[view.winner]} puntos.`;
      }
      if (view.winner == null) return `Ronda ${view.round} empatada. Nadie suma. Se juega hasta 500.`;
      return `Ronda ${view.round}: ${view.names[view.winner]} suma ${view.roundPoints[view.winner]}. Se juega hasta 500.`;
    }
    return game?.yourTurn
      ? dirty
        ? "Tu turno sigue: bajá más fichas o rearmá la mesa. Confirmá cuando termines."
        : "Tu turno — bajá lo obvio, rearmá si hace falta, y confirmá para cerrar."
      : spectator
        ? `Viendo: juega ${view.names[view.current]}.`
        : `Espera: juega ${view.names[view.current]}.`;
  }, [game, view, spectator, dirty]);

  async function animateOpponentTablePlay(step: GameStep, event: NonNullable<GameStep["event"]>) {
    setBanner(`${event.playerName} está pensando…`);
    await sleep(320);

    const viewingActor = event.playerId === gameRef.current?.view.playerId;
    const rackIds = new Set(event.tilesFromRack.map((tile) => tile.id));
    const afterMelds = step.view.table.melds;
    let pilesNow = clonePiles(
      pilesRef.current.length ? pilesRef.current : pilesFromMelds(gameRef.current?.view.table.melds ?? [])
    );
    const afterToPile = bindMeldsToPiles(pilesNow, afterMelds);

    flushSync(() => {
      setPiles(pilesNow);
      setHideFrom(viewingActor ? null : { seat: event.playerId, count: 0 });
      setGame((current) =>
        current
          ? {
            ...current,
            yourTurn: false,
            lastDecision: step.lastDecision ?? current.lastDecision,
          }
          : current
      );
    });

    const tableMoves: { tile: (typeof pilesNow)[0]["tiles"][0]; meldIdx: number; destIndex: number }[] = [];
    for (const pile of pilesNow) {
      for (const tile of pile.tiles) {
        if (rackIds.has(tile.id)) continue;
        const meldIdx = afterMelds.findIndex((meld) => meld.tiles.some((item) => item.id === tile.id));
        if (meldIdx < 0) continue;
        const destPileId = afterToPile[meldIdx];
        if (destPileId === pile.id) continue;
        tableMoves.push({
          tile,
          meldIdx,
          destIndex: afterMelds[meldIdx].tiles.findIndex((item) => item.id === tile.id),
        });
      }
    }
    tableMoves.sort((a, b) => a.meldIdx - b.meldIdx || a.destIndex - b.destIndex);

    if (tableMoves.length) {
      setBanner(`${event.playerName} mueve fichas entre los juegos`);
    }

    for (const move of tableMoves) {
      if (afterToPile[move.meldIdx] < 0) {
        const created = newPile([]);
        afterToPile[move.meldIdx] = created.id;
        pilesNow = [...pilesNow, created];
        flushSync(() => setPiles(pilesNow));
        await waitForPaint();
      }
      const destPileId = afterToPile[move.meldIdx];
      const from = tileTopLeft(move.tile.id);
      pilesNow = removeTileFromPiles(pilesNow, move.tile.id).filter(
        (pile) => pile.tiles.length > 0 || pile.id === destPileId
      );
      flushSync(() => setPiles(pilesNow));
      await waitForPaint();
      const to = pileDockPoint(destPileId);
      flushSync(() => setFlights(flightsFromPlan([{ tile: move.tile, from, to, fromRack: false }], false)));
      await waitForPaint();
      await sleep(24);
      flushSync(() => setFlights(flightsFromPlan([{ tile: move.tile, from, to, fromRack: false }], true)));
      await sleep(420);
      const destPile = pilesNow.find((pile) => pile.id === destPileId);
      const at = insertIndexForMeld(destPile, afterMelds[move.meldIdx], move.tile.id);
      pilesNow = insertTileInPile(pilesNow, destPileId, move.tile, at).filter((pile) => pile.tiles.length > 0);
      flushSync(() => {
        setPiles(pilesNow);
        setFlights([]);
        setLandingIds([move.tile.id]);
      });
      await sleep(70);
      setLandingIds([]);
    }

    const rackTiles = event.tilesFromRack;
    if (rackTiles.length) {
      setBanner(stepBanner(event, gameRef.current?.view.playerId));
    }
    const seat = viewingActor
      ? elementTopLeft("[data-anchor='rack']")
      : elementTopLeft(`[data-anchor='seat-${event.playerId}']`, elementTopLeft("[data-anchor='pool']"));

    for (const tile of rackTiles) {
      const meldIdx = afterMelds.findIndex((meld) => meld.tiles.some((item) => item.id === tile.id));
      if (meldIdx < 0) continue;
      if (afterToPile[meldIdx] < 0) {
        const created = newPile([]);
        afterToPile[meldIdx] = created.id;
        pilesNow = [...pilesNow, created];
        flushSync(() => setPiles(pilesNow));
        await waitForPaint();
      }
      const destPileId = afterToPile[meldIdx];
      const from = seat;
      const to = pileDockPoint(destPileId);
      if (!viewingActor) {
        setHideFrom((current) =>
          current ? { ...current, count: current.count + 1 } : { seat: event.playerId, count: 1 }
        );
      }
      flushSync(() => setFlights(flightsFromPlan([{ tile, from, to, fromRack: true }], false)));
      await waitForPaint();
      await sleep(24);
      flushSync(() => setFlights(flightsFromPlan([{ tile, from, to, fromRack: true }], true)));
      await sleep(420);
      const destPile = pilesNow.find((pile) => pile.id === destPileId);
      const at = insertIndexForMeld(destPile, afterMelds[meldIdx], tile.id);
      pilesNow = insertTileInPile(pilesNow, destPileId, tile, at).filter((pile) => pile.tiles.length > 0);
      flushSync(() => {
        setPiles(pilesNow);
        setFlights([]);
        setLandingIds([tile.id]);
      });
      await sleep(70);
      setLandingIds([]);
    }

    setFlights([]);
    setHiddenIds([]);
    setHideFrom(null);
    setLandingIds(rackTiles.map((tile) => tile.id));
    setGame((current) =>
      current
        ? {
          ...current,
          view: step.view,
          yourTurn: step.yourTurn,
          lastDecision: step.lastDecision ?? current.lastDecision,
        }
        : current
    );
    await sleep(220);
    setLandingIds([]);
  }

  async function animateStep(step: GameStep) {
    const event = step.event;
    if (!event || event.type === "win") {
      setLandingIds(landingTileIds(step));
      setGame((current) =>
        current
          ? { ...current, view: step.view, yourTurn: step.yourTurn, lastDecision: step.lastDecision }
          : current
      );
      return;
    }

    const viewerId = gameRef.current?.view.playerId;
    const humanSelf = viewerId != null && event.playerId === viewerId && !event.isBot;

    if (humanSelf && (event.type === "play" || event.type === "initial")) {
      setLandingIds(landingTileIds(step));
      setGame((current) =>
        current
          ? {
            ...current,
            view: step.view,
            yourTurn: step.yourTurn,
            lastDecision: step.lastDecision ?? current.lastDecision,
          }
          : current
      );
      await sleep(280);
      setLandingIds([]);
      return;
    }

    if (!humanSelf && (event.type === "play" || event.type === "initial")) {
      await animateOpponentTablePlay(step, event);
      return;
    }

    if (event.isBot) {
      setBanner(`${event.playerName} está pensando…`);
      await sleep(320);
    }

    setBanner(stepBanner(event, gameRef.current?.view.playerId));

    if (event.type === "draw" && !event.drawn) {
      await sleep(520);
      setGame((current) =>
        current
          ? { ...current, view: step.view, yourTurn: step.yourTurn, lastDecision: step.lastDecision ?? current.lastDecision }
          : current
      );
      return;
    }

    const viewingActor = event.playerId === gameRef.current?.view.playerId;
    if (event.type === "draw") {
      setHideFrom({ pool: true, count: 1 });
    } else if (!viewingActor) {
      setHideFrom({ seat: event.playerId, count: Math.max(1, event.tilesFromRack.length) });
    } else {
      setHiddenIds(event.tilesFromRack.map((tile) => tile.id));
    }

    const { start, end } = buildFlights(event, gameRef.current?.view.playerId);
    flushSync(() => setFlights(start));
    await waitForPaint();
    await sleep(50);
    flushSync(() => setFlights(end));
    await sleep(Math.min(1100, 720 + start.length * 90));
    setFlights([]);
    setHiddenIds([]);
    setHideFrom(null);

    const drawnIds =
      event.type === "draw" && event.playerId === gameRef.current?.view.playerId
        ? step.view.rack
          .filter((tile) => !(gameRef.current?.view.rack.some((current) => current.id === tile.id)))
          .map((tile) => tile.id)
        : landingTileIds(step);
    setLandingIds(drawnIds);
    setGame((current) =>
      current
        ? {
          ...current,
          view: step.view,
          yourTurn: step.yourTurn,
          lastDecision: step.lastDecision ?? current.lastDecision,
        }
        : current
    );
    await sleep(280);
    setLandingIds([]);
  }

  async function applyPayload(payload: GamePayload, opts?: { deal?: boolean }) {
    const gen = playGen.current;
    const steps = payload.steps ?? [];
    if (opts?.deal) {
      setDealing(true);
      setGame({ ...payload, yourTurn: false });
      await sleep(980);
      if (playGen.current !== gen) return;
      setDealing(false);
      if (steps.length) {
        for (const step of steps) {
          if (playGen.current !== gen) return;
          await animateStep(step);
        }
      }
      if (playGen.current !== gen) return;
      setBanner("");
      setGame(payload);
      return;
    }
    if (!steps.length || !gameRef.current) {
      setGame(payload);
      return;
    }
    setGame({ ...gameRef.current, yourTurn: false, lastDecision: payload.lastDecision });
    for (const step of steps) {
      if (playGen.current !== gen) return;
      await animateStep(step);
    }
    if (playGen.current !== gen) return;
    setBanner("");
    setGame(payload);
  }

  async function withBusy(fn: () => Promise<void>) {
    if (busyRef.current) return;
    const op = ++busyToken.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err: unknown) {
      if (busyToken.current !== op) return;
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      if (busyToken.current !== op) return;
      busyRef.current = false;
      setBusy(false);
      setBanner("");
      setFlights([]);
      setHiddenIds([]);
      setHideFrom(null);
      const queued = queuedRemote.current;
      queuedRemote.current = null;
      if (queued) void applyPayload(queued.payload, { deal: queued.deal });
    }
  }

  handlersRef.current = {
    apply: (payload, deal) => {
      setReconnecting(false);
      setWaiting(null);
      if (busyRef.current) {
        queuedRemote.current = { payload, deal };
        return;
      }
      void applyPayload(payload, { deal });
    },
    fail: (message) => {
      setReconnecting(false);
      setError(message);
    },
  };

  function attach(creds: { code: string; token: string; seat: number }) {
    onlineRef.current?.close();
    onlineActive.current = true;
    setOnlineOn(true);
    saveOnlineSession(creds);
    onlineRef.current = connectRoom(creds, {
      onWelcome: (message) => {
        if (message.payload) {
          handlersRef.current.apply(message.payload, message.payload.view.history.length === 0);
          return;
        }
        setReconnecting(false);
        setWaiting(message.waiting);
      },
      onState: (payload) => handlersRef.current.apply(payload, !gameRef.current),
      onWaiting: (info) => {
        setReconnecting(false);
        setWaiting(info);
      },
      onError: (message) => handlersRef.current.fail(message),
      onClose: () => {
        if (!onlineActive.current) return;
        handlersRef.current.fail("Se cortó la conexión. Recargá para volver a la sala.");
      },
    });
  }

  const attachRef = useRef(attach);
  attachRef.current = attach;

  useEffect(() => {
    const stored = loadOnlineSession();
    const link = new URLSearchParams(window.location.search).get("room")?.trim().toUpperCase() ?? "";
    if (stored && (!link || stored.code === link)) attachRef.current(stored);
    else setReconnecting(false);
    if (stored && link && stored.code !== link) clearOnlineSession();
    return () => {
      onlineActive.current = false;
      onlineRef.current?.close();
      onlineRef.current = null;
    };
  }, []);

  async function onStart() {
    playGen.current += 1;
    setAutoplay(setup.mode === "spectate");
    await withBusy(async () => {
      const payload = await createGame({
        difficulty: setup.difficulty,
        opponents: setup.opponents,
        debug: false,
        seed: setup.seed ? Number(setup.seed) : undefined,
        spectator: setup.mode === "spectate",
        botCount: setup.botCount,
        difficulties: setup.mode === "spectate" ? setup.botDifficulties : undefined,
      });
      setSelected([]);
      await applyPayload(payload, { deal: true });
    });
  }

  async function onTick() {
    if (!game?.spectator || !view || view.over) return;
    await withBusy(async () => {
      const payload = await tickGame(game.id);
      await applyPayload(payload);
    });
  }

  async function onNextRound() {
    if (busyRef.current) return;
    if (!game || !view?.over || view.matchOver) return;
    playGen.current += 1;
    await withBusy(async () => {
      const payload = onlineRef.current ? await onlineRef.current.nextRound() : await nextRound(game.id);
      setSelected([]);
      await applyPayload(payload, { deal: true });
    });
  }

  useEffect(() => {
    if (!game?.spectator || !autoplay || !view || view.over || busy) return;
    const timer = window.setTimeout(() => {
      void onTick();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [game?.id, game?.spectator, view?.current, view?.over, view?.history.length, autoplay, busy]);

  useEffect(() => {
    if (!game?.spectator || !autoplay || !view?.over || view.matchOver || busy) return;
    const timer = window.setTimeout(() => {
      void onNextRound();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [game?.id, game?.spectator, view?.over, view?.matchOver, view?.round, autoplay, busy]);

  function toggleTile(id: number) {
    if (!canAct) return;
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }

  function startDrag(
    tile: TileData,
    origin: DragOrigin,
    event: { preventDefault: () => void; currentTarget: EventTarget; clientX: number; clientY: number; pointerType?: string },
  ) {
    if (!canAct) return;
    if (!hasOpened && committedIds.has(tile.id)) return;
    const allowRackScroll = origin.place === "rack" && event.pointerType === "touch";
    if (!allowRackScroll) event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const pending: DragState = {
      tile,
      origin,
      x: box.left,
      y: box.top,
      offsetX: event.clientX - box.left,
      offsetY: event.clientY - box.top,
    };
    let mode: "pending" | "drag" | "scroll" = "pending";

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (mode === "pending") {
        const dist = Math.hypot(dx, dy);
        if (allowRackScroll) {
          if (dist < 12) return;
          if (Math.abs(dx) >= Math.abs(dy)) {
            mode = "scroll";
            stop();
            return;
          }
        } else if (dist < 7) {
          return;
        }
        mode = "drag";
      }
      ev.preventDefault();
      setDrag({
        ...pending,
        x: ev.clientX - pending.offsetX,
        y: ev.clientY - pending.offsetY,
      });
      setHover(dropFromPoint(ev.clientX, ev.clientY));
    };

    const onUp = (ev: PointerEvent) => {
      stop();
      if (mode !== "drag") {
        if (mode === "pending" && origin.place === "rack") toggleTile(tile.id);
        return;
      }
      const dest = dropFromPoint(ev.clientX, ev.clientY);
      setDrag(null);
      setHover(null);
      const swallow = (click: MouseEvent) => {
        click.preventDefault();
        click.stopPropagation();
        window.removeEventListener("click", swallow, true);
      };
      window.addEventListener("click", swallow, true);
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      if (!dest) return;
      const result = applyDrop(pilesRef.current, tile, origin, dest, committedIds, hasOpened);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError("");
      setPiles(result.piles);
      if (dest.place !== "rack") {
        setSelected((ids) => ids.filter((id) => id !== tile.id));
      }
    };

    const onCancel = () => {
      mode = "scroll";
      stop();
      setDrag(null);
      setHover(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  function resetTable() {
    if (!view) return;
    setPiles(pilesFromMelds(view.table.melds));
    setError("");
  }

  function resetToLobby() {
    playGen.current += 1;
    setAutoplay(false);
    setGame(null);
    setSelected([]);
    setError("");
    setResultOpen(false);
    setPiles([]);
    setBanner("");
    setTurnLeft(null);
    setLeftOpen(false);
  }

  function leaveOnline() {
    onlineActive.current = false;
    onlineRef.current?.leave();
    onlineRef.current = null;
    clearOnlineSession();
    setOnlineOn(false);
    setWaiting(null);
    setReconnecting(false);
    resetToLobby();
  }

  async function onCreateRoom(room: OnlineCreate) {
    await withBusy(async () => {
      const creds = await createOnlineRoom(room);
      attach(creds);
    });
  }

  async function onJoinRoom(code: string, name: string) {
    await withBusy(async () => {
      const creds = await joinOnlineRoom(code, name);
      attach(creds);
    });
  }

  async function onDraw() {
    if (busyRef.current) return;
    if (!game || !view) return;
    const pulledFromRack = view.rack.some((tile) => onTableIds.has(tile.id));
    if (pulledFromRack) {
      setError("Devolvé o confirmá las fichas que bajaste antes de robar.");
      return;
    }
    await withBusy(async () => {
      const payload = onlineRef.current ? await onlineRef.current.draw() : await drawTile(game.id);
      setSelected([]);
      await applyPayload(payload);
    });
  }

  async function onTurnTimeout() {
    if (busyRef.current) return;
    const current = gameRef.current;
    if (!current?.yourTurn || current.view.over || timedOut.current) return;
    timedOut.current = true;
    setDrag(null);
    setHover(null);
    setSelected([]);
    setPiles(pilesFromMelds(current.view.table.melds));
    setError("Se acabó el tiempo: robás del pozo.");
    await withBusy(async () => {
      const payload = onlineRef.current ? await onlineRef.current.draw() : await drawTile(current.id);
      setSelected([]);
      await applyPayload(payload);
    });
  }

  useEffect(() => {
    if (!timedTurn || !canAct) {
      setTurnLeft(null);
      return;
    }
    timedOut.current = false;
    setTurnLeft(EXTREME_TURN_SECONDS);
    const started = Date.now();
    const id = window.setInterval(() => {
      const left = Math.max(0, EXTREME_TURN_SECONDS - (Date.now() - started) / 1000);
      setTurnLeft(left);
      if (left <= 0) {
        window.clearInterval(id);
        if (busyRef.current) return;
        void onTurnTimeout();
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [timedTurn, canAct, game?.id, view?.history.length]);

  async function onPlay() {
    if (busyRef.current) return;
    if (!game) return;
    if (dirty) {
      if (!tableReady) {
        setRejectedPlay({ layout: layoutSignature(piles), ids: unfinishedPileIds(piles, committedMelds) });
        setError("Quedó un juego incompleto o inválido en la mesa.");
        return;
      }
      if (!hasOpened && piles.some((pile) => pile.tiles.some((tile) => tile.isJoker))) {
        setRejectedPlay({
          layout: layoutSignature(piles),
          ids: piles.filter((pile) => pile.tiles.some((tile) => tile.isJoker)).map((pile) => pile.id),
        });
        setError("La apertura de 30 puntos no puede usar comodines.");
        return;
      }
      await withBusy(async () => {
        const melds = piles.filter((pile) => pile.tiles.length).map((pile) => pile.tiles.map((tile) => tile.id));
        try {
          const payload = onlineRef.current
            ? await onlineRef.current.play([], melds)
            : await playTiles(game.id, [], melds);
          setRejectedPlay(null);
          setSelected([]);
          await applyPayload(payload);
        } catch (err) {
          const committed = new Set((view?.table.melds ?? []).map((meld) => tileGroupKey(meld.tiles)));
          const changed = piles
            .filter((pile) => pile.tiles.length > 0 && !committed.has(tileGroupKey(pile.tiles)))
            .map((pile) => pile.id);
          setRejectedPlay({
            layout: layoutSignature(piles),
            ids: changed.length ? changed : piles.filter((pile) => pile.tiles.length > 0).map((pile) => pile.id),
          });
          throw err;
        }
      });
      return;
    }
    if (selected.length === 0) {
      setError("Arrastrá fichas al paño o seleccioná un juego del atril.");
      return;
    }
    if (onlineRef.current) {
      if (!view) return;
      try {
        const preview = previewSelection(view, selected);
        setPiles((current) => reconcilePiles(current, preview.table.melds));
        setSelected([]);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se puede bajar esa selección");
      }
      return;
    }
    await withBusy(async () => {
      const preview = await previewPlay(game.id, selected);
      setPiles((current) => reconcilePiles(current, preview.table.melds));
      setSelected([]);
      setError("");
    });
  }


  const opponents = view?.names
    .map((name, i) => ({ name, i }))
    .filter((item) => item.i !== view.playerId) ?? [];

  if (!game && reconnecting && !waiting) {
    return (
      <div className="felt-surface flex min-h-screen items-center justify-center px-4">
        <p className="font-display text-3xl text-ivory">Conectando…</p>
      </div>
    );
  }

  if (!game) {
    return (
      <StartMenu
        setup={setup}
        onChange={setSetup}
        busy={busy}
        error={error}
        onStart={() => {
          void onStart();
        }}
        onCreateRoom={(room) => {
          void onCreateRoom(room);
        }}
        onJoinRoom={(code, name) => {
          void onJoinRoom(code, name);
        }}
        initialCode={linkCode}
        waiting={waiting}
        onLeave={leaveOnline}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] px-3 pt-4 pb-8 sm:px-[18px] sm:pt-[18px] sm:pb-10">
      <header className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="brand-mark">R</span>
          <div>
            <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.16em] opacity-70">Rummikub</p>
            <h1 className="font-display text-2xl leading-none">Mesa de juego</h1>
          </div>
        </div>
        {view && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="hud-chip rounded-2xl px-3 py-2.5 text-sm">Ronda {view.round} · a 500</span>
            <span className="hud-chip rounded-2xl px-3 py-2.5 text-sm">
              {view.names
                .map((name, index) => `${!spectator && index === view.playerId ? "Vos" : name} ${view.scores[index]}`)
                .join(" · ")}
            </span>
            <span className="hud-chip rounded-2xl px-3 py-2.5 text-sm">Pozo {view.poolSize}</span>
            <span className={`hud-chip rounded-2xl px-3 py-2.5 text-sm ${game?.yourTurn ? "font-extrabold text-gold" : ""}`}>
              {status}
            </span>
          </div>
        )}
      </header>

      {error && <p className="mb-2 text-[#ffb4a8]">{error}</p>}
      {banner && <div className="turn-banner">{banner}</div>}
      {flights.length > 0 && (
        <div className="fly-layer" aria-hidden>
          {flights.map((piece) => (
            <div
              key={piece.id}
              className={`fly-piece${piece.moving ? " is-moving" : ""}${piece.kind === "table" ? " is-table" : ""}`}
              style={{ left: piece.x, top: piece.y }}
            >
              <TileView tile={piece.tile} size="md" faceDown={piece.faceDown} />
            </div>
          ))}
        </div>
      )}
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden>
          <TileView tile={drag.tile} size="md" />
        </div>
      )}

      {view && (
        <div>
          <div className="mb-3.5 grid grid-cols-1 gap-3 md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            {opponents.map(({ name, i }) => (
              <article key={i} className={`opp-card${view.current === i ? " is-active" : ""}`}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-display text-base">{name}</h3>
                  <p className="m-0 text-lg font-extrabold tabular-nums text-gold">{view.scores[i]} pts</p>
                </div>
                <p className="m-0 mb-2 text-[13px] opacity-80">
                  {view.rackSizes[i]} fichas · {view.hasInitialMeld[i] ? "en juego" : "sin abrir"}
                  {view.isBot[i]
                    ? ` · ${view.difficulties[i] ?? ""}`
                    : game.connected
                      ? ` · ${game.connected[i] ? "en línea" : "desconectado"}`
                      : ""}
                </p>
                <FaceDownRow
                  count={Math.max(0, view.rackSizes[i] - (hideFrom?.seat === i ? hideFrom.count : 0))}
                  compact
                  anchor={`seat-${i}`}
                />
              </article>
            ))}
            <article className="opp-card">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-display text-base">Pozo</h3>
                <p className="m-0 text-[13px] opacity-80">{view.poolSize} fichas</p>
              </div>
              <PoolPile count={Math.max(0, view.poolSize - (hideFrom?.pool ? hideFrom.count : 0))} />
            </article>
          </div>

          <div className="wood-frame rounded-[28px] p-3 sm:p-[22px]">
            <div
              className={`felt-board felt-surface min-h-60 sm:min-h-[340px] ${hover?.place === "felt" ? "is-hot" : ""} ${drag ? "is-droppable" : ""}`}
              data-anchor="felt"
              data-drop="felt"
            >
              <div className="felt-grain" />
              <div className="rk-tile rk-tile-md tile-probe" aria-hidden />
              {piles.length === 0 ? (
                <div className="grid min-h-[200px] place-content-center px-3 text-center opacity-90 sm:min-h-[280px]">
                  <p className="m-0 mb-2 text-xl font-extrabold sm:text-[28px]">
                    {drag ? "Soltá acá para un juego nuevo" : "La mesa está vacía"}
                  </p>
                  <span className="text-sm sm:text-base">
                    {canAct
                      ? "Arrastrá fichas al paño. Hasta confirmar el turno podés bajar más y rearmar."
                      : "Las combinaciones bajadas van a aparecer acá, en el paño."}
                  </span>
                </div>
              ) : (
                <div className="flex w-full min-w-0 flex-wrap content-start gap-x-8 gap-y-7">
                  {piles.map((pile, pileIndex) => {
                    const status = classifyPile(pile.tiles, committedMelds);
                    const pileHot = hover?.place === "pile" && hover.pile === pileIndex;
                    return (
                      <div
                        key={pile.id}
                        className={`meld-set meld-${status.kind}${pileHot ? " is-hot" : ""}${pile.tiles.length === 0 ? " is-placeholder" : ""}${rejectedIds.includes(pile.id) ? " is-rejected" : ""}`}
                        data-pile-id={pile.id}
                        data-drop-pile={pileIndex}
                        data-drop-count={pile.tiles.length}
                      >
                        <span className="meld-tag">{status.label}</span>
                        <div className="meld-tiles">
                          {pile.tiles.map((tile, index) => (
                            <div key={tile.id} className="meld-tile-wrap">
                              <div
                                className={`insert-slot${pileHot && hover?.place === "pile" && hover.index === index ? " is-hot" : ""}`}
                                data-drop-pile={pileIndex}
                                data-drop-slot={index}
                              />
                              <div className="meld-tile" style={{ zIndex: index }} data-tile-id={tile.id}>
                                <TileView
                                  tile={tile}
                                  size="md"
                                  binding={status.bindings.find((item) => item.jokerId === tile.id)}
                                  landing={landingIds.includes(tile.id)}
                                  dimmed={hiddenIds.includes(tile.id) || drag?.tile.id === tile.id}
                                  onPointerDown={
                                    canAct
                                      ? (event) => startDrag(tile, { place: "pile", pile: pileIndex, index }, event)
                                      : undefined
                                  }
                                />
                              </div>
                            </div>
                          ))}
                          <div
                            className={`insert-slot insert-end${pileHot && hover?.place === "pile" && hover.index === pile.tiles.length ? " is-hot" : ""}`}
                            data-drop-pile={pileIndex}
                            data-drop-slot={pile.tiles.length}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {canAct && (
                    <div className={`new-pile-hint${hover?.place === "felt" ? " is-hot" : ""}`} data-drop="felt">
                      + Nuevo juego
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <section className="mt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-baseline gap-3">
                  <h2 className="font-display text-xl sm:text-2xl">
                    {spectator ? `Atril de ${view.names[view.playerId]}` : "Tu atril"}
                  </h2>
                  <span className="text-lg font-extrabold tabular-nums text-gold">
                    {view.scores[view.playerId]} pts
                  </span>
                  {timedTurn && turnLeft != null && (
                    <span className={`rack-clock${turnLeft <= 10 ? " is-low" : ""}`}>
                      {Math.ceil(turnLeft)}s
                    </span>
                  )}
                </div>
                <p className="m-0 mt-1 text-sm opacity-75">
                  {rackTiles.length} fichas
                  {spectator
                    ? " · partida automática entre bots"
                    : view.hasInitialMeld[view.playerId]
                      ? " · bajá fichas y rearmá; el turno cierra al confirmar"
                      : " · apertura: 30 puntos, sin comodín ni tocar la mesa"}
                </p>
              </div>
              {busy && <span className="font-extrabold text-gold">{banner || "Pensando…"}</span>}
            </div>
            <div className={`wooden-rack${hover?.place === "rack" ? " is-hot" : ""}`} data-drop="rack">
              <div className="rack-rail" />
              <div
                className={`rack-tiles${dealing ? " is-dealing" : ""}${hover?.place === "rack" ? " is-hot" : ""}`}
                data-anchor="rack"
                data-drop="rack"
              >
                {rackTiles.map((tile, index) => (
                  <div key={tile.id} data-tile-id={tile.id} style={{ ["--deal-i" as string]: index }}>
                    <TileView
                      tile={tile}
                      size="lg"
                      selected={selected.includes(tile.id)}
                      dimmed={hiddenIds.includes(tile.id) || drag?.tile.id === tile.id}
                      landing={landingIds.includes(tile.id)}
                      onPointerDown={canAct ? (event) => startDrag(tile, { place: "rack" }, event) : undefined}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
              {spectator ? (
                <>
                  <button className={`primary ${actionBtn}`} disabled={busy || view.over} onClick={() => setAutoplay((on) => !on)}>
                    {autoplay && !view.over ? "Pausar" : "Reanudar"}
                  </button>
                  <button className={actionBtn} disabled={busy || view.over || autoplay} onClick={() => void onTick()}>
                    Siguiente jugada
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={`primary ${actionBtn}`}
                    disabled={!canAct || (!canFinishTurn && selected.length === 0)}
                    onClick={onPlay}
                  >
                    {canFinishTurn ? "Confirmar turno" : "Bajar al paño"}
                  </button>
                  <button className={actionBtn} disabled={!canAct || dirty} onClick={onDraw}>
                    Robar del pozo
                  </button>
                  <button className={actionBtn} disabled={!canAct || !dirty} onClick={resetTable}>
                    Deshacer mesa
                  </button>
                </>
              )}
              {offerNextRound && (
                <button className={`primary ${actionBtn}`} disabled={busy} onClick={() => void onNextRound()}>
                  Siguiente ronda
                </button>
              )}
              <button className={`ghost ${actionBtn}`} onClick={onlineOn ? leaveOnline : resetToLobby}>
                {onlineOn ? "Salir de la sala" : "Nueva partida"}
              </button>
            </div>
          </section>
        </div>
      )}

      {leftOpen && game?.opponentLeft && (
        <div className="result-overlay fixed inset-0 z-[210] grid place-items-center p-5" role="presentation">
          <div
            className="result-modal is-loss w-full max-w-[440px] rounded-[22px] px-6 pt-7 pb-5 text-center"
            role="dialog"
            aria-modal="true"
            aria-labelledby="left-title"
          >
            <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold">Partida terminada</p>
            <h2 id="left-title" className="font-display text-4xl leading-tight text-ivory">
              Se desconectó un contrincante
            </h2>
            <p className="mt-2.5 mb-4 text-[15px] opacity-80">
              Quedó un solo jugador en la sala, así que la partida terminó.
            </p>
            <div className="flex flex-col justify-center gap-2.5 sm:flex-row sm:flex-wrap">
              <button className="primary w-full sm:w-auto" onClick={leaveOnline}>
                Salir de la sala
              </button>
              <button className="ghost w-full sm:w-auto" onClick={() => setLeftOpen(false)}>
                Ver la mesa
              </button>
            </div>
          </div>
        </div>
      )}

      {resultOpen && view?.over && (
        <ResultModal
          view={view}
          spectator={spectator}
          onClose={() => setResultOpen(false)}
          onNewGame={onlineOn ? leaveOnline : resetToLobby}
          allowNextRound={offerNextRound}
          onNextRound={() => void onNextRound()}
        />
      )}
    </div>
  );
}
