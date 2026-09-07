from __future__ import annotations

from itertools import combinations

from rummikub.game.meld import JokerBinding, Meld, MeldKind
from rummikub.game.table import Table
from rummikub.game.tile import Color, NUM_COLORS, NUM_RANKS, Tile
from rummikub.game.runs import next_rank, prev_rank, run_display_order
from rummikub.rules.table_validator import TableValidationError, make_group, make_run, validate_entire_table
from rummikub.solver.partition import PartitionSearch
from rummikub.solver.types import SolverMode, TableConfiguration


class NoLegalPlay(ValueError):
    """The selected rack tiles cannot be played as a legal turn."""


class TableSolver:
    """Find legal table configurations after a turn.

    ADD_ONLY: extend existing melds and/or put down new ones. Never breaks a meld.
    LOCAL: unfreeze up to `max_unfreeze` melds and fully repartition them.
    FULL: repartition the entire table plus a subset of the rack.
    INITIAL: new melds from the rack only, worth at least 30 points.
    """

    def solve(
        self,
        table: Table,
        rack: list[Tile],
        *,
        mode: SolverMode = SolverMode.FULL,
        min_rack_played: int = 1,
        max_configs: int = 64,
        time_limit_ms: float = 200.0,
        max_unfreeze: int = 2,
        min_initial_points: int = 30,
    ) -> list[TableConfiguration]:
        if mode is SolverMode.INITIAL:
            return self._initial(
                table, rack, max_configs, time_limit_ms, min_initial_points, min_rack_played
            )
        if mode is SolverMode.ADD_ONLY:
            return self._add_only(table, rack, min_rack_played, max_configs, time_limit_ms)
        if mode is SolverMode.LOCAL:
            return self._local(
                table, rack, min_rack_played, max_configs, time_limit_ms, max_unfreeze
            )
        return self._full(table, rack, min_rack_played, max_configs, time_limit_ms)

    def _full(
        self,
        table: Table,
        rack: list[Tile],
        min_rack_played: int,
        max_configs: int,
        time_limit_ms: float,
    ) -> list[TableConfiguration]:
        search = PartitionSearch(
            table.all_tiles(),
            list(rack),
            min_rack_played=min_rack_played,
            max_configs=max_configs,
            time_limit_ms=time_limit_ms,
            mode=SolverMode.FULL,
        )
        return search.solve()

    def _initial(
        self,
        table: Table,
        rack: list[Tile],
        max_configs: int,
        time_limit_ms: float,
        min_initial_points: int,
        min_rack_played: int,
    ) -> list[TableConfiguration]:
        search = PartitionSearch(
            [],
            list(rack),
            frozen_melds=table.melds,
            min_rack_played=min_rack_played,
            max_configs=max_configs,
            time_limit_ms=time_limit_ms,
            min_initial_points=min_initial_points,
            mode=SolverMode.INITIAL,
        )
        return search.solve()

    def _add_only(
        self,
        table: Table,
        rack: list[Tile],
        min_rack_played: int,
        max_configs: int,
        time_limit_ms: float,
    ) -> list[TableConfiguration]:
        configs: list[TableConfiguration] = []
        seen: set[tuple] = set()

        def rec(index: int, remaining: list[Tile], built: list[Meld], used: list[Tile]) -> None:
            if len(configs) >= max_configs:
                return
            if index == len(table.melds):
                already = len(used)
                min_more = max(0, min_rack_played - already)
                search = PartitionSearch(
                    [],
                    list(remaining),
                    frozen_melds=tuple(built),
                    min_rack_played=min_more,
                    max_configs=max_configs - len(configs),
                    time_limit_ms=time_limit_ms,
                    mode=SolverMode.ADD_ONLY,
                )
                for cfg in search.solve():
                    merged_used = tuple(used) + cfg.rack_used
                    merged_left = cfg.rack_left
                    if len(merged_used) < min_rack_played:
                        continue
                    merged = TableConfiguration(
                        table=cfg.table,
                        rack_used=merged_used,
                        rack_left=merged_left,
                        solver_mode=SolverMode.ADD_ONLY,
                        nodes=cfg.nodes,
                        cache_hits=cfg.cache_hits,
                        time_ms=cfg.time_ms,
                    )
                    validate_entire_table(merged.table)
                    key = merged.table.canonical_key() + (tuple(t.id for t in merged.rack_used),)
                    if key not in seen:
                        seen.add(key)
                        configs.append(merged)
                return
            meld = table.melds[index]
            for new_meld, consumed in _extension_options(meld, remaining):
                consumed_ids = {t.id for t in consumed}
                next_remaining = [t for t in remaining if t.id not in consumed_ids]
                rec(index + 1, next_remaining, built + [new_meld], used + consumed)

        rec(0, list(rack), [], [])
        configs.sort(key=lambda c: (-c.tiles_played, c.remaining_deadwood()))
        return configs[:max_configs]

    def _local(
        self,
        table: Table,
        rack: list[Tile],
        min_rack_played: int,
        max_configs: int,
        time_limit_ms: float,
        max_unfreeze: int,
    ) -> list[TableConfiguration]:
        configs: list[TableConfiguration] = []
        seen: set[tuple] = set()
        n = len(table.melds)
        if n == 0:
            return self._full(table, rack, min_rack_played, max_configs, time_limit_ms)
        limit = min(max_unfreeze, n)
        per_budget = max(20.0, time_limit_ms / max(1, limit * n))
        for k in range(1, limit + 1):
            for idxs in combinations(range(n), k):
                if len(configs) >= max_configs:
                    break
                idx_set = set(idxs)
                frozen = tuple(m for i, m in enumerate(table.melds) if i not in idx_set)
                free: list[Tile] = []
                for i in idxs:
                    free.extend(table.melds[i].tiles)
                search = PartitionSearch(
                    free,
                    list(rack),
                    frozen_melds=frozen,
                    min_rack_played=min_rack_played,
                    max_configs=max_configs,
                    time_limit_ms=per_budget,
                    mode=SolverMode.LOCAL,
                )
                for cfg in search.solve():
                    key = cfg.table.canonical_key() + (tuple(t.id for t in cfg.rack_used),)
                    if key not in seen:
                        seen.add(key)
                        configs.append(cfg)
        configs.sort(key=lambda c: (-c.tiles_played, c.remaining_deadwood()))
        return configs[:max_configs]


def find_play_for_selected_tiles(
    table: Table,
    rack: list[Tile],
    tile_ids: list[int],
    *,
    has_initial_meld: bool,
    min_initial_points: int = 30,
    max_configs: int = 48,
    time_limit_ms: float = 450,
) -> TableConfiguration:
    """Build a legal play that uses the player's selected rack tiles.

    The solver must search *only* those tiles. Searching the whole rack can
    materialize a duplicate copy the player did not click (e.g. the other 11A)
    and then reject the selection as illegal.
    """
    wanted = set(tile_ids)
    if not tile_ids:
        raise NoLegalPlay("A play must use at least one rack tile")
    if len(wanted) != len(tile_ids):
        raise NoLegalPlay("Duplicate tile in selection")
    by_id = {t.id: t for t in rack}
    if not wanted.issubset(by_id):
        raise NoLegalPlay("Selected tiles are not in your rack")
    selected = [by_id[i] for i in tile_ids]

    if (cfg := _play_as_single_new_meld(table, rack, selected, has_initial_meld, min_initial_points)):
        return cfg

    solver = TableSolver()
    if has_initial_meld:
        for mode in (SolverMode.ADD_ONLY, SolverMode.FULL):
            configs = solver.solve(
                table,
                selected,
                mode=mode,
                min_rack_played=1,
                max_configs=max_configs,
                time_limit_ms=time_limit_ms,
                min_initial_points=0,
            )
            if (cfg := _pick_selected_config(configs, wanted, rack)):
                return cfg
        raise NoLegalPlay("No legal table rearrangement uses those tiles")

    configs = solver.solve(
        table,
        selected,
        mode=SolverMode.INITIAL,
        min_rack_played=1,
        max_configs=max_configs,
        time_limit_ms=time_limit_ms,
        min_initial_points=min_initial_points,
    )
    if (cfg := _pick_selected_config(configs, wanted, rack)):
        return cfg
    if table.melds and _selection_plays_on_table(
        solver, table, selected, wanted, rack, max_configs, time_limit_ms
    ):
        raise NoLegalPlay(
            "Todavía no abriste: no se puede usar la mesa. La apertura tiene que sumar "
            "30 puntos con combinaciones nuevas del atril, sin comodines."
        )
    raise NoLegalPlay(
        "Esas fichas no forman una apertura de 30 puntos sin usar la mesa ni comodines."
    )


def _pick_selected_config(
    configs: list[TableConfiguration],
    wanted: set[int],
    rack: list[Tile],
) -> TableConfiguration | None:
    exact = [c for c in configs if {t.id for t in c.rack_used} == wanted]
    if exact:
        return _with_remaining_rack(
            max(exact, key=lambda c: (c.tiles_played, -c.remaining_deadwood())), rack
        )
    partial = [c for c in configs if {t.id for t in c.rack_used}.issubset(wanted) and c.rack_used]
    if partial:
        return _with_remaining_rack(
            max(partial, key=lambda c: (c.tiles_played, -c.remaining_deadwood())), rack
        )
    return None


def _selection_plays_on_table(
    solver: TableSolver,
    table: Table,
    selected: list[Tile],
    wanted: set[int],
    rack: list[Tile],
    max_configs: int,
    time_limit_ms: float,
) -> bool:
    """True if the same tiles would be a legal add/rearrange after opening."""
    for mode in (SolverMode.ADD_ONLY, SolverMode.FULL):
        configs = solver.solve(
            table,
            selected,
            mode=mode,
            min_rack_played=1,
            max_configs=max_configs,
            time_limit_ms=min(200.0, time_limit_ms),
            min_initial_points=0,
        )
        if _pick_selected_config(configs, wanted, rack) is not None:
            return True
    return False


def _play_as_single_new_meld(
    table: Table,
    rack: list[Tile],
    selected: list[Tile],
    has_initial_meld: bool,
    min_initial_points: int,
) -> TableConfiguration | None:
    if not has_initial_meld and any(t.is_joker for t in selected):
        return None
    meld = _single_meld_from(selected)
    if meld is None:
        return None
    if not has_initial_meld and meld.point_value() < min_initial_points:
        return None
    used_ids = {t.id for t in selected}
    return TableConfiguration(
        table=Table(table.melds + (meld,)),
        rack_used=tuple(t for t in rack if t.id in used_ids),
        rack_left=tuple(t for t in rack if t.id not in used_ids),
        solver_mode=SolverMode.INITIAL if not has_initial_meld else SolverMode.FULL,
    )


def _single_meld_from(tiles: list[Tile]) -> Meld | None:
    if len(tiles) < 3 or any(t.is_joker for t in tiles):
        return None
    for factory in (make_run, make_group):
        try:
            return factory(list(tiles))
        except TableValidationError:
            continue
    return None


def _with_remaining_rack(cfg: TableConfiguration, rack: list[Tile]) -> TableConfiguration:
    used = {t.id for t in cfg.rack_used}
    return TableConfiguration(
        table=cfg.table,
        rack_used=cfg.rack_used,
        rack_left=tuple(t for t in rack if t.id not in used),
        solver_mode=cfg.solver_mode,
        nodes=cfg.nodes,
        cache_hits=cfg.cache_hits,
        time_ms=cfg.time_ms,
    )


def _extension_options(meld: Meld, rack: list[Tile]) -> list[tuple[Meld, list[Tile]]]:
    options: list[tuple[Meld, list[Tile]]] = [(meld, [])]
    if meld.kind is MeldKind.GROUP:
        options.extend(_group_extensions(meld, rack))
    else:
        options.extend(_run_extensions(meld, rack))
    return options


def _group_extensions(meld: Meld, rack: list[Tile]) -> list[tuple[Meld, list[Tile]]]:
    if len(meld.tiles) != 3:
        return []
    represented = meld.represented()
    rank = represented[0][1]
    used_colors = {c for c, _r in represented}
    results: list[tuple[Meld, list[Tile]]] = []
    for color in range(NUM_COLORS):
        if color in used_colors:
            continue
        tile = _take_from_rack(rack, color, rank)
        if tile is None:
            continue
        if tile.is_joker:
            bindings = list(meld.bindings) + [JokerBinding(tile.id, Color(color), rank)]
        else:
            bindings = list(meld.bindings)
        new_meld = make_group(list(meld.tiles) + [tile], bindings)
        results.append((new_meld, [tile]))
    return results


def _run_extensions(meld: Meld, rack: list[Tile]) -> list[tuple[Meld, list[Tile]]]:
    represented = meld.represented()
    color = Color(represented[0][0])
    ranks = run_display_order([r for _c, r in represented])
    occupied = set(ranks)
    results: list[tuple[Meld, list[Tile]]] = []
    max_grow = NUM_RANKS - len(ranks)

    def grow(left: int, right: int) -> None:
        if left == 0 and right == 0:
            return
        remaining = list(rack)
        consumed: list[Tile] = []
        bindings = list(meld.bindings)
        taken: set[int] = set(occupied)
        ok = True
        rank = ranks[0]
        for _ in range(left):
            rank = prev_rank(rank)
            if rank in taken:
                ok = False
                break
            tile = _take_from_list(remaining, int(color), rank)
            if tile is None:
                ok = False
                break
            taken.add(rank)
            consumed.append(tile)
            if tile.is_joker:
                bindings.append(JokerBinding(tile.id, color, rank))
        if ok:
            rank = ranks[-1]
            for _ in range(right):
                rank = next_rank(rank)
                if rank in taken:
                    ok = False
                    break
                tile = _take_from_list(remaining, int(color), rank)
                if tile is None:
                    ok = False
                    break
                taken.add(rank)
                consumed.append(tile)
                if tile.is_joker:
                    bindings.append(JokerBinding(tile.id, color, rank))
        if not ok or not consumed:
            return
        new_meld = make_run(list(meld.tiles) + consumed, bindings)
        results.append((new_meld, consumed))

    for left in range(0, max_grow + 1):
        for right in range(0, max_grow - left + 1):
            grow(left, right)
    return results


def _take_from_rack(rack: list[Tile], color: int, rank: int) -> Tile | None:
    return _take_from_list(list(rack), color, rank)


def _take_from_list(rack: list[Tile], color: int, rank: int) -> Tile | None:
    for i, tile in enumerate(rack):
        if not tile.is_joker and int(tile.color) == color and tile.rank == rank:
            return rack.pop(i)
    for i, tile in enumerate(rack):
        if tile.is_joker:
            return rack.pop(i)
    return None
