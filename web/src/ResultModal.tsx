import { useEffect, useRef } from "react";
import type { GameView } from "./types";

type ResultModalProps = {
  view: GameView;
  spectator: boolean;
  onClose: () => void;
  onNewGame: () => void;
};

function resultCopy(view: GameView, spectator: boolean) {
  const winnerId = view.winner;
  const rummikub = winnerId != null && view.rackSizes[winnerId] === 0;
  if (winnerId == null) {
    return {
      kicker: "Pozo vacío",
      title: "Empate",
      detail: "Nadie pudo seguir bajando. Quedaron con los mismos puntos en el atril.",
      tone: "draw" as const,
    };
  }
  const name = view.names[winnerId];
  const youWon = !spectator && winnerId === view.playerId;
  const youLost = !spectator && winnerId !== view.playerId;
  return {
    kicker: rummikub ? "Rummikub" : "Pozo vacío",
    title: youWon ? "¡Ganaste!" : youLost ? "Perdiste" : `Gana ${name}`,
    detail: rummikub
      ? youWon
        ? "Te quedaste sin fichas."
        : `${name} se quedó sin fichas.`
      : youWon
        ? "Se acabó el pozo y tenías menos puntos en el atril."
        : `Se acabó el pozo. ${name} tenía menos puntos en el atril.`,
    tone: youWon ? ("win" as const) : youLost ? ("loss" as const) : ("win" as const),
  };
}

export default function ResultModal({ view, spectator, onClose, onNewGame }: ResultModalProps) {
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
                  {view.rackSizes[index]} fichas
                  <em>{view.scores[index] >= 0 ? `+${view.scores[index]}` : view.scores[index]} pts</em>
                </strong>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col justify-center gap-2.5 sm:flex-row sm:flex-wrap">
          <button ref={closeRef} className="primary w-full sm:w-auto" onClick={onNewGame}>
            Nueva partida
          </button>
          <button className="ghost w-full sm:w-auto" onClick={onClose}>
            Ver la mesa
          </button>
        </div>
      </div>
    </div>
  );
}
