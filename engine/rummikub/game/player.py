from __future__ import annotations

from dataclasses import dataclass, field

from rummikub.game.tile import Tile


@dataclass
class Player:
    id: int
    name: str
    rack: list[Tile] = field(default_factory=list)
    has_initial_meld: bool = False
    is_bot: bool = False
    difficulty: str | None = None

    def rack_ids(self) -> set[int]:
        return {t.id for t in self.rack}

    def deadwood(self) -> int:
        return sum(t.rack_value() for t in self.rack)

    def clone(self) -> Player:
        return Player(
            id=self.id,
            name=self.name,
            rack=list(self.rack),
            has_initial_meld=self.has_initial_meld,
            is_bot=self.is_bot,
            difficulty=self.difficulty,
        )
