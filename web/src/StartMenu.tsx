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
    <div className="start-screen">
      <div className="start-card">
        <div className="start-panel">
          <div className="start-tiles" aria-hidden>
            {DECOR.map((tile) => (
              <TileView key={tile.id} tile={tile} size="md" />
            ))}
          </div>
          <p className="start-kicker">Mesa de juego</p>
          <h1 className="start-title">Rummikub</h1>

          {screen === "title" && (
            <nav className="start-menu" aria-label="Menú principal">
              <button type="button" className="primary" onClick={openPlay}>
                Jugar
              </button>
              <button type="button" onClick={openSpectate}>
                Bots vs bots
              </button>
              <button type="button" onClick={() => setScreen("rules")}>
                Instrucciones de cómo jugar
              </button>
            </nav>
          )}

          {screen === "play" && (
            <form className="start-form" onSubmit={submit}>
              <h2>Jugar</h2>
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
              {error && <p className="error">{error}</p>}
              <div className="start-actions">
                <button type="submit" className="primary" disabled={busy}>
                  Sentarse a la mesa
                </button>
                <button type="button" className="ghost" onClick={() => setScreen("title")}>
                  Volver
                </button>
              </div>
            </form>
          )}

          {screen === "spectate" && (
            <form className="start-form" onSubmit={submit}>
              <h2>Bots vs bots</h2>
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
              {error && <p className="error">{error}</p>}
              <div className="start-actions">
                <button type="submit" className="primary" disabled={busy}>
                  Empezar exhibición
                </button>
                <button type="button" className="ghost" onClick={() => setScreen("title")}>
                  Volver
                </button>
              </div>
            </form>
          )}

          {screen === "rules" && (
            <div className="start-form">
              <h2>Instrucciones de cómo jugar</h2>
              <ol className="start-rules">
                {RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
              <button type="button" className="ghost" onClick={() => setScreen("title")}>
                Volver
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
