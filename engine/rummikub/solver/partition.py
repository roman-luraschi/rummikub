from __future__ import annotations

import time
from dataclasses import dataclass
from itertools import combinations

from rummikub.game.meld import JokerBinding, Meld, MeldKind
from rummikub.game.table import Table
from rummikub.game.tile import Color, MAX_RANK, MIN_RANK, NUM_COLORS, NUM_RANKS, Tile
from rummikub.game.runs import run_ranks_from_start
from rummikub.game.tileset import TileBag, consume_numbered, undo_consume
from rummikub.rules.table_validator import validate_entire_table
from rummikub.solver.types import SolverStats, TableConfiguration, SolverMode


@dataclass
class _Part:
    kind: MeldKind
    items: tuple[tuple[str, int, int], ...]  # source, color, rank


class PartitionSearch:
    """Exact cover of mandatory tiles using optional rack tiles and jokers.

    This is a general partition search. Groups and runs share the candidate
    beam 50/50 at the first kind choice so one type cannot crowd the other out.
    """

    def __init__(
        self,
        table_tiles: list[Tile],
        rack_tiles: list[Tile],
        *,
        frozen_melds: tuple[Meld, ...] = (),
        min_rack_played: int = 1,
        max_configs: int = 64,
        time_limit_ms: float = 200.0,
        min_initial_points: int = 0,
        mode: SolverMode = SolverMode.FULL,
    ) -> None:
        self.table_tiles = table_tiles
        self.rack_tiles = rack_tiles
        self.frozen_melds = frozen_melds
        self.min_rack_played = min_rack_played
        self.max_configs = max_configs
        self.time_limit_s = time_limit_ms / 1000.0
        self.min_initial_points = min_initial_points
        self.mode = mode
        self.must = TileBag.from_tiles(table_tiles)
        self.opt = TileBag.from_tiles(rack_tiles)
        self.skipped = TileBag()
        self.current: list[_Part] = []
        self.fail_cache: set[bytes] = set()
        self.seen_table: set[tuple] = set()
        self.configs: list[TableConfiguration] = []
        self.stats = SolverStats()
        self._deadline = 0.0

    def solve(self) -> list[TableConfiguration]:
        start = time.perf_counter()
        self._deadline = start + self.time_limit_s
        self._search()
        self.stats.time_ms = (time.perf_counter() - start) * 1000.0
        self.stats.solutions = len(self.configs)
        self.configs.sort(key=self._rank)
        for i, cfg in enumerate(self.configs):
            self.configs[i] = TableConfiguration(
                table=cfg.table,
                rack_used=cfg.rack_used,
                rack_left=cfg.rack_left,
                solver_mode=self.mode,
                nodes=self.stats.nodes,
                cache_hits=self.stats.cache_hits,
                time_ms=self.stats.time_ms,
            )
        return self.configs

    def _timed_out(self) -> bool:
        if self.stats.timed_out:
            return True
        if self.stats.nodes & 63 == 0 and time.perf_counter() >= self._deadline:
            self.stats.timed_out = True
            return True
        return False

    def _over_budget(self) -> bool:
        return self._timed_out() or len(self.configs) >= self.max_configs

    def _state_key(self) -> bytes:
        return self.must.key() + b"|" + self.opt.key()

    def _search(self) -> bool:
        self.stats.nodes += 1
        if self._over_budget():
            return bool(self.configs)

        if not self.must.has_numbered() and self.must.jokers == 0:
            self._record()
            self._try_extra_from_opt()
            return True

        key = self._state_key()
        if key in self.fail_cache:
            self.stats.cache_hits += 1
            return False

        found = False
        if self.must.has_numbered():
            color, rank = self.must.first_numbered()
            found = self._try_kinds(color, rank) or found
        else:
            found = self._try_joker_anchor() or found

        if not found and not self.stats.timed_out and len(self.configs) < self.max_configs:
            self.fail_cache.add(key)
        return found

    def _try_extra_from_opt(self) -> None:
        """Play more optional tiles, or leave smaller tiles in the rack.

        Forcing only the smallest remaining tile would make it impossible to
        keep low tiles and play a disjoint high-value meld (the 30-point open).
        """
        if self._over_budget() or not self.opt.has_numbered():
            return
        color, rank = self.opt.first_numbered()
        if self.min_initial_points:
            self._skip_opt_tile(color, rank)
            if self._over_budget():
                return
            self._force_opt_tile(color, rank)
        else:
            self._force_opt_tile(color, rank)
            if self._over_budget():
                return
            self._skip_opt_tile(color, rank)

    def _force_opt_tile(self, color: int, rank: int) -> None:
        # Keep the tile in `opt` so the meld is materialized from the rack, not the table.
        self._try_kinds(color, rank)

    def _try_kinds(self, color: int, rank: int) -> bool:
        """Explore groups and runs with a 50/50 beam split at the first choice."""
        groups_first = (color + rank) % 2 == 0
        first = self._try_groups if groups_first else self._try_runs
        second = self._try_runs if groups_first else self._try_groups
        saved = self.max_configs
        if not self.current:
            remaining = max(0, saved - len(self.configs))
            self.max_configs = len(self.configs) + remaining - remaining // 2
        try:
            found = first(color, rank)
        finally:
            self.max_configs = saved
        if not self._timed_out():
            found = second(color, rank) or found
        return found

    def _skip_opt_tile(self, color: int, rank: int) -> None:
        self.opt.take(color, rank)
        self.skipped.put(color, rank)
        self._try_extra_from_opt()
        self.skipped.take(color, rank)
        self.opt.put(color, rank)

    def _try_groups(self, color: int, rank: int) -> bool:
        found = False
        others = [c for c in range(NUM_COLORS) if c != color]
        for extra_n in (3, 2):
            for extra in combinations(others, extra_n):
                colors = (color, *extra)
                if self._play_group(colors, rank):
                    found = True
                if self._over_budget():
                    return found
        return found

    def _play_group(
        self,
        colors: tuple[int, ...],
        rank: int,
        *,
        require_must_joker: bool = False,
    ) -> bool:
        sources: list[tuple[str, int, int]] = []
        for c in colors:
            src = consume_numbered(self.must, self.opt, c, rank)
            if src is None:
                for source, col, rnk in reversed(sources):
                    undo_consume(self.must, self.opt, source, col, rnk)
                return False
            sources.append((src, c, rank))
        if require_must_joker and not any(src == "joker_must" for src, _c, _r in sources):
            for source, col, rnk in reversed(sources):
                undo_consume(self.must, self.opt, source, col, rnk)
            return False
        part = _Part(MeldKind.GROUP, tuple(sources))
        self.current.append(part)
        found = self._search()
        self.current.pop()
        for source, col, rnk in reversed(sources):
            undo_consume(self.must, self.opt, source, col, rnk)
        return found

    def _try_runs(self, color: int, rank: int) -> bool:
        found = False
        for ranks in _run_arcs_containing(rank):
            if self._play_run(color, ranks):
                found = True
            if self._over_budget():
                return found
        return found

    def _play_run(
        self,
        color: int,
        ranks: list[int],
        *,
        require_must_joker: bool = False,
    ) -> bool:
        sources: list[tuple[str, int, int]] = []
        ok = True
        for rnk in ranks:
            src = consume_numbered(self.must, self.opt, color, rnk)
            if src is None:
                ok = False
                break
            sources.append((src, color, rnk))
        found = False
        if ok and (not require_must_joker or any(src == "joker_must" for src, _c, _r in sources)):
            part = _Part(MeldKind.RUN, tuple(sources))
            self.current.append(part)
            found = self._search()
            self.current.pop()
        for source, col, rnk in reversed(sources):
            undo_consume(self.must, self.opt, source, col, rnk)
        return found

    def _try_joker_anchor(self) -> bool:
        groups_first = self.stats.nodes % 2 == 0
        saved = self.max_configs
        remaining = max(0, saved - len(self.configs))
        self.max_configs = len(self.configs) + remaining - remaining // 2
        order = (
            (self._joker_groups, self._joker_runs)
            if groups_first
            else (self._joker_runs, self._joker_groups)
        )
        try:
            found = order[0]()
        finally:
            self.max_configs = saved
        if not self._timed_out():
            found = order[1]() or found
        return found

    def _joker_groups(self) -> bool:
        found = False
        others = list(range(NUM_COLORS))
        for rank in range(MIN_RANK, MAX_RANK + 1):
            for extra_n in (3, 4):
                for colors in combinations(others, extra_n):
                    if self._play_group(tuple(colors), rank, require_must_joker=True):
                        found = True
                    if self._over_budget():
                        return found
        return found

    def _joker_runs(self) -> bool:
        found = False
        for color in range(NUM_COLORS):
            for ranks in _all_run_arcs():
                if self._play_run(color, ranks, require_must_joker=True):
                    found = True
                if self._over_budget():
                    return found
        return found

    def _opt_used_count(self) -> int:
        used = 0
        for part in self.current:
            for source, _color, _rank in part.items:
                if source in ("opt", "joker_opt"):
                    used += 1
        return used

    def _record(self) -> None:
        used_count = self._opt_used_count()
        if used_count < self.min_rack_played:
            return
        try:
            config = self._materialize()
        except (ValueError, IndexError, KeyError):
            return
        validate_entire_table(config.table)
        if self.min_initial_points:
            new_melds = config.table.melds[len(self.frozen_melds) :]
            if any(tile.is_joker for meld in new_melds for tile in meld.tiles):
                return
            new_points = sum(m.point_value() for m in new_melds)
            if new_points < self.min_initial_points:
                return
        key = config.table.canonical_key() + (tuple(t.id for t in config.rack_used),)
        if key in self.seen_table:
            return
        self.seen_table.add(key)
        self.configs.append(config)

    def _rank(self, cfg: TableConfiguration) -> tuple:
        return (-cfg.tiles_played, cfg.remaining_deadwood())

    def _materialize(self) -> TableConfiguration:
        table_pool = _pool_from(self.table_tiles)
        rack_pool = _pool_from(self.rack_tiles)
        built: list[Meld] = list(self.frozen_melds)
        used_ids: set[int] = set()
        for part in self.current:
            meld, ids = _meld_from_part(part, table_pool, rack_pool)
            built.append(meld)
            used_ids.update(ids)
        rack_used = tuple(t for t in self.rack_tiles if t.id in used_ids)
        rack_left = tuple(t for t in self.rack_tiles if t.id not in used_ids)
        table = Table(tuple(built))
        return TableConfiguration(
            table=table,
            rack_used=rack_used,
            rack_left=rack_left,
            solver_mode=self.mode,
        )


def _pool_from(tiles: list[Tile]) -> dict[object, list[Tile]]:
    pool: dict[object, list[Tile]] = {}
    for tile in tiles:
        key: object = "J" if tile.is_joker else (int(tile.color), tile.rank)
        pool.setdefault(key, []).append(tile)
    return pool


def _pop(pool: dict[object, list[Tile]], key: object) -> Tile:
    bucket = pool.get(key)
    if not bucket:
        raise KeyError(key)
    return bucket.pop()


def _meld_from_part(
    part: _Part,
    table_pool: dict[object, list[Tile]],
    rack_pool: dict[object, list[Tile]],
) -> tuple[Meld, list[int]]:
    tiles: list[Tile] = []
    bindings: list[JokerBinding] = []
    ids: list[int] = []
    for source, color, rank in part.items:
        if source in ("joker_must", "joker_opt"):
            pool = table_pool if source == "joker_must" else rack_pool
            tile = _pop(pool, "J")
            bindings.append(JokerBinding(tile.id, Color(color), rank))
        else:
            pool = table_pool if source == "must" else rack_pool
            tile = _pop(pool, (color, rank))
        tiles.append(tile)
        ids.append(tile.id)
    meld = Meld(part.kind, tuple(tiles), tuple(bindings))
    return meld, ids


_ALL_RUN_ARCS: list[list[int]] | None = None


def _all_run_arcs() -> list[list[int]]:
    global _ALL_RUN_ARCS
    if _ALL_RUN_ARCS is None:
        seen: set[frozenset[int]] = set()
        arcs: list[list[int]] = []
        for length in range(3, NUM_RANKS + 1):
            for start in range(MIN_RANK, MAX_RANK + 1):
                ranks = run_ranks_from_start(start, length)
                key = frozenset(ranks)
                if key in seen:
                    continue
                seen.add(key)
                arcs.append(ranks)
        arcs.sort(key=len, reverse=True)
        _ALL_RUN_ARCS = arcs
    return _ALL_RUN_ARCS


def _run_arcs_containing(rank: int) -> list[list[int]]:
    return [arc for arc in _all_run_arcs() if rank in arc]
