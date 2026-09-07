from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from rummikub.game.meld import JokerBinding
from rummikub.game.table import Table
from rummikub.game.tile import Tile


class SolverMode(str, Enum):
    ADD_ONLY = "add_only"
    LOCAL = "local"
    FULL = "full"
    INITIAL = "initial"


@dataclass(frozen=True, slots=True)
class TableConfiguration:
    table: Table
    rack_used: tuple[Tile, ...]
    rack_left: tuple[Tile, ...]
    solver_mode: SolverMode
    nodes: int = 0
    cache_hits: int = 0
    time_ms: float = 0.0

    @property
    def tiles_played(self) -> int:
        return len(self.rack_used)

    @property
    def joker_bindings(self) -> tuple[JokerBinding, ...]:
        bindings: list[JokerBinding] = []
        for meld in self.table.melds:
            bindings.extend(meld.bindings)
        return tuple(bindings)

    def remaining_deadwood(self) -> int:
        return sum(t.rack_value() for t in self.rack_left)


@dataclass
class SolverStats:
    nodes: int = 0
    cache_hits: int = 0
    solutions: int = 0
    timed_out: bool = False
    time_ms: float = 0.0
