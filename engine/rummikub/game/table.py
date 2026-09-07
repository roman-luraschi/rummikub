from __future__ import annotations

import hashlib
from dataclasses import dataclass

from rummikub.game.meld import Meld
from rummikub.game.tile import Tile


@dataclass(frozen=True, slots=True)
class Table:
    melds: tuple[Meld, ...] = ()

    def all_tiles(self) -> list[Tile]:
        tiles: list[Tile] = []
        for meld in self.melds:
            tiles.extend(meld.tiles)
        return tiles

    def tile_ids(self) -> frozenset[int]:
        ids: set[int] = set()
        for meld in self.melds:
            ids.update(t.id for t in meld.tiles)
        return frozenset(ids)

    def canonical_key(self) -> tuple:
        return tuple(sorted(meld.canonical_key() for meld in self.melds))

    def canonical_hash(self) -> str:
        raw = repr(self.canonical_key()).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()[:16]

    def with_melds(self, melds: list[Meld] | tuple[Meld, ...]) -> Table:
        return Table(tuple(melds))

    def __str__(self) -> str:
        if not self.melds:
            return "(empty table)"
        return " | ".join(str(m) for m in self.melds)
