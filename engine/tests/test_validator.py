import pytest

from rummikub.game.meld import JokerBinding, Meld, MeldKind
from rummikub.game.table import Table
from rummikub.game.tile import Color, parse_tiles
from rummikub.rules.table_validator import TableValidationError, make_group, make_run, try_make_meld, validate_entire_table
from tests.helpers import group, run, table_of


def test_valid_group_and_run():
    validate_entire_table(table_of(group("3R 3B 3N"), run("8A 9A 10A 11A 12A")))


def test_group_rejects_duplicate_color():
    tiles = parse_tiles("7R 7R 7B")
    meld = Meld(MeldKind.GROUP, tuple(tiles), ())
    with pytest.raises(TableValidationError):
        validate_entire_table(Table((meld,)))


def test_run_allows_wrap_around_13():
    validate_entire_table(table_of(run("12R 13R 1R"), run("13N 1N 2N")))
    wrapped = make_run(parse_tiles("12R 13R 1R"))
    assert [t.rank for t in wrapped.tiles] == [12, 13, 1]
    assert wrapped.canonical_key() != run("1R 2R 3R").canonical_key()


def test_run_rejects_broken_sequence():
    tiles = parse_tiles("1R 2R 4R")
    meld = Meld(MeldKind.RUN, tuple(tiles), ())
    with pytest.raises(TableValidationError):
        validate_entire_table(Table((meld,)))
    with pytest.raises(TableValidationError):
        make_run(parse_tiles("4B 5B"))


def test_table_rejects_duplicate_tile_ids():
    meld_a = run("1R 2R 3R")
    meld_b = Meld(MeldKind.RUN, meld_a.tiles, ())
    with pytest.raises(TableValidationError):
        validate_entire_table(Table((meld_a, meld_b)))


def test_joker_in_run_needs_binding():
    tiles = parse_tiles("4N 5N J")
    bindings = [JokerBinding(tiles[2].id, Color.BLACK, 6)]
    make_run(tiles, bindings)


def test_try_make_meld_group_and_visual_run():
    group_meld = try_make_meld(parse_tiles("7R 7B 7A"))
    assert group_meld.kind is MeldKind.GROUP
    run_meld = try_make_meld(parse_tiles("4N 5N J"))
    assert run_meld.kind is MeldKind.RUN
    assert run_meld.bindings[0].rank == 6


def test_try_make_meld_joker_leads_run():
    tiles = parse_tiles("J 4R 5R")
    meld = try_make_meld(tiles)
    assert meld.kind is MeldKind.RUN
    assert meld.bindings[0].rank == 3


def test_try_make_meld_wrap_run():
    meld = try_make_meld(parse_tiles("13N 1N 2N"))
    assert meld.kind is MeldKind.RUN
    assert [t.rank for t in meld.tiles] == [13, 1, 2]


def test_try_make_meld_rejects_short():
    with pytest.raises(TableValidationError):
        try_make_meld(parse_tiles("4B 5B"))
    a = table_of(group("5R 5B 5N"), run("1A 2A 3A"))
    b = table_of(run("1A 2A 3A"), group("5R 5B 5N"))
    assert a.canonical_hash() == b.canonical_hash()
    assert a.canonical_key() == b.canonical_key()
