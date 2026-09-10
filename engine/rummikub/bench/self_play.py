from __future__ import annotations

import argparse
import statistics
import time
from collections import Counter
from random import Random

from rummikub.ai.bot import RummyBot
from rummikub.ai.difficulty import parse_difficulty
from rummikub.game.engine import GameEngine


def play_game(
    difficulties: list[str],
    seed: int,
    *,
    max_turns: int = 180,
) -> dict:
    engine = GameEngine()
    bot = RummyBot()
    names = [d.upper() for d in difficulties]
    state = engine.new_game(
        n_players=len(difficulties),
        seed=seed,
        names=names,
        bots=list(difficulties),
    )
    times: list[float] = []
    turns = 0
    while not state.over and turns < max_turns:
        player = state.players[state.current]
        view = engine.view(state, player.id)
        started = time.perf_counter()
        move = bot.choose_move(view, player.difficulty or "easy", debug=False)
        times.append((time.perf_counter() - started) * 1000.0)
        if move.action == "DRAW" or move.config is None:
            state = engine.draw(state)
        else:
            state = engine.play(state, move.config)
        turns += 1
    return {
        "seed": seed,
        "winner": state.winner,
        "winner_name": names[state.winner] if state.winner is not None else None,
        "scores": list(state.scores),
        "turns": turns,
        "over": state.over,
        "avg_ms": statistics.mean(times) if times else 0.0,
        "max_ms": max(times) if times else 0.0,
    }


def run_match(
    a: str,
    b: str,
    games: int,
    seed: int,
    *,
    progress: bool = False,
) -> dict:
    parse_difficulty(a)
    parse_difficulty(b)
    wins = Counter()
    results = []
    started = time.perf_counter()
    for i in range(games):
        order = [a, b] if i % 2 == 0 else [b, a]
        game_started = time.perf_counter()
        result = play_game(order, seed + i)
        results.append(result)
        if result["winner"] is None:
            wins["draw"] += 1
            winner_label = "draw"
        else:
            winner_diff = order[result["winner"]]
            wins[winner_diff] += 1
            winner_label = winner_diff
        if progress:
            elapsed = time.perf_counter() - started
            game_s = time.perf_counter() - game_started
            print(
                f"[{i + 1}/{games}] {winner_label}  turns={result['turns']}  "
                f"{game_s:.1f}s  wins={dict(wins)}  elapsed={elapsed / 60:.1f}m",
                flush=True,
            )
    return {
        "a": a,
        "b": b,
        "games": games,
        "wins": dict(wins),
        "avg_turns": statistics.mean(r["turns"] for r in results),
        "avg_ms": statistics.mean(r["avg_ms"] for r in results),
        "results": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Rummikub bot self-play")
    parser.add_argument("--a", default="easy")
    parser.add_argument("--b", default="hard")
    parser.add_argument("--games", type=int, default=10)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    print(
        f"Self-play {args.a} vs {args.b}  games={args.games}  seed={args.seed}  "
        "(Extreme puede tardar ~15s por partida; no está colgado.)",
        flush=True,
    )
    summary = run_match(args.a, args.b, args.games, args.seed, progress=True)
    print(
        f"{summary['a']} vs {summary['b']}  "
        f"games={summary['games']}  wins={summary['wins']}  "
        f"avg_turns={summary['avg_turns']:.1f}  avg_ms={summary['avg_ms']:.1f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
