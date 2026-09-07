from random import Random

from rummikub.ai.bot import RummyBot
from rummikub.ai.difficulty import CONFIGS, Difficulty
from rummikub.game.engine import GameEngine
from rummikub.game.tile import parse_tiles
from rummikub.game.view import PlayerView
from rummikub.solver import SolverMode
from tests.helpers import group, run, table_of


def test_bot_chooses_going_out_when_available():
    rack = parse_tiles("5R")
    view = PlayerView(
        player_id=0,
        rack=tuple(rack),
        table=table_of(run("2R 3R 4R")),
        rack_sizes=(1, 8),
        pool_size=20,
        current=0,
        has_initial_meld=(True, True),
        scores=(0, 0),
        history=(),
        names=("A", "B"),
        is_bot=(True, True),
        difficulties=("nightmare", "easy"),
    )
    move = RummyBot().choose_move(view, Difficulty.HARD, rng=Random(1), debug=True)
    assert move.config is not None
    assert not move.config.rack_left
    assert move.decision.states_evaluated >= 1


def test_bot_only_needs_player_view():
    engine = GameEngine()
    state = engine.new_game(n_players=2, seed=9, bots=["easy", "easy"])
    view = engine.view(state, 0)
    hidden = {t.id for t in state.players[1].rack}
    assert hidden.isdisjoint({t.id for t in view.rack})
    move = RummyBot().choose_move(view, "easy", rng=Random(2), debug=False)
    assert move.action in {"DRAW", "PLAY"} or move.config is not None


def test_nightmare_does_not_skip_a_simple_extension():
    table = table_of(run("2R 3R 4R"), run("8B 9B 10B"), group("7R 7B 7N"))
    rack = parse_tiles("5R 1A 12N")
    view = PlayerView(
        player_id=0,
        rack=tuple(rack),
        table=table,
        rack_sizes=(3, 8),
        pool_size=20,
        current=0,
        has_initial_meld=(True, True),
        scores=(0, 0),
        history=(),
        names=("A", "B"),
        is_bot=(True, True),
        difficulties=("nightmare", "easy"),
    )
    move = RummyBot().choose_move(view, Difficulty.NIGHTMARE, rng=Random(3), debug=False)
    assert move.config is not None
    assert any(str(t) == "5R" for t in move.config.rack_used)


def test_nightmare_must_play_when_the_pool_is_empty():
    table = table_of(run("2R 3R 4R"))
    rack = parse_tiles("5R 1A 12N")
    view = PlayerView(
        player_id=0,
        rack=tuple(rack),
        table=table,
        rack_sizes=(3, 5),
        pool_size=0,
        current=0,
        has_initial_meld=(True, True),
        scores=(0, 0),
        history=(),
        names=("A", "B"),
        is_bot=(True, True),
        difficulties=("nightmare", "easy"),
    )
    move = RummyBot().choose_move(view, Difficulty.NIGHTMARE, rng=Random(1), debug=False)
    assert move.config is not None
    assert any(str(t) == "5R" for t in move.config.rack_used)


def test_hard_dumps_then_rearranges_in_the_same_turn():
    table = table_of(
        run("3R 4R 5R 6R"),
        run("7R 8R 9R"),
        group("5B 5N 5A"),
    )
    rack = parse_tiles("6B 6N 7B 7N 10R")
    view = PlayerView(
        player_id=0,
        rack=tuple(rack),
        table=table,
        rack_sizes=(5, 8),
        pool_size=20,
        current=0,
        has_initial_meld=(True, True),
        scores=(0, 0),
        history=(),
        names=("A", "B"),
        is_bot=(True, True),
        difficulties=("hard", "easy"),
    )
    easy = RummyBot().choose_move(view, Difficulty.EASY, rng=Random(1), debug=False)
    hard = RummyBot().choose_move(view, Difficulty.HARD, rng=Random(1), debug=False)
    assert easy.config is not None
    assert easy.config.tiles_played < 5
    assert hard.config is not None
    assert hard.config.tiles_played == 5
    assert not hard.config.rack_left


def test_easy_and_hard_use_different_solver_modes():
    assert CONFIGS[Difficulty.EASY].solver_mode is SolverMode.ADD_ONLY
    assert CONFIGS[Difficulty.HARD].solver_mode is SolverMode.FULL
    assert CONFIGS[Difficulty.NIGHTMARE].time_limit_ms > CONFIGS[Difficulty.EASY].time_limit_ms
    assert CONFIGS[Difficulty.EASY].randomness > CONFIGS[Difficulty.NIGHTMARE].randomness
