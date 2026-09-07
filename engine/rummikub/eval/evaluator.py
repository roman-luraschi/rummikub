from __future__ import annotations

from dataclasses import dataclass, field

from rummikub.game.meld import MeldKind
from rummikub.game.tile import Tile
from rummikub.game.view import PlayerView
from rummikub.solver.types import TableConfiguration

from rummikub.ai.opponent import OpponentModel


@dataclass
class ScoreBreakdown:
    total: float
    terms: dict[str, float] = field(default_factory=dict)

    def add(self, name: str, value: float) -> None:
        self.terms[name] = value
        self.total += value


class StateEvaluator:
    """Multi-term evaluation. Fewer tiles is only one signal."""

    def evaluate_view(
        self,
        view: PlayerView,
        *,
        belief: OpponentModel | None = None,
    ) -> ScoreBreakdown:
        return self._score_rack(
            view,
            rack=list(view.rack),
            table=view.table,
            belief=belief,
            just_went_out=False,
        )

    def evaluate_play(
        self,
        view: PlayerView,
        config: TableConfiguration,
        *,
        belief: OpponentModel | None = None,
    ) -> ScoreBreakdown:
        return self._score_rack(
            view,
            rack=list(config.rack_left),
            table=config.table,
            belief=belief,
            just_went_out=len(config.rack_left) == 0,
            played=config.rack_used,
        )

    def evaluate_draw(self, view: PlayerView, *, belief: OpponentModel | None = None) -> ScoreBreakdown:
        breakdown = self.evaluate_view(view, belief=belief)
        breakdown.add("draw_tempo", -18.0)
        if view.pool_size == 0:
            breakdown.add("empty_pool", -80.0)
        min_opp = min(
            size for i, size in enumerate(view.rack_sizes) if i != view.player_id
        )
        if min_opp <= 3:
            breakdown.add("draw_while_opponent_close", -22.0)
        return breakdown

    def _score_rack(
        self,
        view: PlayerView,
        *,
        rack: list[Tile],
        table,
        belief: OpponentModel | None,
        just_went_out: bool,
        played: tuple[Tile, ...] = (),
    ) -> ScoreBreakdown:
        score = ScoreBreakdown(0.0)
        if just_went_out:
            score.add("rummikub", 10_000.0)
            return score

        n = len(rack)
        deadwood = sum(t.rack_value() for t in rack)
        score.add("tiles_remaining", -12.0 * n)
        score.add("deadwood", -0.55 * deadwood)
        if played:
            score.add("tiles_played", 14.0 * len(played))

        flex, isolated, jokers = self._rack_shape(rack)
        score.add("flexibility", 0.55 * flex)
        score.add("isolated", -2.8 * isolated)
        score.add("joker_reserve", 16.0 * jokers)

        table_flex = self._table_flexibility(table)
        score.add("table_flexibility", 0.9 * table_flex)

        future = flex + table_flex * 0.15 + jokers * 2
        score.add("future_move_potential", 0.4 * future)

        min_opp = min(size for i, size in enumerate(view.rack_sizes) if i != view.player_id)
        score.add("race", -3.5 * max(0, n - min_opp))

        if belief is not None and played:
            gift = sum(belief.heat(tile) for tile in played)
            if min_opp <= 6:
                score.add("opponent_blocking", -4.2 * gift)
            else:
                score.add("opponent_blocking", -1.3 * gift)
        return score

    def _rack_shape(self, rack: list[Tile]) -> tuple[int, int, int]:
        numbered = [t for t in rack if not t.is_joker]
        jokers = len(rack) - len(numbered)
        by_color: dict[int, set[int]] = {}
        by_rank: dict[int, set[int]] = {}
        for tile in numbered:
            by_color.setdefault(int(tile.color), set()).add(tile.rank)
            by_rank.setdefault(tile.rank, set()).add(int(tile.color))
        flexible = 0
        isolated = 0
        for tile in numbered:
            color, rank = int(tile.color), tile.rank
            run_links = sum(1 for d in (-2, -1, 1, 2) if (rank + d) in by_color.get(color, set()))
            group_links = len(by_rank.get(rank, set())) - 1
            if run_links or group_links:
                flexible += 1 + run_links + group_links
            else:
                isolated += 1
        return flexible, isolated, jokers

    def _table_flexibility(self, table) -> int:
        value = 0
        for meld in table.melds:
            represented = meld.represented()
            if meld.kind is MeldKind.RUN:
                value += 2
                if len(represented) >= 5:
                    value += 1
            elif len(represented) == 3:
                value += 2
        return value
