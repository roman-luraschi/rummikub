import { parseDifficulty, RummyBot, SeededRng } from "./bot";
import { GameEngine } from "./game";

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function parseBenchArgs(argv: string[]): { a: string; b: string; games: number; seed: number } {
  const script = argv.findIndex((tok) => /bench\.ts$/i.test(tok.replace(/\\/g, "/")));
  const raw = script >= 0 ? argv.slice(script + 1) : argv.slice(2);
  let a = "easy";
  let b = "hard";
  let games = 10;
  let seed = 1;
  const positional: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i];
    const next = raw[i + 1];
    if ((tok === "--a" || tok === "--b" || tok === "--games" || tok === "--seed") && next && !next.startsWith("-")) {
      if (tok === "--a") a = next;
      else if (tok === "--b") b = next;
      else if (tok === "--games") games = Number(next);
      else seed = Number(next);
      i += 1;
    } else if (!tok.startsWith("-")) {
      positional.push(tok);
    }
  }
  if (positional[0]) a = positional[0];
  if (positional[1]) b = positional[1];
  if (positional[2]) games = Number(positional[2]);
  if (positional[3]) seed = Number(positional[3]);
  if (!Number.isFinite(games) || games < 1) throw new Error(`Invalid games: ${games}`);
  if (!Number.isFinite(seed)) throw new Error(`Invalid seed: ${seed}`);
  return { a, b, games, seed };
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

const { a, b, games, seed } = parseBenchArgs(process.argv);

console.log(
  `Self-play ${a} vs ${b}  games=${games}  seed=${seed}  (Extreme puede tardar ~15s por partida; no está colgado.)`,
);
const summary = runMatch(a, b, games, seed);
console.log(
  `${summary.a} vs ${summary.b}  games=${summary.games}  wins=${JSON.stringify(summary.wins)}  avg_turns=${summary.avgTurns.toFixed(1)}  avg_ms=${summary.avgMs.toFixed(1)}`,
);
