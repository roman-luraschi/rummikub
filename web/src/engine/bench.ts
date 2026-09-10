import { parseDifficulty, RummyBot, SeededRng } from "./bot";
import { GameEngine } from "./game";

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function playGame(difficulties: string[], seed: number, maxTurns = 180) {
  const engine = new GameEngine();
  const bot = new RummyBot();
  const names = difficulties.map((d) => d.toUpperCase());
  let state = engine.newGame(difficulties.length, seed, names, difficulties);
  const times: number[] = [];
  let turns = 0;
  while (!state.over && turns < maxTurns) {
    const player = state.players[state.current];
    const view = engine.view(state, player.id);
    const started = performance.now();
    const move = bot.chooseMove(view, player.difficulty || "easy", false, new SeededRng(seed * 10007 + turns + 1));
    times.push(performance.now() - started);
    state = move.action === "DRAW" || !move.config ? engine.draw(state) : engine.play(state, move.config);
    turns += 1;
  }
  return {
    seed,
    winner: state.winner,
    turns,
    over: state.over,
    avgMs: mean(times),
  };
}

function runMatch(a: string, b: string, games: number, seed: number) {
  parseDifficulty(a);
  parseDifficulty(b);
  const wins: Record<string, number> = {};
  const turnCounts: number[] = [];
  const avgMs: number[] = [];
  const started = performance.now();
  for (let i = 0; i < games; i++) {
    const order = i % 2 === 0 ? [a, b] : [b, a];
    const gameStarted = performance.now();
    const result = playGame(order, seed + i);
    turnCounts.push(result.turns);
    avgMs.push(result.avgMs);
    const label = result.winner == null ? "draw" : order[result.winner];
    wins[label] = (wins[label] ?? 0) + 1;
    const elapsed = (performance.now() - started) / 60000;
    const gameS = (performance.now() - gameStarted) / 1000;
    console.log(
      `[${i + 1}/${games}] ${label}  turns=${result.turns}  ${gameS.toFixed(1)}s  wins=${JSON.stringify(wins)}  elapsed=${elapsed.toFixed(1)}m`,
    );
  }
  return { a, b, games, wins, avgTurns: mean(turnCounts), avgMs: mean(avgMs) };
}

const a = arg("--a", "easy");
const b = arg("--b", "hard");
const games = Number(arg("--games", "10"));
const seed = Number(arg("--seed", "1"));

console.log(
  `Self-play ${a} vs ${b}  games=${games}  seed=${seed}  (Extreme puede tardar ~15s por partida; no está colgado.)`,
);
const summary = runMatch(a, b, games, seed);
console.log(
  `${summary.a} vs ${summary.b}  games=${summary.games}  wins=${JSON.stringify(summary.wins)}  avg_turns=${summary.avgTurns.toFixed(1)}  avg_ms=${summary.avgMs.toFixed(1)}`,
);
