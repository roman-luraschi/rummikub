from rummikub.eval import StateEvaluator
from rummikub.game.table import Table
from rummikub.game.tile import parse_tiles
from rummikub.game.view import PlayerView
from rummikub.solver.types import SolverMode, TableConfiguration
from tests.helpers import group, run, table_of


def _view(rack: str, table: Table | None = None) -> PlayerView:
    tiles = parse_tiles(rack)
    return PlayerView(
        player_id=0,
        rack=tuple(tiles),
        table=table or Table(),
        rack_sizes=(len(tiles), 10),
        pool_size=40,
        current=0,
        has_initial_meld=(True, True),
        scores=(0, 0),
        history=(),
        names=("A", "B"),
        is_bot=(False, True),
        difficulties=(None, "hard"),
    )


def test_going_out_dominates():
    view = _view("5R 6R 7R")
    evaluator = StateEvaluator()
    leftover = TableConfiguration(
        table=table_of(run("5R 6R 7R")),
        rack_used=parse_tiles("5R 6R 7R"),
        rack_left=(),
        solver_mode=SolverMode.FULL,
    )
    keep = TableConfiguration(
        table=table_of(run("5R 6R 7R")),
        rack_used=parse_tiles("5R 6R"),
        rack_left=tuple(parse_tiles("7R")),
        solver_mode=SolverMode.FULL,
    )
    out = evaluator.evaluate_play(view, leftover)
    held = evaluator.evaluate_play(view, keep)
    assert out.total > held.total
    assert "rummikub" in out.terms


def test_open_group_and_short_run_score_the_same_table_flex():
    evaluator = StateEvaluator()
    with_group = evaluator.evaluate_view(_view("1A", table_of(group("10R 10B 10N"))))
    with_run = evaluator.evaluate_view(_view("1A", table_of(run("10R 11R 12R"))))
    assert with_group.terms["table_flexibility"] == with_run.terms["table_flexibility"]


def test_flexible_hand_beats_isolated_at_same_size():
    evaluator = StateEvaluator()
    flexible = _view("4R 5R 6R 7R 5B 5N 8R 9R")
    isolated = _view("13R 1B 12N 2A 10B 11N 3A 9N")
    flex_score = evaluator.evaluate_view(flexible)
    iso_score = evaluator.evaluate_view(isolated)
    assert flex_score.total > iso_score.total
    assert flex_score.terms["flexibility"] > iso_score.terms["flexibility"]


def test_dumping_a_ready_meld_beats_drawing():
    from random import Random

    from rummikub.ai.bot import RummyBot
    from rummikub.ai.difficulty import Difficulty
    from rummikub.game.meld import JokerBinding
    from rummikub.game.tile import Color, Tile
    from rummikub.rules.table_validator import make_group, make_run

    def numbered(color, rank, copy=0):
        return Tile.numbered(color, rank, copy)

    table = table_of(
        make_run([numbered(Color.BLACK, 12), numbered(Color.BLACK, 13), numbered(Color.BLACK, 1)]),
        make_group([numbered(Color.RED, 10), numbered(Color.BLACK, 10), numbered(Color.ORANGE, 10)]),
        make_group(
            [numbered(Color.RED, 2), numbered(Color.BLUE, 2), Tile.joker(0)],
            [JokerBinding(Tile.joker(0).id, Color.BLACK, 2)],
        ),
    )
    rack = [
        numbered(Color.RED, 3), numbered(Color.RED, 5), numbered(Color.RED, 6),
        numbered(Color.RED, 7), numbered(Color.RED, 8), numbered(Color.RED, 13),
        numbered(Color.BLUE, 3), numbered(Color.BLUE, 5), numbered(Color.BLUE, 6),
        numbered(Color.BLUE, 12), numbered(Color.BLUE, 13),
        numbered(Color.BLACK, 1, 1), numbered(Color.BLACK, 2), numbered(Color.BLACK, 4),
        numbered(Color.BLACK, 5), numbered(Color.BLACK, 6), numbered(Color.BLACK, 7),
        numbered(Color.BLACK, 8), numbered(Color.BLACK, 11), numbered(Color.BLACK, 12, 1),
        numbered(Color.ORANGE, 2), numbered(Color.ORANGE, 4), numbered(Color.ORANGE, 4, 1),
        numbered(Color.ORANGE, 6), numbered(Color.ORANGE, 7), numbered(Color.ORANGE, 9),
        numbered(Color.ORANGE, 10, 1),
    ]
    view = PlayerView(
        player_id=0,
        rack=tuple(rack),
        table=table,
        rack_sizes=(27, 5),
        pool_size=20,
        current=0,
        has_initial_meld=(True, True),
        scores=(0, 0),
        history=(),
        names=("A", "B"),
        is_bot=(True, True),
        difficulties=("extreme", "easy"),
    )
    evaluator = StateEvaluator()
    draw = evaluator.evaluate_draw(view)
    move = RummyBot().choose_move(view, Difficulty.EXTREME, rng=Random(1), debug=False)
    assert move.config is not None, "Extreme must dump ready melds instead of drawing"
    play = evaluator.evaluate_play(view, move.config)
    assert play.total > draw.total
    assert move.config.tiles_played >= 3
