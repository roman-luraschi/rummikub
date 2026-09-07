from rummikub.game.engine import GameEngine, GameState, IllegalMove, new_game
from rummikub.game.player import Player
from rummikub.game.table import Table
from rummikub.game.tile import build_deck, parse_tiles
from rummikub.rules.table_validator import validate_entire_table
from rummikub.solver import SolverMode, TableConfiguration, TableSolver, find_play_for_selected_tiles
from tests.helpers import run, table_of
import pytest


def test_new_game_is_reproducible():
    a = new_game(n_players=2, seed=12345)
    b = new_game(n_players=2, seed=12345)
    assert [t.id for t in a.players[0].rack] == [t.id for t in b.players[0].rack]
    assert [t.id for t in a.pool] == [t.id for t in b.pool]
    assert len(a.players[0].rack) == 14
    remaining = 106 - 14 * 2
    assert len(a.pool) == remaining


def test_tile_conservation():
    state = new_game(n_players=3, seed=7)
    ids = [t.id for p in state.players for t in p.rack] + [t.id for t in state.pool]
    assert sorted(ids) == sorted(t.id for t in build_deck())


def test_bot_view_hides_other_racks_and_pool():
    engine = GameEngine()
    state = engine.new_game(n_players=2, seed=3)
    view = engine.view(state, 0)
    assert {t.id for t in view.rack} == {t.id for t in state.players[0].rack}
    assert view.rack_sizes[1] == 14
    assert view.pool_size == len(state.pool)
    hidden = {t.id for t in state.players[1].rack}
    assert hidden.isdisjoint({t.id for t in view.rack})


def test_play_and_draw_roundtrip():
    engine = GameEngine()
    state = engine.new_game(n_players=2, seed=21)
    solver = TableSolver()
    player = state.players[0]
    configs = solver.solve(
        state.table,
        player.rack,
        mode=SolverMode.INITIAL,
        max_configs=20,
        time_limit_ms=400,
    )
    if not configs:
        nxt = engine.draw(state)
        assert len(nxt.players[0].rack) == 15
        assert nxt.current == 1
        return
    nxt = engine.play(state, configs[0])
    validate_entire_table(nxt.table)
    assert nxt.players[0].has_initial_meld
    assert nxt.current == 1


def test_cannot_return_table_tiles_to_rack():
    engine = GameEngine()
    table_tiles = parse_tiles("1R 2R 3R")
    rack = parse_tiles("4R 5B 6N")
    player = Player(id=0, name="P0", rack=list(rack), has_initial_meld=True)
    other = Player(id=1, name="P1", rack=parse_tiles("7A 8A 9A"), has_initial_meld=True)
    state = GameState(
        players=[player, other],
        pool=[],
        table=table_of(run("1R 2R 3R")),
        current=0,
        scores=[0, 0],
        seed=0,
    )
    forged = TableConfiguration(
        table=Table(),
        rack_used=(rack[0],),
        rack_left=tuple(rack[1:]),
        solver_mode=SolverMode.FULL,
    )
    with pytest.raises(IllegalMove, match="cannot return"):
        engine.play(state, forged)


def test_engine_rejects_joker_on_initial_meld():
    engine = GameEngine()
    opening = run("10R 11R J")
    rack = list(opening.tiles) + parse_tiles("1A 2A")
    player = Player(id=0, name="P0", rack=list(rack), has_initial_meld=False)
    other = Player(id=1, name="P1", rack=parse_tiles("7A 8A 9A"), has_initial_meld=True)
    state = GameState(
        players=[player, other],
        pool=[],
        table=Table(),
        current=0,
        scores=[0, 0],
        seed=0,
    )
    used_ids = {t.id for t in opening.tiles}
    forged = TableConfiguration(
        table=Table((opening,)),
        rack_used=tuple(opening.tiles),
        rack_left=tuple(t for t in rack if t.id not in used_ids),
        solver_mode=SolverMode.INITIAL,
    )
    with pytest.raises(IllegalMove, match="comodines"):
        engine.play(state, forged)


def test_initial_play_accepts_selected_30_point_run_with_duplicate_nearby():
    engine = GameEngine()
    rack = parse_tiles(
        "1R 5R 5R 6R 6R 7R 8R 10R 10R 12R 12R 13R 2B 3B 6B "
        "8B 9B 10B 12B 13B 1N 2N 3N 5N 7N 8N 10N 11N 11N 13N "
        "1A 1A 3A 3A 4A 6A 8A 10A 11A 11A 12A 13A"
    )
    eleven_copies = [t for t in rack if str(t) == "11A"]
    selected = [
        next(t for t in rack if str(t) == "10A"),
        eleven_copies[0],
        next(t for t in rack if str(t) == "12A"),
    ]
    player = Player(id=0, name="P0", rack=list(rack), has_initial_meld=False)
    other = Player(id=1, name="P1", rack=parse_tiles("7A 8A 9A"), has_initial_meld=True)
    state = GameState(
        players=[player, other],
        pool=[],
        table=Table(),
        current=0,
        scores=[0, 0],
        seed=0,
    )
    cfg = find_play_for_selected_tiles(
        state.table, player.rack, [t.id for t in selected], has_initial_meld=False
    )
    nxt = engine.play(state, cfg)
    assert nxt.players[0].has_initial_meld
    assert {t.id for t in nxt.table.all_tiles()} == {t.id for t in selected}
    assert eleven_copies[1] in nxt.players[0].rack

