from __future__ import annotations

from dataclasses import dataclass, field
from random import Random

from rummikub.game.meld import MeldKind
from rummikub.game.tile import TOTAL_TILES, Tile
from rummikub.game.view import EventType, PlayerView


@dataclass
class OpponentModel:
    """Belief over hidden tiles. Never inspects other players' actual racks."""

    known_ids: set[int]
    unknown: list[Tile]
    rack_sizes: tuple[int, ...]
    pool_size: int
    player_id: int
    hot_slots: dict[tuple[int, int], float] = field(default_factory=dict)
    accuracy: float = 1.0

    @classmethod
    def from_view(cls, view: PlayerView, accuracy: float = 1.0) -> OpponentModel:
        known = {t.id for t in view.rack}
        known.update(view.table.tile_ids())
        unknown = [Tile(i) for i in range(TOTAL_TILES) if i not in known]
        hot: dict[tuple[int, int], float] = {}
        for meld in view.table.melds:
            represented = meld.represented()
            if meld.kind is MeldKind.RUN:
                color, low = represented[0][0], min(r for _c, r in represented)
                high = max(r for _c, r in represented)
                if low > 1:
                    hot[(color, low - 1)] = hot.get((color, low - 1), 0.0) + 1.2
                if high < 13:
                    hot[(color, high + 1)] = hot.get((color, high + 1), 0.0) + 1.2
            else:
                used = {c for c, _r in represented}
                rank = represented[0][1]
                for color in range(4):
                    if color not in used:
                        hot[(color, rank)] = hot.get((color, rank), 0.0) + 0.9
        for event in view.history:
            if event.type in (EventType.PLAY, EventType.INITIAL) and event.player_id != view.player_id:
                for tile in event.tiles_from_rack:
                    if tile.is_joker:
                        continue
                    color, rank = int(tile.color), tile.rank
                    for delta in (-2, -1, 1, 2):
                        nxt = rank + delta
                        if 1 <= nxt <= 13:
                            hot[(color, nxt)] = hot.get((color, nxt), 0.0) + 0.45 * accuracy
                    for other in range(4):
                        if other != color:
                            hot[(other, rank)] = hot.get((other, rank), 0.0) + 0.25 * accuracy
        return cls(
            known_ids=known,
            unknown=unknown,
            rack_sizes=view.rack_sizes,
            pool_size=view.pool_size,
            player_id=view.player_id,
            hot_slots=hot,
            accuracy=accuracy,
        )

    def hidden_mass(self) -> int:
        return max(1, sum(self.rack_sizes) - self.rack_sizes[self.player_id] + self.pool_size)

    def p_in_opponent_rack(self, tile: Tile, opponent_id: int) -> float:
        if tile.id in self.known_ids:
            return 0.0
        mass = self.hidden_mass()
        share = self.rack_sizes[opponent_id] / mass
        return share * self.accuracy + (self.rack_sizes[opponent_id] / mass) * (1 - self.accuracy)

    def heat(self, tile: Tile) -> float:
        if tile.is_joker:
            return 1.4
        return self.hot_slots.get((int(tile.color), tile.rank), 0.0)

    def sample_hidden(self, count: int, rng: Random) -> list[Tile]:
        if count <= 0:
            return []
        if count >= len(self.unknown):
            return list(self.unknown)
        return rng.sample(self.unknown, count)
