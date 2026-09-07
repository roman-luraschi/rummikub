from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

from rummikub.game.runs import run_display_order
from rummikub.game.tile import Color, Tile


class MeldKind(IntEnum):
    GROUP = 1
    RUN = 2


@dataclass(frozen=True, slots=True)
class JokerBinding:
    joker_id: int
    color: Color
    rank: int

    def __str__(self) -> str:
        from rummikub.game.tile import COLOR_NAMES

        return f"J{self.joker_id}->{self.rank}{COLOR_NAMES[self.color]}"


@dataclass(frozen=True, slots=True)
class Meld:
    kind: MeldKind
    tiles: tuple[Tile, ...]
    bindings: tuple[JokerBinding, ...] = ()

    def tile_ids(self) -> frozenset[int]:
        return frozenset(t.id for t in self.tiles)

    def jokers(self) -> tuple[Tile, ...]:
        return tuple(t for t in self.tiles if t.is_joker)

    def numbered(self) -> tuple[Tile, ...]:
        return tuple(t for t in self.tiles if not t.is_joker)

    def binding_for(self, joker_id: int) -> JokerBinding | None:
        for binding in self.bindings:
            if binding.joker_id == joker_id:
                return binding
        return None

    def represented(self) -> list[tuple[int, int]]:
        """(color, rank) occupied in this meld, including joker bindings."""
        slots: list[tuple[int, int]] = []
        for tile in self.tiles:
            if tile.is_joker:
                binding = self.binding_for(tile.id)
                if binding is None:
                    raise ValueError(f"Joker {tile.id} has no binding")
                slots.append((int(binding.color), binding.rank))
            else:
                slots.append((int(tile.color), tile.rank))
        return slots

    def point_value(self) -> int:
        """Face value of tiles as played. Jokers score the represented rank."""
        total = 0
        for tile in self.tiles:
            if tile.is_joker:
                binding = self.binding_for(tile.id)
                if binding is None:
                    raise ValueError(f"Joker {tile.id} has no binding")
                total += binding.rank
            else:
                total += tile.rank
        return total

    def canonical_key(self) -> tuple:
        if self.kind is MeldKind.GROUP:
            colors = []
            rank = None
            joker_flags = []
            for color, r in sorted(self.represented()):
                rank = r
                colors.append(color)
            for tile in self.tiles:
                joker_flags.append(1 if tile.is_joker else 0)
            return (int(self.kind), rank, tuple(colors), tuple(sorted(joker_flags)))
        represented = self.represented()
        color = represented[0][0]
        order = run_display_order([rank for _color, rank in represented])
        joker_ranks = tuple(sorted(b.rank for b in self.bindings))
        return (int(self.kind), color, order[0], len(order), joker_ranks)

    def __str__(self) -> str:
        from rummikub.game.tile import COLOR_NAMES

        parts: list[str] = []
        by_id = {b.joker_id: b for b in self.bindings}
        for tile in self.tiles:
            if tile.is_joker:
                binding = by_id[tile.id]
                parts.append(f"J({binding.rank}{COLOR_NAMES[binding.color]})")
            else:
                parts.append(str(tile))
        kind = "G" if self.kind is MeldKind.GROUP else "R"
        return f"{kind}[{' '.join(parts)}]"
