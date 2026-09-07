from __future__ import annotations

from rummikub.game.table import Table
from rummikub.game.tile import Tile
from rummikub.rules.table_validator import TableValidationError, try_make_meld, validate_entire_table
from rummikub.solver.types import SolverMode, TableConfiguration


def configuration_from_layout(
    committed: Table,
    rack: list[Tile],
    groups: list[list[int]],
    *,
    has_initial_meld: bool,
) -> TableConfiguration:
    """Turn the player's arranged piles into a legal table configuration."""
    universe = {t.id: t for t in committed.all_tiles()}
    universe.update({t.id: t for t in rack})
    seen: set[int] = set()
    melds = []
    for group in groups:
        if not group:
            continue
        tiles: list[Tile] = []
        for tile_id in group:
            if tile_id in seen:
                raise ValueError("La misma ficha aparece dos veces")
            tile = universe.get(tile_id)
            if tile is None:
                raise ValueError("Hay una ficha que no está en juego")
            seen.add(tile_id)
            tiles.append(tile)
        try:
            melds.append(try_make_meld(tiles))
        except TableValidationError as exc:
            raise ValueError(str(exc)) from exc

    table = Table(tuple(melds))
    try:
        validate_entire_table(table)
    except TableValidationError as exc:
        raise ValueError(str(exc)) from exc

    old_ids = committed.tile_ids()
    new_ids = table.tile_ids()
    if not old_ids.issubset(new_ids):
        raise ValueError("Las fichas de la mesa no pueden volver al atril")
    extra = new_ids - old_ids
    rack_ids = {t.id for t in rack}
    if not extra.issubset(rack_ids):
        raise ValueError("Solo se pueden agregar fichas del atril")
    if not extra:
        raise ValueError("Tenés que bajar al menos una ficha del atril")
    if not has_initial_meld and any(universe[tid].is_joker for tid in extra):
        raise ValueError("La apertura de 30 puntos no puede usar comodines")

    used = tuple(t for t in rack if t.id in extra)
    left = tuple(t for t in rack if t.id not in extra)
    return TableConfiguration(
        table=table,
        rack_used=used,
        rack_left=left,
        solver_mode=SolverMode.INITIAL if not has_initial_meld else SolverMode.FULL,
    )
