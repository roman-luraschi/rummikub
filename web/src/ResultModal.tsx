import { useEffect, useRef } from "react";
import type { GameView } from "./types";

type ResultModalProps = {
  view: GameView;
  spectator: boolean;
  allowNextRound: boolean;
  onClose: () => void;
  onNewGame: () => void;
  onNextRound: () => void;
};

function resultCopy(view: GameView, spectator: boolean) {
  const winnerId = view.winner;
  const rummikub = winnerId != null && view.rackSizes[winnerId] === 0;
  const award = winnerId == null ? 0 : view.roundPoints[winnerId];
  if (winnerId == null) {
    return {
      kicker: `Ronda ${view.round}`,
      title: "Empate",
      detail: "Quedaron igualados. Nadie suma y la partida sigue hasta 500.",
      tone: "draw" as const,
    };
  }
  const name = view.names[winnerId];
  const youWon = !spectator && winnerId === view.playerId;
  const youLost = !spectator && winnerId !== view.playerId;
  if (view.matchOver) {
    return {
      kicker: "500 puntos",
      title: youWon ? "¡Ganaste la partida!" : youLost ? "Perdiste la partida" : `Gana ${name}`,
      detail: youWon
        ? `Llegaste a ${view.scores[winnerId]} puntos.`
        : `${name} llegó a ${view.scores[winnerId]} puntos.`,
      tone: youWon ? ("win" as const) : youLost ? ("loss" as const) : ("win" as const),
    };
  }
  const gained = youWon ? `Sumaste ${award}` : `${name} sumó ${award}`;
  return {
    kicker: rummikub ? "Rummikub" : "Pozo vacío",
    title: youWon ? "¡Ganaste la ronda!" : youLost ? "Perdiste la ronda" : `Gana ${name}`,
    detail: rummikub
      ? `${gained} por las fichas que quedaron en los otros atriles. Se juega hasta 500.`
      : `${gained}. Tenía menos puntos en el atril cuando se vació el pozo. Se juega hasta 500.`,
    tone: youWon ? ("win" as const) : youLost ? ("loss" as const) : ("win" as const),
  };
}

export default function ResultModal({ view, spectator, allowNextRound, onClose, onNewGame, onNextRound }: ResultModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const copy = resultCopy(view, spectator);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="result-overlay fixed inset-0 z-[200] grid place-items-center p-5" onClick={onClose} role="presentation">
      <div
        className={`result-modal is-${copy.tone} w-full max-w-[440px] rounded-[22px] px-6 pt-7 pb-5 text-center`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold">{copy.kicker}</p>
        <h2 id="result-title" className="font-display text-4xl leading-tight text-ivory">
          {copy.title}
        </h2>
        <p className="mt-2.5 mb-4 text-[15px] opacity-80">{copy.detail}</p>
        <ul className="result-board mb-[18px] grid gap-2 p-0 text-left">
          {view.names.map((name, index) => {
            const won = view.winner === index;
            const you = !spectator && index === view.playerId;
            return (
              <li key={`${name}-${index}`} className={won ? "is-winner" : ""}>
                <span>
                  {you ? "Vos" : name}
                  {won ? " · ganó" : ""}
                </span>
                <strong>
                  {view.rackValues[index]} en el atril
                  <em>
                    {view.roundPoints[index] > 0 ? `+${view.roundPoints[index]} · ` : ""}
                    {view.scores[index]} pts
                  </em>
                </strong>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col justify-center gap-2.5 sm:flex-row sm:flex-wrap">
          {!view.matchOver && allowNextRound && (
            <button ref={closeRef} className="primary w-full sm:w-auto" onClick={onNextRound}>
              Siguiente ronda
            </button>
          )}
          <button
            ref={view.matchOver || !allowNextRound ? closeRef : undefined}
            className={`${view.matchOver ? "primary" : "ghost"} w-full sm:w-auto`}
            onClick={onNewGame}
          >
            Nueva partida
          </button>
          {!view.matchOver && (
            <button className="ghost w-full sm:w-auto" onClick={onClose}>
              Ver la mesa
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
