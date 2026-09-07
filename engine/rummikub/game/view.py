from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from rummikub.game.table import Table
from rummikub.game.tile import Tile


class EventType(str, Enum):
    DRAW = "draw"
    PLAY = "play"
    INITIAL = "initial"
    WIN = "win"


@dataclass(frozen=True, slots=True)
class PublicEvent:
    player_id: int
    type: EventType
    tiles_from_rack: tuple[Tile, ...] = ()
    table_hash: str = ""
    rack_size: int = 0
    drawn: bool = False


@dataclass(frozen=True, slots=True)
class PlayerView:
    """What one player is allowed to see. Bots must use this, never GameState."""

    player_id: int
    rack: tuple[Tile, ...]
    table: Table
    rack_sizes: tuple[int, ...]
    pool_size: int
    current: int
    has_initial_meld: tuple[bool, ...]
    scores: tuple[int, ...]
    history: tuple[PublicEvent, ...]
    names: tuple[str, ...] = ()
    is_bot: tuple[bool, ...] = ()
    difficulties: tuple[str | None, ...] = ()
    over: bool = False
    winner: int | None = None
    seed_public: int | None = None
