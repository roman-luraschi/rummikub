from __future__ import annotations

import math
import time
from dataclasses import dataclass
from random import Random

from rummikub.ai.debug import BotDecision, CandidateReport
from rummikub.ai.difficulty import CONFIGS, Difficulty, DifficultyConfig, parse_difficulty
from rummikub.ai.opponent import OpponentModel
from rummikub.eval.evaluator import ScoreBreakdown, StateEvaluator
from rummikub.game.meld import MeldKind
from rummikub.game.runs import next_rank, prev_rank, run_display_order
from rummikub.game.tile import Tile
from rummikub.game.view import PlayerView
from rummikub.solver import SolverMode, TableConfiguration, TableSolver


@dataclass
class BotMove:
    action: str
    config: TableConfiguration | None
    score: float
    decision: BotDecision


class RummyBot:
    """Decision engine. Receives PlayerView only — never hidden opponent racks or the pool order."""

    def __init__(self, evaluator: StateEvaluator | None = None) -> None:
        self.evaluator = evaluator or StateEvaluator()
        self.solver = TableSolver()

    def choose_move(
        self,
        view: PlayerView,
        difficulty: str | Difficulty = Difficulty.HARD,
        *,
        rng: Random | None = None,
        debug: bool = True,
    ) -> BotMove:
        if view.current != view.player_id:
            raise ValueError("It is not this player's turn")
        diff = parse_difficulty(difficulty)
        cfg = CONFIGS[diff]
        rng = rng or Random()
        started = time.perf_counter()
        deadline = started + cfg.time_limit_ms / 1000.0

        opened = view.has_initial_meld[view.player_id]
        configs = self._collect_configs(view, cfg, opened, deadline)
        belief = (
            OpponentModel.from_view(view, accuracy=cfg.opponent_model_accuracy)
            if cfg.use_opponent_model
            else None
        )

        scored: list[tuple[str, TableConfiguration | None, ScoreBreakdown]] = []
        nodes = 0
        cache_hits = 0
        for config in configs:
            breakdown = self.evaluator.evaluate_play(view, config, belief=belief)
            nodes += config.nodes
            cache_hits += config.cache_hits
            scored.append(("PLAY", config, breakdown))

        simulations = 0
        if cfg.use_monte_carlo and scored and time.perf_counter() < deadline:
            simulations = self._lookahead(view, scored, cfg, belief, rng, deadline)

        draw_breakdown = self.evaluator.evaluate_draw(view, belief=belief)
        scored.append(("DRAW", None, draw_breakdown))

        going_out = [item for item in scored if item[0] == "PLAY" and item[1] and not item[1].rack_left]
        pool = going_out or scored
        chosen_action, chosen_config, chosen_break = self._select(
            pool, cfg, rng, pool_size=view.pool_size
        )

        elapsed = (time.perf_counter() - started) * 1000.0
        top = sorted(scored, key=lambda item: item[2].total, reverse=True)[:10]
        decision = BotDecision(
            action=chosen_action if chosen_config is None else f"PLAY {self._used_str(chosen_config)}",
            score=chosen_break.total,
            reasons=dict(chosen_break.terms),
            move=chosen_config,
            initial_hand=" ".join(str(t) for t in view.rack),
            initial_table=str(view.table),
            final_table=str(chosen_config.table) if chosen_config else str(view.table),
            discarded=self._used_str(chosen_config) if chosen_config else "(draw)",
            search_depth=cfg.search_depth,
            states_evaluated=nodes + len(scored),
            cache_hits=cache_hits,
            simulation_count=simulations,
            time_ms=elapsed,
            top_candidates=[
                CandidateReport(
                    action=action if config is None else "PLAY",
                    score=bd.total,
                    terms=dict(bd.terms),
                    table=str(config.table) if config else str(view.table),
                    rack_used=self._used_str(config) if config else "DRAW",
                    tiles_played=config.tiles_played if config else 0,
                )
                for action, config, bd in top
            ],
            difficulty=diff.value,
        )
        if not debug:
            decision.top_candidates = []
        return BotMove(chosen_action, chosen_config, chosen_break.total, decision)

    def _collect_configs(
        self,
        view: PlayerView,
        cfg: DifficultyConfig,
        opened: bool,
        deadline: float,
    ) -> list[TableConfiguration]:
        rack = list(view.rack)
        table = view.table
        remaining_ms = max(20.0, (deadline - time.perf_counter()) * 1000.0)
        if not opened:
            return self.solver.solve(
                table,
                rack,
                mode=SolverMode.INITIAL,
                min_rack_played=1,
                max_configs=cfg.beam_k,
                time_limit_ms=remaining_ms,
                min_initial_points=30,
            )
        add_budget = remaining_ms if cfg.solver_mode is SolverMode.ADD_ONLY else min(140.0, remaining_ms * 0.25)
        configs = self.solver.solve(
            table,
            rack,
            mode=SolverMode.ADD_ONLY,
            min_rack_played=1,
            max_configs=cfg.beam_k,
            time_limit_ms=add_budget,
        )
        if cfg.solver_mode is SolverMode.ADD_ONLY:
            return configs
        continued: list[TableConfiguration] = []
        if configs:
            seed = max(configs, key=lambda c: (c.tiles_played, -c.remaining_deadwood()))
            continue_budget = max(20.0, (deadline - time.perf_counter()) * 1000.0 * 0.65)
            continued = self._continue_turn(seed, cfg, continue_budget)
        extra_budget = max(20.0, (deadline - time.perf_counter()) * 1000.0)
        extra = self.solver.solve(
            table,
            rack,
            mode=cfg.solver_mode,
            min_rack_played=1,
            max_configs=cfg.beam_k,
            time_limit_ms=extra_budget,
        )
        return _merge_configs(configs, _merge_configs(continued, extra))

    def _continue_turn(
        self,
        seed: TableConfiguration,
        cfg: DifficultyConfig,
        budget_ms: float,
    ) -> list[TableConfiguration]:
        """After dumping obvious tiles, keep rearranging leftover rack in the same turn."""
        if not seed.rack_left or budget_ms < 15.0:
            return []
        started = time.perf_counter()
        extras = self.solver.solve(
            seed.table,
            list(seed.rack_left),
            mode=cfg.solver_mode,
            min_rack_played=1,
            max_configs=cfg.beam_k,
            time_limit_ms=max(20.0, budget_ms * 0.8),
        )
        continued = [composed for extra in extras if (composed := _compose_configs(seed, extra))]
        if not continued:
            return []
        best = max(continued, key=lambda c: (c.tiles_played, -c.remaining_deadwood()))
        mop_budget = budget_ms - (time.perf_counter() - started) * 1000.0
        if mop_budget >= 15.0 and best.rack_left:
            more = self.solver.solve(
                best.table,
                list(best.rack_left),
                mode=SolverMode.ADD_ONLY,
                min_rack_played=1,
                max_configs=cfg.beam_k,
                time_limit_ms=mop_budget,
            )
            continued.extend(
                composed for extra in more if (composed := _compose_configs(best, extra))
            )
        return continued

    def _select(
        self,
        scored: list[tuple[str, TableConfiguration | None, ScoreBreakdown]],
        cfg: DifficultyConfig,
        rng: Random,
        *,
        pool_size: int,
    ) -> tuple[str, TableConfiguration | None, ScoreBreakdown]:
        ranked = sorted(scored, key=lambda item: item[2].total, reverse=True)
        plays = [item for item in ranked if item[0] == "PLAY"]
        draws = [item for item in ranked if item[0] == "DRAW"]
        slack = 8.0 + 40.0 * cfg.randomness
        if plays:
            if pool_size == 0:
                ranked = plays
            else:
                best_play = plays[0][2].total
                best_draw = draws[0][2].total if draws else float("-inf")
                if best_play >= best_draw - slack:
                    ranked = plays
        best_score = ranked[0][2].total
        margin = 18.0 + 55.0 * cfg.randomness
        eligible = [item for item in ranked if best_score - item[2].total <= margin]
        if cfg.randomness <= 0 or len(eligible) == 1:
            return ranked[0]
        weights = []
        temp = max(0.8, cfg.randomness * 28.0)
        for item in eligible:
            weights.append(math.exp((item[2].total - best_score) / temp))
        return rng.choices(eligible, weights=weights, k=1)[0]

    def _lookahead(
        self,
        view: PlayerView,
        scored: list[tuple[str, TableConfiguration | None, ScoreBreakdown]],
        cfg: DifficultyConfig,
        belief: OpponentModel | None,
        rng: Random,
        deadline: float,
    ) -> int:
        plays = [item for item in scored if item[0] == "PLAY" and item[1] is not None]
        plays.sort(key=lambda item: item[2].total, reverse=True)
        plays = plays[: cfg.lookahead_top]
        if not plays or belief is None:
            return 0
        opp_id = min(
            (i for i in range(len(view.rack_sizes)) if i != view.player_id),
            key=lambda i: view.rack_sizes[i],
        )
        opp_size = view.rack_sizes[opp_id]
        samples = max(1, cfg.simulation_count // max(1, len(plays)))
        used = 0
        for _action, config, breakdown in plays:
            if time.perf_counter() >= deadline:
                break
            gift = 0.0
            for _ in range(samples):
                sample = belief.sample_hidden(opp_size, rng)
                gift += sum(1.0 for tile in sample if _can_attach(tile, config.table))
                used += 1
            avg = gift / samples
            breakdown.add("simulated_opponent_replies", -3.1 * avg)
        self._center_lookahead(plays[: cfg.lookahead_top])
        return used

    def _center_lookahead(
        self, plays: list[tuple[str, TableConfiguration | None, ScoreBreakdown]]
    ) -> None:
        """Keep Monte Carlo as a ranking among plays, not a bias toward drawing."""
        keyed = [item for item in plays if "simulated_opponent_replies" in item[2].terms]
        if len(keyed) < 2:
            if keyed:
                bd = keyed[0][2]
                bd.total -= bd.terms["simulated_opponent_replies"]
                bd.terms["simulated_opponent_replies"] = 0.0
            return
        mean = sum(item[2].terms["simulated_opponent_replies"] for item in keyed) / len(keyed)
        for _action, _config, breakdown in keyed:
            breakdown.terms["simulated_opponent_replies"] -= mean
            breakdown.total -= mean

    def _used_str(self, config: TableConfiguration | None) -> str:
        if config is None:
            return ""
        return " ".join(str(t) for t in config.rack_used)


def _compose_configs(
    first: TableConfiguration, second: TableConfiguration
) -> TableConfiguration | None:
    leftover = {t.id for t in first.rack_left}
    used_again = {t.id for t in second.rack_used}
    if not used_again or not used_again.issubset(leftover):
        return None
    return TableConfiguration(
        table=second.table,
        rack_used=first.rack_used + second.rack_used,
        rack_left=second.rack_left,
        solver_mode=second.solver_mode,
        nodes=first.nodes + second.nodes,
        cache_hits=first.cache_hits + second.cache_hits,
        time_ms=first.time_ms + second.time_ms,
    )


def _merge_configs(
    first: list[TableConfiguration], second: list[TableConfiguration]
) -> list[TableConfiguration]:
    seen: set[tuple] = set()
    merged: list[TableConfiguration] = []
    for config in first + second:
        key = config.table.canonical_key() + (tuple(t.id for t in config.rack_used),)
        if key in seen:
            continue
        seen.add(key)
        merged.append(config)
    return merged


def _can_attach(tile: Tile, table) -> bool:
    if tile.is_joker:
        return True
    color, rank = int(tile.color), tile.rank
    for meld in table.melds:
        represented = meld.represented()
        if meld.kind is MeldKind.RUN:
            if represented[0][0] != color:
                continue
            order = run_display_order([r for _c, r in represented])
            if rank == prev_rank(order[0]) or rank == next_rank(order[-1]):
                return True
        else:
            used = {c for c, _r in represented}
            m_rank = represented[0][1]
            if m_rank == rank and color not in used and len(represented) == 3:
                return True
    return False
