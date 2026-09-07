from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum


class Color(IntEnum):
    RED = 0
    BLUE = 1
    BLACK = 2
    ORANGE = 3


COLOR_NAMES = {
    Color.RED: "R",
    Color.BLUE: "B",
    Color.BLACK: "N",
    Color.ORANGE: "A",
}

COLOR_FROM_CHAR = {
    "R": Color.RED,
    "B": Color.BLUE,
    "N": Color.BLACK,
    "K": Color.BLACK,
    "A": Color.ORANGE,
    "O": Color.ORANGE,
}

NUM_COLORS = 4
MIN_RANK = 1
MAX_RANK = 13
NUM_RANKS = 13
COPIES_PER_TILE = 2
NUMBERED_COUNT = NUM_COLORS * NUM_RANKS * COPIES_PER_TILE  # 104
JOKER_COUNT = 2
TOTAL_TILES = NUMBERED_COUNT + JOKER_COUNT  # 106
FIRST_JOKER_ID = NUMBERED_COUNT
JOKER_RACK_VALUE = 30


def numbered_id(color: Color | int, rank: int, copy: int = 0) -> int:
    if not MIN_RANK <= rank <= MAX_RANK:
        raise ValueError(f"Invalid rank: {rank}")
    if copy not in (0, 1):
        raise ValueError(f"Invalid copy: {copy}")
    return copy * (NUM_COLORS * NUM_RANKS) + int(color) * NUM_RANKS + (rank - 1)


def joker_id(index: int) -> int:
    if index not in (0, 1):
        raise ValueError(f"Invalid joker index: {index}")
    return FIRST_JOKER_ID + index


@dataclass(frozen=True, slots=True)
class Tile:
    """A physical tile. Numbered tiles 0-103, jokers 104-105."""

    id: int

    def __post_init__(self) -> None:
        if not 0 <= self.id < TOTAL_TILES:
            raise ValueError(f"Invalid tile id: {self.id}")

    @staticmethod
    def numbered(color: Color | int, rank: int, copy: int = 0) -> Tile:
        return Tile(numbered_id(color, rank, copy))

    @staticmethod
    def joker(index: int = 0) -> Tile:
        return Tile(joker_id(index))

    @property
    def is_joker(self) -> bool:
        return self.id >= FIRST_JOKER_ID

    @property
    def copy(self) -> int:
        if self.is_joker:
            return self.id - FIRST_JOKER_ID
        return self.id // (NUM_COLORS * NUM_RANKS)

    @property
    def color(self) -> Color:
        if self.is_joker:
            raise ValueError("Joker has no inherent color")
        remainder = self.id % (NUM_COLORS * NUM_RANKS)
        return Color(remainder // NUM_RANKS)

    @property
    def rank(self) -> int:
        if self.is_joker:
            raise ValueError("Joker has no inherent rank")
        return (self.id % NUM_RANKS) + 1

    def rack_value(self) -> int:
        """Penalty value while the tile is still in a rack."""
        if self.is_joker:
            return JOKER_RACK_VALUE
        return self.rank

    def key(self) -> tuple[int, int] | str:
        if self.is_joker:
            return "J"
        return (int(self.color), self.rank)

    def __str__(self) -> str:
        if self.is_joker:
            return f"J{self.copy}"
        return f"{self.rank}{COLOR_NAMES[self.color]}"

    def __repr__(self) -> str:
        return f"Tile({self})"


def build_deck() -> list[Tile]:
    tiles = [
        Tile.numbered(color, rank, copy)
        for copy in range(COPIES_PER_TILE)
        for color in Color
        for rank in range(MIN_RANK, MAX_RANK + 1)
    ]
    tiles.extend(Tile.joker(i) for i in range(JOKER_COUNT))
    return tiles


def parse_tile(token: str, copy: int = 0) -> Tile:
    token = token.strip().upper()
    if token in {"J", "JK", "*", "JOKER"}:
        return Tile.joker(copy)
    if token.startswith("J") and token[1:].isdigit():
        return Tile.joker(int(token[1:]))
    rank_s, color_s = token[:-1], token[-1]
    return Tile.numbered(COLOR_FROM_CHAR[color_s], int(rank_s), copy)


def parse_tiles(spec: str) -> list[Tile]:
    """Parse a string like '3R 4R 5B J'. Duplicate color-rank pairs get copy=1."""
    used: dict[tuple[int, int], int] = {}
    joker_n = 0
    tiles: list[Tile] = []
    for token in spec.replace(",", " ").split():
        raw = token.strip().upper()
        if raw in {"J", "JK", "*", "JOKER"} or (raw.startswith("J") and raw[1:].isdigit()):
            tiles.append(Tile.joker(joker_n))
            joker_n += 1
            continue
        rank = int(raw[:-1])
        color = int(COLOR_FROM_CHAR[raw[-1]])
        key = (color, rank)
        copy = used.get(key, 0)
        if copy > 1:
            raise ValueError(f"More than two copies of {raw}")
        tiles.append(Tile.numbered(color, rank, copy))
        used[key] = copy + 1
    return tiles
