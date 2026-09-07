from rummikub.game.meld import Meld
from rummikub.game.table import Table
from rummikub.game.tile import parse_tiles
from rummikub.rules.table_validator import infer_group_bindings, infer_run_bindings, make_group, make_run
from rummikub.game.runs import covering_run_ranks


def run(spec: str) -> Meld:
    tiles = parse_tiles(spec)
    numbered = [t for t in tiles if not t.is_joker]
    color = numbered[0].color
    ranks = _run_ranks(tiles, color)
    bindings = infer_run_bindings(tiles, color, ranks) if any(t.is_joker for t in tiles) else []
    return make_run(tiles, bindings)


def group(spec: str) -> Meld:
    tiles = parse_tiles(spec)
    numbered = [t for t in tiles if not t.is_joker]
    rank = numbered[0].rank if numbered else _group_rank_from_jokers(tiles)
    bindings = infer_group_bindings(tiles, rank) if any(t.is_joker for t in tiles) else []
    return make_group(tiles, bindings)


def table_of(*melds: Meld) -> Table:
    return Table(melds)


def _run_ranks(tiles, color):
    numbered_ranks = [t.rank for t in tiles if not t.is_joker]
    extra = sum(1 for t in tiles if t.is_joker)
    return covering_run_ranks(numbered_ranks, extra)


def _group_rank_from_jokers(tiles):
    raise ValueError("Cannot infer group rank from jokers only")
