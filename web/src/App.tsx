import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createGame, drawTile, playTiles, previewPlay, tickGame } from "./localApi";
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
import type { BotDecision, GamePayload, GameStep, TileData } from "./types";

const DIFFICULTIES = [
  { id: "easy", label: "Easy" },
  { id: "normal", label: "Normal" },
  { id: "hard", label: "Hard" },
  { id: "very_hard", label: "Very Hard" },
  { id: "extreme", label: "Extreme" },
];

const EXTREME_TURN_SECONDS = 60;

function FaceDownRow({ count, compact, anchor }: { count: number; compact?: boolean; anchor?: string }) {
  const n = Math.min(count, compact ? 10 : 14);
  return (
    <div className="facedown-row" aria-label={`${count} fichas ocultas`} data-anchor={anchor}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="facedown-slot" style={{ zIndex: i }}>
          <TileView tile={{ id: -i, isJoker: false, label: "", color: "black", rank: 0 }} faceDown size="sm" />
        </div>
      ))}
      {count > n && <span className="facedown-more">+{count - n}</span>}
    </div>
  );
}

function DebugPanel({ decision }: { decision: BotDecision }) {
  return (
    <aside className="debug">
      <h2>Por qué jugó el bot</h2>
      <p className="debug-action">{decision.action}</p>
      <p className="debug-meta">
        {decision.score.toFixed(1)} pts · {decision.timeMs.toFixed(0)} ms · {decision.statesEvaluated} estados
      </p>
      <ul>
        {Object.entries(decision.reasons).map(([name, value]) => (
          <li key={name}>
            <span>{name.replaceAll("_", " ")}</span>
            <strong>
              {value >= 0 ? "+" : ""}
              {value.toFixed(1)}
            </strong>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default function App() {
  const [setup, setSetup] = useState({
    mode: "play" as "play" | "spectate",
    difficulty: "hard",
    opponents: 1,
    botCount: 2,
    botDifficulties: ["hard", "hard"],
    seed: "",
    debug: false,
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
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState<DropTarget | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [turnLeft, setTurnLeft] = useState<number | null>(null);
  const gameRef = useRef<GamePayload | null>(null);
  const pilesRef = useRef<Pile[]>([]);
  const lastGameId = useRef<string | null>(null);
  const playGen = useRef(0);
  const timedOut = useRef(false);
  gameRef.current = game;
  pilesRef.current = piles;

  const view = game?.view;
  const spectator = Boolean(game?.spectator);
  const canAct = Boolean(game && game.yourTurn && !view?.over && !busy && !spectator);
  const timedTurn = Boolean(
    !spectator && view && !view.over && view.difficulties.some((difficulty) => difficulty === "extreme")
  );
  const committedIds = useMemo(
    () => new Set(view?.table.melds.flatMap((meld) => meld.tiles.map((tile) => tile.id)) ?? []),
    [view?.table.hash]
  );
  const hasOpened = Boolean(view && view.hasInitialMeld[view.playerId]);
  const onTableIds = useMemo(() => pileTileIds(piles), [piles]);
  const rackTiles = view?.rack.filter((tile) => !onTableIds.has(tile.id)) ?? [];
  const dirty = Boolean(view && layoutSignature(piles) !== committedSignature(view.table.melds));
  const tableReady = piles.length > 0 && piles.every((pile) => classifyPile(pile.tiles).kind === "group" || classifyPile(pile.tiles).kind === "run");
  const canConfirm = Boolean(canAct && dirty && tableReady);

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

  const status = useMemo(() => {
    if (!view) return "Elegí dificultad y empezá una partida.";
    if (view.over) {
      if (view.winner == null) return "Ronda terminada · empate.";
      return `Ronda terminada. Gana ${view.names[view.winner]}.`;
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
      setBanner(stepBanner(event));
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

    if (!event.isBot && (event.type === "play" || event.type === "initial")) {
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

    if (event.isBot && (event.type === "play" || event.type === "initial")) {
      await animateOpponentTablePlay(step, event);
      return;
    }

    if (event.isBot) {
      setBanner(`${event.playerName} está pensando…`);
      await sleep(320);
    }

    setBanner(stepBanner(event));

    if (event.type === "draw" && !event.drawn) {
      await sleep(520);
      setGame((current) =>
        current
          ? { ...current, view: step.view, yourTurn: step.yourTurn, lastDecision: step.lastDecision ?? current.lastDecision }
          : current
      );
      return;
    }

    if (event.type === "draw") {
      setHideFrom({ pool: true, count: 1 });
    } else if (event.isBot && event.playerId !== gameRef.current?.view.playerId) {
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
      event.type === "draw" && (!event.isBot || event.playerId === gameRef.current?.view.playerId)
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
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
      setBanner("");
      setFlights([]);
      setHiddenIds([]);
      setHideFrom(null);
    }
  }

  async function onStart(event: FormEvent) {
    event.preventDefault();
    playGen.current += 1;
    setAutoplay(setup.mode === "spectate");
    await withBusy(async () => {
      const payload = await createGame({
        difficulty: setup.difficulty,
        opponents: setup.opponents,
        debug: setup.debug,
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

  useEffect(() => {
    if (!game?.spectator || !autoplay || !view || view.over || busy) return;
    const timer = window.setTimeout(() => {
      void onTick();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [game?.id, game?.spectator, view?.current, view?.over, view?.history.length, autoplay, busy]);

  function toggleTile(id: number) {
    if (!canAct) return;
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }

  function startDrag(tile: TileData, origin: DragOrigin, event: { preventDefault: () => void; currentTarget: EventTarget; clientX: number; clientY: number }) {
    if (!canAct) return;
    if (!hasOpened && committedIds.has(tile.id)) return;
    event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const pending: DragState = {
      tile,
      origin,
      x: box.left,
      y: box.top,
      offsetX: event.clientX - box.left,
      offsetY: event.clientY - box.top,
    };
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dist = Math.hypot(
        ev.clientX - (pending.x + pending.offsetX),
        ev.clientY - (pending.y + pending.offsetY)
      );
      if (!moved && dist < 7) return;
      moved = true;
      setDrag({
        ...pending,
        x: ev.clientX - pending.offsetX,
        y: ev.clientY - pending.offsetY,
      });
      setHover(dropFromPoint(ev.clientX, ev.clientY));
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!moved) {
        if (origin.place === "rack") toggleTile(tile.id);
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

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
  }

  async function onDraw() {
    if (!game || !view) return;
    const pulledFromRack = view.rack.some((tile) => onTableIds.has(tile.id));
    if (pulledFromRack) {
      setError("Devolvé o confirmá las fichas que bajaste antes de robar.");
      return;
    }
    await withBusy(async () => {
      const payload = await drawTile(game.id);
      setSelected([]);
      await applyPayload(payload);
    });
  }

  async function onTurnTimeout() {
    const current = gameRef.current;
    if (!current?.yourTurn || current.view.over || timedOut.current) return;
    timedOut.current = true;
    setDrag(null);
    setHover(null);
    setSelected([]);
    setPiles(pilesFromMelds(current.view.table.melds));
    setError("Se acabó el tiempo: robás del pozo.");
    await withBusy(async () => {
      const payload = await drawTile(current.id);
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
        void onTurnTimeout();
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [timedTurn, canAct, game?.id, view?.history.length]);

  async function onPlay() {
    if (!game) return;
    if (dirty) {
      if (!tableReady) {
        setError("Quedó un juego incompleto o inválido en la mesa.");
        return;
      }
      if (!hasOpened && piles.some((pile) => pile.tiles.some((tile) => tile.isJoker))) {
        setError("La apertura de 30 puntos no puede usar comodines.");
        return;
      }
      await withBusy(async () => {
        const payload = await playTiles(
          game.id,
          [],
          piles.filter((pile) => pile.tiles.length).map((pile) => pile.tiles.map((tile) => tile.id))
        );
        setSelected([]);
        await applyPayload(payload);
      });
      return;
    }
    if (selected.length === 0) {
      setError("Arrastrá fichas al paño o seleccioná un juego del atril.");
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <div>
            <p className="kicker">Rummikub</p>
            <h1>Mesa de juego</h1>
          </div>
        </div>
        {view && (
          <div className="hud">
            <span>Seed {view.seed}</span>
            <span>Pozo {view.poolSize}</span>
            <span className={game?.yourTurn ? "hud-turn" : ""}>{status}</span>
          </div>
        )}
      </header>

      {!game && (
        <form className="setup" onSubmit={onStart}>
          <div className="mode-switch">
            <button
              type="button"
              className={setup.mode === "play" ? "is-on" : ""}
              onClick={() => setSetup({ ...setup, mode: "play" })}
            >
              Jugar
            </button>
            <button
              type="button"
              className={setup.mode === "spectate" ? "is-on" : ""}
              onClick={() => setSetup({ ...setup, mode: "spectate" })}
            >
              Bots vs bots
            </button>
          </div>
          {setup.mode === "play" ? (
            <>
              <label>
                Dificultad del bot
                <select
                  value={setup.difficulty}
                  onChange={(e) => setSetup({ ...setup, difficulty: e.target.value })}
                >
                  {DIFFICULTIES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rivales
                <select
                  value={setup.opponents}
                  onChange={(e) => setSetup({ ...setup, opponents: Number(e.target.value) })}
                >
                  <option value={1}>1 bot</option>
                  <option value={2}>2 bots</option>
                  <option value={3}>3 bots</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label>
                Bots
                <select
                  value={setup.botCount}
                  onChange={(e) => {
                    const botCount = Number(e.target.value);
                    setSetup({
                      ...setup,
                      botCount,
                      botDifficulties: Array.from(
                        { length: botCount },
                        (_, i) => setup.botDifficulties[i] || setup.difficulty
                      ),
                    });
                  }}
                >
                  <option value={2}>2 bots</option>
                  <option value={3}>3 bots</option>
                  <option value={4}>4 bots</option>
                </select>
              </label>
              {setup.botDifficulties.map((diff, index) => (
                <label key={index}>
                  Bot {index + 1}
                  <select
                    value={diff}
                    onChange={(e) => {
                      const botDifficulties = [...setup.botDifficulties];
                      botDifficulties[index] = e.target.value;
                      setSetup({ ...setup, botDifficulties });
                    }}
                  >
                    {DIFFICULTIES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </>
          )}
          <label>
            Seed
            <input
              value={setup.seed}
              placeholder="opcional"
              onChange={(e) => setSetup({ ...setup, seed: e.target.value })}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={setup.debug}
              onChange={(e) => setSetup({ ...setup, debug: e.target.checked })}
            />
            Debug del bot
          </label>
          <button type="submit" disabled={busy}>
            {setup.mode === "spectate" ? "Empezar exhibición" : "Sentarse a la mesa"}
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
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
        <div className="table-scene">
          <div className="opponents">
            {opponents.map(({ name, i }) => (
              <article key={name} className={view.current === i ? "is-active" : ""}>
                <div className="opp-meta">
                  <h3>{name}</h3>
                  <p>
                    {view.rackSizes[i]} fichas · {view.hasInitialMeld[i] ? "en juego" : "sin abrir"} · {view.difficulties[i]}
                  </p>
                </div>
                <FaceDownRow
                  count={Math.max(0, view.rackSizes[i] - (hideFrom?.seat === i ? hideFrom.count : 0))}
                  compact
                  anchor={`seat-${i}`}
                />
              </article>
            ))}
            <article className="pool-card">
              <h3>Pozo</h3>
              <p>{view.poolSize} fichas</p>
              <FaceDownRow
                count={Math.max(0, Math.min(view.poolSize, 8) - (hideFrom?.pool ? hideFrom.count : 0))}
                compact
                anchor="pool"
              />
            </article>
          </div>

          <div className="felt-frame">
            <div
              className={`felt-board${hover?.place === "felt" ? " is-hot" : ""}${drag ? " is-droppable" : ""}`}
              data-anchor="felt"
              data-drop="felt"
            >
              <div className="felt-grain" />
              {piles.length === 0 ? (
                <div className="felt-empty">
                  <p>{drag ? "Soltá acá para un juego nuevo" : "La mesa está vacía"}</p>
                  <span>
                    {canAct
                      ? "Arrastrá fichas al paño. Hasta confirmar el turno podés bajar más y rearmar."
                      : "Las combinaciones bajadas van a aparecer acá, en el paño."}
                  </span>
                </div>
              ) : (
                <div className="felt-melds">
                  {piles.map((pile, pileIndex) => {
                    const status = classifyPile(pile.tiles);
                    const pileHot = hover?.place === "pile" && hover.pile === pileIndex;
                    return (
                      <div
                        key={pile.id}
                        className={`meld-set meld-${status.kind}${pileHot ? " is-hot" : ""}${pile.tiles.length === 0 ? " is-placeholder" : ""}`}
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

          <section className="rack-dock">
            <div className="rack-head">
              <div>
                <div className="rack-title">
                  <h2>{spectator ? `Atril de ${view.names[view.playerId]}` : "Tu atril"}</h2>
                  {timedTurn && turnLeft != null && (
                    <span className={`rack-clock${turnLeft <= 10 ? " is-low" : ""}`}>
                      {Math.ceil(turnLeft)}s
                    </span>
                  )}
                </div>
                <p>
                  {rackTiles.length} fichas
                  {spectator
                    ? " · partida automática entre bots"
                    : view.hasInitialMeld[view.playerId]
                      ? " · bajá fichas y rearmá; el turno cierra al confirmar"
                      : " · apertura: 30 puntos, sin comodín ni tocar la mesa"}
                </p>
              </div>
              {busy && <span className="busy">{banner || "Pensando…"}</span>}
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
            <div className="actions">
              {spectator ? (
                <>
                  <button className="primary" disabled={busy || view.over} onClick={() => setAutoplay((on) => !on)}>
                    {autoplay && !view.over ? "Pausar" : "Reanudar"}
                  </button>
                  <button disabled={busy || view.over || autoplay} onClick={() => void onTick()}>
                    Siguiente jugada
                  </button>
                </>
              ) : (
                <>
                  <button className="primary" disabled={!canAct || (!canConfirm && selected.length === 0)} onClick={onPlay}>
                    {canConfirm ? "Confirmar turno" : "Bajar al paño"}
                  </button>
                  <button disabled={!canAct || dirty} onClick={onDraw}>
                    Robar del pozo
                  </button>
                  <button disabled={!canAct || !dirty} onClick={resetTable}>
                    Deshacer mesa
                  </button>
                </>
              )}
              <button className="ghost" onClick={resetToLobby}>
                Nueva partida
              </button>
            </div>
          </section>
        </div>
      )}

      {setup.debug && game?.lastDecision && <DebugPanel decision={game.lastDecision} />}
      {resultOpen && view?.over && (
        <ResultModal
          view={view}
          spectator={spectator}
          onClose={() => setResultOpen(false)}
          onNewGame={resetToLobby}
        />
      )}
    </div>
  );
}
