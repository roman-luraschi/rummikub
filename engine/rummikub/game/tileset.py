from __future__ import annotations

from rummikub.game.tile import (
    FIRST_JOKER_ID,
    MAX_RANK,
    MIN_RANK,
    NUM_COLORS,
    NUM_RANKS,
    Tile,
)


def slot_index(color: int, rank: int) -> int:
    """Rank-major index: all colors of rank 1, then rank 2, ..."""
    return (rank - 1) * NUM_COLORS + color


def color_rank_from_index(index: int) -> tuple[int, int]:
    rank0, color = divmod(index, NUM_COLORS)
    return color, rank0 + 1


class TileBag:
    """Mutable multiset of tiles for the solver. Numbered copies (0-2) + jokers (0-2)."""

    __slots__ = ("n", "jokers")

    def __init__(self, n: bytearray | None = None, jokers: int = 0) -> None:
        self.n = n if n is not None else bytearray(NUM_COLORS * NUM_RANKS)
        self.jokers = jokers

    @classmethod
    def from_tiles(cls, tiles: list[Tile]) -> TileBag:
        bag = cls()
        for tile in tiles:
            bag.add_tile(tile)
        return bag

    def add_tile(self, tile: Tile) -> None:
        if tile.is_joker:
            self.jokers += 1
            return
        self.add(int(tile.color), tile.rank)

    def add(self, color: int, rank: int, k: int = 1) -> None:
        self.n[slot_index(color, rank)] += k

    def count(self, color: int, rank: int) -> int:
        return self.n[slot_index(color, rank)]

    def take(self, color: int, rank: int) -> bool:
        i = slot_index(color, rank)
        if self.n[i] == 0:
            return False
        self.n[i] -= 1
        return True

    def put(self, color: int, rank: int) -> None:
        self.n[slot_index(color, rank)] += 1

    def take_joker(self) -> bool:
        if self.jokers <= 0:
            return False
        self.jokers -= 1
        return True

    def put_joker(self) -> None:
        self.jokers += 1

    def first_numbered(self) -> tuple[int, int] | None:
        for i, count in enumerate(self.n):
            if count:
                return color_rank_from_index(i)
        return None

    def numbered_total(self) -> int:
        return sum(self.n)

    def total(self) -> int:
        return self.numbered_total() + self.jokers

    def is_empty(self) -> bool:
        return self.jokers == 0 and self.numbered_total() == 0

    def has_numbered(self) -> bool:
        return self.numbered_total() > 0

    def clone(self) -> TileBag:
        return TileBag(bytearray(self.n), self.jokers)

    def key(self) -> bytes:
        return bytes(self.n) + bytes([self.jokers])

    def deadwood(self) -> int:
        total = self.jokers * 30
        for i, count in enumerate(self.n):
            if count:
                _color, rank = color_rank_from_index(i)
                total += count * rank
        return total

    def __repr__(self) -> str:
        parts: list[str] = []
        for i, count in enumerate(self.n):
            if count:
                color, rank = color_rank_from_index(i)
                parts.append(f"{rank}{color}x{count}")
        if self.jokers:
            parts.append(f"Jx{self.jokers}")
        return "TileBag(" + ",".join(parts) + ")"


def consume_numbered(must: TileBag, opt: TileBag, color: int, rank: int) -> str | None:
    """Take one numbered tile, preferring mandatory tiles. Returns source tag."""
    if must.take(color, rank):
        return "must"
    if opt.take(color, rank):
        return "opt"
    if must.take_joker():
        return "joker_must"
    if opt.take_joker():
        return "joker_opt"
    return None


def undo_consume(must: TileBag, opt: TileBag, source: str, color: int, rank: int) -> None:
    if source == "must":
        must.put(color, rank)
    elif source == "opt":
        opt.put(color, rank)
    elif source == "joker_must":
        must.put_joker()
    elif source == "joker_opt":
        opt.put_joker()
    else:
        raise ValueError(source)


def is_valid_rank(rank: int) -> bool:
    return MIN_RANK <= rank <= MAX_RANK


def is_valid_color(color: int) -> bool:
    return 0 <= color < NUM_COLORS
