from __future__ import annotations

from typing import Iterable

from rummikub.game.meld import JokerBinding, Meld, MeldKind
from rummikub.game.table import Table
from rummikub.game.tile import Color, MAX_RANK, MIN_RANK, NUM_COLORS, NUM_RANKS, Tile
from rummikub.game.runs import next_rank, ranks_form_run, run_display_order, step_rank


class TableValidationError(ValueError):
    pass


def validate_meld(meld: Meld) -> None:
    if len(meld.tiles) < 3:
        raise TableValidationError(f"Meld too short: {meld}")
    ids = [t.id for t in meld.tiles]
    if len(ids) != len(set(ids)):
        raise TableValidationError(f"Duplicate tile in meld: {meld}")

    jokers = [t for t in meld.tiles if t.is_joker]
    bound_ids = {b.joker_id for b in meld.bindings}
    actual_joker_ids = {t.id for t in jokers}
    if bound_ids != actual_joker_ids:
        raise TableValidationError(f"Joker bindings mismatch in {meld}")

    for binding in meld.bindings:
        if not MIN_RANK <= binding.rank <= MAX_RANK:
            raise TableValidationError(f"Invalid joker rank in {meld}")
        if not 0 <= int(binding.color) < NUM_COLORS:
            raise TableValidationError(f"Invalid joker color in {meld}")

    represented = meld.represented()
    if meld.kind is MeldKind.GROUP:
        _validate_group(meld, represented)
    elif meld.kind is MeldKind.RUN:
        _validate_run(meld, represented)
    else:
        raise TableValidationError(f"Unknown meld kind: {meld.kind}")


def _validate_group(meld: Meld, represented: list[tuple[int, int]]) -> None:
    if not 3 <= len(represented) <= 4:
        raise TableValidationError(f"Group must have 3 or 4 tiles: {meld}")
    ranks = {rank for _color, rank in represented}
    if len(ranks) != 1:
        raise TableValidationError(f"Group ranks must match: {meld}")
    colors = [color for color, _rank in represented]
    if len(colors) != len(set(colors)):
        raise TableValidationError(f"Group colors must be unique: {meld}")


def _validate_run(meld: Meld, represented: list[tuple[int, int]]) -> None:
    colors = {color for color, _rank in represented}
    if len(colors) != 1:
        raise TableValidationError(f"Run colors must match: {meld}")
    ranks = [rank for _color, rank in represented]
    if not ranks_form_run(ranks):
        raise TableValidationError(f"Run not consecutive: {meld}")


def validate_entire_table(table: Table) -> None:
    seen: set[int] = set()
    for meld in table.melds:
        validate_meld(meld)
        for tile in meld.tiles:
            if tile.id in seen:
                raise TableValidationError(f"Tile {tile} appears twice on the table")
            seen.add(tile.id)


def tiles_exist(tiles: Iterable[Tile], universe: Iterable[Tile]) -> None:
    universe_ids = {t.id for t in universe}
    for tile in tiles:
        if tile.id not in universe_ids:
            raise TableValidationError(f"Tile {tile} does not exist in the universe")


def make_group(tiles: list[Tile], bindings: list[JokerBinding] | None = None) -> Meld:
    meld = Meld(MeldKind.GROUP, tuple(tiles), tuple(bindings or ()))
    validate_meld(meld)
    return meld


def make_run(tiles: list[Tile], bindings: list[JokerBinding] | None = None) -> Meld:
    represented_order = []
    bind_by_id = {b.joker_id: b for b in (bindings or ())}
    for tile in tiles:
        if tile.is_joker:
            binding = bind_by_id[tile.id]
            represented_order.append((int(binding.color), binding.rank, tile))
        else:
            represented_order.append((int(tile.color), tile.rank, tile))
    ranks = [item[1] for item in represented_order]
    if ranks_form_run(ranks):
        order = {rank: i for i, rank in enumerate(run_display_order(ranks))}
        represented_order.sort(key=lambda item: order[item[1]])
    else:
        represented_order.sort(key=lambda item: item[1])
    ordered = [item[2] for item in represented_order]
    meld = Meld(MeldKind.RUN, tuple(ordered), tuple(bindings or ()))
    validate_meld(meld)
    return meld


def infer_group_bindings(tiles: list[Tile], rank: int) -> list[JokerBinding]:
    used_colors = {int(t.color) for t in tiles if not t.is_joker}
    missing = [Color(c) for c in range(NUM_COLORS) if c not in used_colors]
    jokers = [t for t in tiles if t.is_joker]
    if len(jokers) > len(missing):
        raise TableValidationError("Too many jokers for group")
    return [
        JokerBinding(joker.id, missing[i], rank)
        for i, joker in enumerate(jokers)
    ]


def try_make_meld(tiles: list[Tile]) -> Meld:
    """Build a valid group or run from tiles in the player's visual order."""
    if len(tiles) < 3:
        raise TableValidationError("Hace falta un juego de al menos 3 fichas")
    numbered = [t for t in tiles if not t.is_joker]
    jokers = [t for t in tiles if t.is_joker]
    if numbered:
        ranks = {t.rank for t in numbered}
        colors = [int(t.color) for t in numbered]
        if len(ranks) == 1 and len(colors) == len(set(colors)) and len(tiles) <= 4:
            rank = numbered[0].rank
            bindings = infer_group_bindings(list(tiles), rank) if jokers else []
            return make_group(list(tiles), bindings)
    if numbered:
        try:
            return _run_from_visual_order(tiles)
        except TableValidationError:
            if not jokers:
                ordered = sorted(numbered, key=lambda t: t.rank)
                return make_run(ordered)
            raise
    raise TableValidationError("No se puede armar un juego solo con comodines")


def _run_from_visual_order(tiles: list[Tile]) -> Meld:
    numbered = [(i, t) for i, t in enumerate(tiles) if not t.is_joker]
    if not numbered:
        raise TableValidationError("La escalera necesita al menos un número")
    colors = {t.color for _i, t in numbered}
    if len(colors) != 1:
        raise TableValidationError("La escalera tiene que ser del mismo color")
    if len(tiles) > NUM_RANKS:
        raise TableValidationError("La escalera no puede repetir números")
    color = numbered[0][1].color
    first_i, first = numbered[0]
    expected = step_rank(first.rank, -first_i)
    bindings: list[JokerBinding] = []
    seen: set[int] = set()
    for tile in tiles:
        if expected in seen:
            raise TableValidationError("La escalera no puede repetir números")
        seen.add(expected)
        if tile.is_joker:
            bindings.append(JokerBinding(tile.id, color, expected))
        elif tile.color != color or tile.rank != expected:
            raise TableValidationError("Las fichas no forman una escalera en ese orden")
        expected = next_rank(expected)
    return make_run(list(tiles), bindings)


def infer_run_bindings(tiles: list[Tile], color: Color, ranks: list[int]) -> list[JokerBinding]:
    numbered_ranks = {t.rank for t in tiles if not t.is_joker}
    jokers = [t for t in tiles if t.is_joker]
    holes = [rank for rank in ranks if rank not in numbered_ranks]
    if len(jokers) != len(holes):
        raise TableValidationError("Joker count does not match run holes")
    return [
        JokerBinding(joker.id, color, hole)
        for joker, hole in zip(jokers, holes)
    ]
