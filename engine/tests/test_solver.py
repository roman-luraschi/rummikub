import pytest

from rummikub.game.tile import parse_tiles
from rummikub.game.meld import MeldKind
from rummikub.game.runs import run_display_order
from rummikub.solver import NoLegalPlay, SolverMode, TableSolver, find_play_for_selected_tiles
from tests.helpers import group, run, table_of


def test_add_only_extends_run():
    table = table_of(run("1R 2R 3R 4R"))
    rack = parse_tiles("5R")
    configs = TableSolver().solve(table, rack, mode=SolverMode.ADD_ONLY, time_limit_ms=200)
    assert configs
    best = configs[0]
    assert best.tiles_played == 1
    ranks = sorted(r for _c, r in best.table.melds[0].represented())
    assert ranks == [1, 2, 3, 4, 5]


def test_full_reorganization_is_not_hardcoded():
    """The prompt example: FULL should dump all 5 rack tiles by rearranging the table."""
    table = table_of(
        run("3R 4R 5R 6R"),
        run("7R 8R 9R"),
        group("5B 5N 5A"),
    )
    rack = parse_tiles("6B 6N 7B 7N 10R")
    solver = TableSolver()
    full = solver.solve(table, rack, mode=SolverMode.FULL, max_configs=80, time_limit_ms=1000)
    assert full, "FULL solver returned no legal configurations"
    best = full[0]
    assert best.tiles_played == 5, (
        f"expected to play all 5 rack tiles, played {best.tiles_played}: {best.table}"
    )
    assert not best.rack_left

    add_only = solver.solve(table, rack, mode=SolverMode.ADD_ONLY, max_configs=40, time_limit_ms=400)
    assert add_only
    assert add_only[0].tiles_played < 5, "ADD_ONLY should not match FULL's rearrangement power"


def test_initial_opening_cannot_use_joker():
    table = table_of()
    rack = parse_tiles("10R 11R J 1A 2A 3A")
    selected = [t for t in rack if t.is_joker or str(t) in {"10R", "11R"}]
    with pytest.raises(NoLegalPlay, match="comodines"):
        find_play_for_selected_tiles(table, rack, [t.id for t in selected], has_initial_meld=False)
    configs = TableSolver().solve(
        table,
        rack,
        mode=SolverMode.INITIAL,
        min_initial_points=30,
        max_configs=40,
        time_limit_ms=400,
    )
    assert not configs


def test_initial_solver_keeps_numbered_opening_and_leaves_joker():
    table = table_of()
    rack = parse_tiles("10R 11R 12R J 1A 2A")
    configs = TableSolver().solve(
        table,
        rack,
        mode=SolverMode.INITIAL,
        min_initial_points=30,
        max_configs=40,
        time_limit_ms=400,
    )
    assert configs
    for cfg in configs:
        assert all(not tile.is_joker for meld in cfg.table.melds for tile in meld.tiles)


def test_initial_meld_requires_30_points():
    table = table_of()
    rack = parse_tiles("1R 2R 3R 4B 5B 6B 10N 11N 12N 13A 1A 2A 3A 4A")
    configs = TableSolver().solve(
        table,
        rack,
        mode=SolverMode.INITIAL,
        min_initial_points=30,
        max_configs=40,
        time_limit_ms=400,
    )
    assert configs
    assert all(
        sum(m.point_value() for m in cfg.table.melds) >= 30 for cfg in configs
    )


def test_joker_completes_a_run():
    table = table_of(run("2A 3A 4A"))
    rack = parse_tiles("J")
    configs = TableSolver().solve(table, rack, mode=SolverMode.ADD_ONLY, time_limit_ms=200)
    assert configs
    assert configs[0].tiles_played == 1
    represented = sorted(configs[0].table.melds[0].represented(), key=lambda cr: cr[1])
    ranks = [r for _c, r in represented]
    assert ranks in ([1, 2, 3, 4], [2, 3, 4, 5])


def _screenshot_rack():
    return parse_tiles(
        "1R 5R 5R 6R 6R 7R 8R 10R 10R 12R 12R 13R 2B 3B 6B "
        "8B 9B 10B 12B 13B 1N 2N 3N 5N 7N 8N 10N 11N 11N 13N "
        "1A 1A 3A 3A 4A 6A 8A 10A 11A 11A 12A 13A"
    )


def test_initial_play_uses_selected_duplicate_not_the_other_copy():
    """10A-11A-12A is a 33-point opening even when another 11A sits between them."""
    rack = _screenshot_rack()
    assert len(rack) == 42
    ten_a = next(t for t in rack if str(t) == "10A")
    eleven_copies = [t for t in rack if str(t) == "11A"]
    twelve_a = next(t for t in rack if str(t) == "12A")
    selected_eleven = eleven_copies[0]
    unused_eleven = eleven_copies[1]
    cfg = find_play_for_selected_tiles(
        table_of(),
        rack,
        [ten_a.id, selected_eleven.id, twelve_a.id],
        has_initial_meld=False,
    )
    used = {t.id for t in cfg.rack_used}
    assert used == {ten_a.id, selected_eleven.id, twelve_a.id}
    assert unused_eleven.id not in used
    assert sum(m.point_value() for m in cfg.table.melds) == 33


def test_initial_play_rejects_run_under_30_points():
    rack = parse_tiles("1A 2A 3A 10N 11N 12N")
    low = [t for t in rack if str(t) in {"1A", "2A", "3A"}]
    with pytest.raises(NoLegalPlay):
        find_play_for_selected_tiles(
            table_of(),
            rack,
            [t.id for t in low],
            has_initial_meld=False,
        )


def test_initial_play_two_melds_from_selection():
    rack = parse_tiles("10R 11R 12R 8B 8N 8A 1A 2A")
    selected = [t for t in rack if str(t) not in {"1A", "2A"}]
    cfg = find_play_for_selected_tiles(
        table_of(),
        rack,
        [t.id for t in selected],
        has_initial_meld=False,
    )
    assert {t.id for t in cfg.rack_used} == {t.id for t in selected}
    assert len(cfg.table.melds) == 2
    assert sum(m.point_value() for m in cfg.table.melds) == 57


def test_cannot_extend_table_run_before_opening():
    table = table_of(run("9R 10R 11R"), group("13R 13B 13N 13A"))
    rack = parse_tiles("3R 11R 12R 1B 6B 13B 6N 6A 7A 10A")
    twelve = next(t for t in rack if str(t) == "12R")
    with pytest.raises(NoLegalPlay, match="no se puede usar la mesa"):
        find_play_for_selected_tiles(table, rack, [twelve.id], has_initial_meld=False)


def test_after_opening_extends_run_with_selected_tile():
    table = table_of(run("9R 10R 11R"), group("13R 13B 13N 13A"))
    rack = parse_tiles("3R 11R 12R 1B 6B 13B 6N 6A 7A 10A")
    twelve = next(t for t in rack if str(t) == "12R")
    cfg = find_play_for_selected_tiles(table, rack, [twelve.id], has_initial_meld=True)
    assert {t.id for t in cfg.rack_used} == {twelve.id}
    run_ranks = sorted(r for _c, r in cfg.table.melds[0].represented())
    assert run_ranks == [9, 10, 11, 12]


def test_after_opening_wraps_1_onto_13():
    table = table_of(run("11N 12N 13N"), group("13R 13B 13A"))
    rack = parse_tiles("1N 1B 2A")
    one = next(t for t in rack if str(t) == "1N")
    cfg = find_play_for_selected_tiles(table, rack, [one.id], has_initial_meld=True)
    assert {t.id for t in cfg.rack_used} == {one.id}
    ranks = [r for _c, r in cfg.table.melds[0].represented()]
    assert run_display_order(ranks) == [11, 12, 13, 1]


def test_after_opening_puts_13_before_1():
    table = table_of(run("1A 2A 3A"))
    rack = parse_tiles("13A 6B 7N")
    thirteen = next(t for t in rack if str(t) == "13A")
    cfg = find_play_for_selected_tiles(table, rack, [thirteen.id], has_initial_meld=True)
    ranks = [r for _c, r in cfg.table.melds[0].represented()]
    assert run_display_order(ranks) == [13, 1, 2, 3]


def test_solver_keeps_group_and_run_when_both_are_legal():
    """A beam of groups should not crowd out a legal run of the same tiles."""
    table = table_of()
    rack = parse_tiles("10R 10B 10N 10A 11R 12R")
    configs = TableSolver().solve(
        table,
        rack,
        mode=SolverMode.INITIAL,
        min_initial_points=30,
        max_configs=4,
        time_limit_ms=400,
    )
    assert configs
    kinds = {meld.kind for cfg in configs for meld in cfg.table.melds}
    assert MeldKind.GROUP in kinds
    assert MeldKind.RUN in kinds


def test_solver_never_returns_invalid_table():
    table = table_of(run("2B 3B 4B"), group("9R 9B 9N"))
    rack = parse_tiles("5B 9A 11R 12R 13R")
    for mode in (SolverMode.ADD_ONLY, SolverMode.LOCAL, SolverMode.FULL):
        configs = TableSolver().solve(table, rack, mode=mode, max_configs=30, time_limit_ms=300)
        assert configs
        for cfg in configs:
            ids = cfg.table.tile_ids()
            assert table.tile_ids().issubset(ids)


def test_layout_rejects_joker_on_initial_opening():
    from rummikub.solver.layout import configuration_from_layout

    rack = parse_tiles("10R 11R J 1A 2A")
    selected = [t for t in rack if t.is_joker or str(t) in {"10R", "11R"}]
    with pytest.raises(ValueError, match="comodines"):
        configuration_from_layout(
            table_of(),
            rack,
            [[t.id for t in selected]],
            has_initial_meld=False,
        )


def test_configuration_from_layout_uses_player_piles():
    from rummikub.solver.layout import configuration_from_layout

    table = table_of(run("9R 10R 11R"))
    rack = parse_tiles("12R 5B 6B 7B")
    twelve = next(t for t in rack if str(t) == "12R")
    blues = [t for t in rack if str(t) in {"5B", "6B", "7B"}]
    cfg = configuration_from_layout(
        table,
        rack,
        [
            [t.id for t in table.melds[0].tiles] + [twelve.id],
            [t.id for t in blues],
        ],
        has_initial_meld=True,
    )
    assert {t.id for t in cfg.rack_used} == {twelve.id, *[t.id for t in blues]}
    assert len(cfg.table.melds) == 2


def test_layout_accepts_1_after_13():
    from rummikub.solver.layout import configuration_from_layout

    table = table_of(run("11N 12N 13N"))
    rack = parse_tiles("1N")
    one = rack[0]
    cfg = configuration_from_layout(
        table,
        rack,
        [[t.id for t in table.melds[0].tiles] + [one.id]],
        has_initial_meld=True,
    )
    assert {t.id for t in cfg.rack_used} == {one.id}
    assert run_display_order([r for _c, r in cfg.table.melds[0].represented()]) == [11, 12, 13, 1]

