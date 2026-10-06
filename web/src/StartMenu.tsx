import { FormEvent, useEffect, useState } from "react";
import TileView from "./Tile";
import type { TileData } from "./types";

export const DIFFICULTIES = [
  { id: "easy", label: "Easy" },
  { id: "normal", label: "Normal" },
  { id: "hard", label: "Hard" },
  { id: "very_hard", label: "Very Hard" },
  { id: "extreme", label: "Extreme" },
];

export type GameSetup = {
  mode: "play" | "spectate";
  difficulty: string;
  opponents: number;
  botCount: number;
  botDifficulties: string[];
  seed: string;
};

type StartMenuProps = {
  setup: GameSetup;
  onChange: (setup: GameSetup) => void;
  busy: boolean;
  error: string;
  onStart: () => void;
};

type Screen = "title" | "play" | "spectate" | "rules";

const DECOR: TileData[] = [
  { id: -1, isJoker: false, label: "1 rojo", color: "red", rank: 1 },
  { id: -2, isJoker: false, label: "13 azul", color: "blue", rank: 13 },
  { id: -3, isJoker: true, label: "comodín", color: "joker", rank: null },
  { id: -4, isJoker: false, label: "7 negro", color: "black", rank: 7 },
  { id: -5, isJoker: false, label: "10 naranja", color: "orange", rank: 10 },
];

const RULES = [
  "Objetivo: quedarte sin fichas, o tener menos puntos que el rival si se vacía el pozo.",
  "Grupos del mismo número y distinto color, o escaleras del mismo color. Mínimo 3 fichas.",
  "Apertura: 30 puntos, sin comodín y sin tocar lo que ya está en la mesa.",
  "En tu turno arrastrás fichas al paño, podés rearmar y bajás más; el turno cierra con “Confirmar turno”. “Deshacer mesa” vuelve al estado confirmado.",
  "Si no jugás, “Robar del pozo”. En Extreme tenés 60 segundos; si se acaban, robás.",
];

function DifficultySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {DIFFICULTIES.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

function ExtraFields({ setup, onChange }: { setup: GameSetup; onChange: (setup: GameSetup) => void }) {
  return (
    <>
      <label>
        Seed
        <input
          value={setup.seed}
          placeholder="opcional"
          onChange={(event) => onChange({ ...setup, seed: event.target.value })}
        />
      </label>
    </>
  );
}

export default function StartMenu({ setup, onChange, busy, error, onStart }: StartMenuProps) {
  const [screen, setScreen] = useState<Screen>("title");

  useEffect(() => {
    if (screen === "title") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setScreen("title");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  function openPlay() {
    onChange({ ...setup, mode: "play" });
    setScreen("play");
  }

  function openSpectate() {
    onChange({ ...setup, mode: "spectate" });
    setScreen("spectate");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onStart();
  }

  return (
    <div className="felt-surface relative flex min-h-screen items-center justify-center overflow-auto px-4 py-6">
      <div className="felt-grain" aria-hidden />
      <div className="wood-frame relative z-[1] w-full max-w-[460px] rounded-[28px] p-3.5 sm:p-4">
        <div className="start-panel rounded-[18px] px-4 pt-6 pb-4 text-center sm:px-5">
          <div className="mb-4 flex items-end justify-center gap-2" aria-hidden>
            {DECOR.map((tile) => (
              <TileView key={tile.id} tile={tile} size="md" />
            ))}
          </div>
          <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.18em] text-gold">Mesa de juego</p>
          <h1 className="my-1.5 mb-5 font-display text-4xl leading-none text-ivory sm:text-5xl">Rummikub</h1>

          {screen === "title" && (
            <nav className="flex flex-col gap-2.5" aria-label="Menú principal">
              <button type="button" className="primary w-full" onClick={openPlay}>
                Jugar
              </button>
              <button type="button" className="primary w-full" onClick={openSpectate}>
                Bots vs bots
              </button>
              <button type="button" className="primary w-full" onClick={() => setScreen("rules")}>
                Instrucciones de cómo jugar
              </button>
            </nav>
          )}

          {screen === "play" && (
            <form className="flex flex-col gap-2.5" onSubmit={submit}>
              <h2 className="mb-1 font-display text-[26px]">Jugar</h2>
              <label>
                Dificultad del bot
                <DifficultySelect
                  value={setup.difficulty}
                  onChange={(difficulty) => onChange({ ...setup, difficulty })}
                />
              </label>
              <label>
                Rivales
                <select
                  value={setup.opponents}
                  onChange={(event) => onChange({ ...setup, opponents: Number(event.target.value) })}
                >
                  <option value={1}>1 bot</option>
                  <option value={2}>2 bots</option>
                  <option value={3}>3 bots</option>
                </select>
              </label>
              <ExtraFields setup={setup} onChange={onChange} />
              {error && <p className="text-[#ffb4a8]">{error}</p>}
              <div className="flex flex-col gap-2.5">
                <button type="submit" className="primary w-full" disabled={busy}>
                  Sentarse a la mesa
                </button>
                <button type="button" className="ghost w-full" onClick={() => setScreen("title")}>
                  Volver
                </button>
              </div>
            </form>
          )}

          {screen === "spectate" && (
            <form className="flex flex-col gap-2.5" onSubmit={submit}>
              <h2 className="mb-1 font-display text-[26px]">Bots vs bots</h2>
              <label>
                Bots
                <select
                  value={setup.botCount}
                  onChange={(event) => {
                    const botCount = Number(event.target.value);
                    onChange({
                      ...setup,
                      botCount,
                      botDifficulties: Array.from(
                        { length: botCount },
                        (_, index) => setup.botDifficulties[index] || setup.difficulty
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
                  <DifficultySelect
                    value={diff}
                    onChange={(value) => {
                      const botDifficulties = [...setup.botDifficulties];
                      botDifficulties[index] = value;
                      onChange({ ...setup, botDifficulties });
                    }}
                  />
                </label>
              ))}
              <ExtraFields setup={setup} onChange={onChange} />
              {error && <p className="text-[#ffb4a8]">{error}</p>}
              <div className="flex flex-col gap-2.5">
                <button type="submit" className="primary w-full" disabled={busy}>
                  Empezar exhibición
                </button>
                <button type="button" className="ghost w-full" onClick={() => setScreen("title")}>
                  Volver
                </button>
              </div>
            </form>
          )}

          {screen === "rules" && (
            <div className="flex flex-col gap-2.5">
              <h2 className="mb-1 font-display text-[26px]">Instrucciones de cómo jugar</h2>
              <ol className="start-rules">
                {RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
              <button type="button" className="ghost w-full" onClick={() => setScreen("title")}>
                Volver
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
