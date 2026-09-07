from __future__ import annotations

import random
from dataclasses import dataclass, field

from rummikub.game.player import Player
from rummikub.game.table import Table
from rummikub.game.tile import Tile, build_deck
from rummikub.game.view import EventType, PlayerView, PublicEvent
from rummikub.rules.table_validator import TableValidationError, validate_entire_table
from rummikub.solver.types import TableConfiguration

RACK_SIZE = 14
INITIAL_MELD_POINTS = 30


class IllegalMove(ValueError):
    pass


@dataclass
class GameState:
    players: list[Player]
    pool: list[Tile]
    table: Table
    current: int
    scores: list[int]
    seed: int
    history: list[PublicEvent] = field(default_factory=list)
    winner: int | None = None
    over: bool = False
    empty_passes: int = 0

    def clone(self) -> GameState:
        return GameState(
            players=[p.clone() for p in self.players],
            pool=list(self.pool),
            table=self.table,
            current=self.current,
            scores=list(self.scores),
            seed=self.seed,
            history=list(self.history),
            winner=self.winner,
            over=self.over,
            empty_passes=self.empty_passes,
        )


class GameEngine:
    def new_game(
        self,
        n_players: int = 2,
        seed: int = 1,
        names: list[str] | None = None,
        bots: list[str | None] | None = None,
    ) -> GameState:
        if not 2 <= n_players <= 4:
            raise ValueError("Rummikub supports 2-4 players")
        rng = random.Random(seed)
        deck = build_deck()
        rng.shuffle(deck)
        players: list[Player] = []
        for i in range(n_players):
            name = names[i] if names else f"P{i}"
            rack = [deck.pop() for _ in range(RACK_SIZE)]
            difficulty = bots[i] if bots else None
            players.append(
                Player(
                    id=i,
                    name=name,
                    rack=rack,
                    is_bot=difficulty is not None,
                    difficulty=difficulty,
                )
            )
        return GameState(
            players=players,
            pool=deck,
            table=Table(),
            current=0,
            scores=[0] * n_players,
            seed=seed,
        )

    def view(self, state: GameState, player_id: int) -> PlayerView:
        player = state.players[player_id]
        return PlayerView(
            player_id=player_id,
            rack=tuple(player.rack),
            table=state.table,
            rack_sizes=tuple(len(p.rack) for p in state.players),
            pool_size=len(state.pool),
            current=state.current,
            has_initial_meld=tuple(p.has_initial_meld for p in state.players),
            scores=tuple(state.scores),
            history=tuple(state.history),
            names=tuple(p.name for p in state.players),
            is_bot=tuple(p.is_bot for p in state.players),
            difficulties=tuple(p.difficulty for p in state.players),
            over=state.over,
            winner=state.winner,
            seed_public=state.seed,
        )

    def draw(self, state: GameState) -> GameState:
        self._ensure_active(state)
        nxt = state.clone()
        player = nxt.players[nxt.current]
        drawn = False
        if nxt.pool:
            player.rack.append(nxt.pool.pop())
            drawn = True
            nxt.empty_passes = 0
        else:
            nxt.empty_passes += 1
        nxt.history.append(
            PublicEvent(
                player_id=player.id,
                type=EventType.DRAW,
                rack_size=len(player.rack),
                drawn=drawn,
            )
        )
        if not drawn and nxt.empty_passes >= len(nxt.players):
            self._finish_stalemate(nxt)
            return nxt
        self._advance(nxt)
        return nxt

    def play(self, state: GameState, config: TableConfiguration) -> GameState:
        self._ensure_active(state)
        nxt = state.clone()
        player = nxt.players[nxt.current]
        self._validate_play(nxt, player, config)
        used_ids = {t.id for t in config.rack_used}
        player.rack = [t for t in player.rack if t.id not in used_ids]
        nxt.table = config.table
        nxt.empty_passes = 0
        event_type = EventType.PLAY
        if not player.has_initial_meld:
            event_type = EventType.INITIAL
            player.has_initial_meld = True
        nxt.history.append(
            PublicEvent(
                player_id=player.id,
                type=event_type,
                tiles_from_rack=config.rack_used,
                table_hash=config.table.canonical_hash(),
                rack_size=len(player.rack),
            )
        )
        if not player.rack:
            self._finish_round(nxt, player.id)
            return nxt
        self._advance(nxt)
        return nxt

    def _validate_play(self, state: GameState, player: Player, config: TableConfiguration) -> None:
        try:
            validate_entire_table(config.table)
        except TableValidationError as exc:
            raise IllegalMove(str(exc)) from exc
        if not config.rack_used:
            raise IllegalMove("A play must use at least one rack tile")
        rack_ids = player.rack_ids()
        used_ids = [t.id for t in config.rack_used]
        if len(used_ids) != len(set(used_ids)):
            raise IllegalMove("Duplicate tile in rack_used")
        if not set(used_ids).issubset(rack_ids):
            raise IllegalMove("Play uses tiles that are not in the rack")
        old_ids = state.table.tile_ids()
        new_ids = config.table.tile_ids()
        if not old_ids.issubset(new_ids):
            raise IllegalMove("Table tiles cannot return to the rack")
        extra = new_ids - old_ids
        if extra != set(used_ids):
            raise IllegalMove("New table tiles must be exactly the tiles played from the rack")
        if not player.has_initial_meld:
            if old_ids:
                # Existing melds must stay intact; only new rack melds may be added.
                old_keys = tuple(m.canonical_key() for m in state.table.melds)
                new_keys = tuple(m.canonical_key() for m in config.table.melds[: len(state.table.melds)])
                if old_keys != new_keys:
                    raise IllegalMove("Initial meld cannot manipulate the table")
            new_melds = config.table.melds[len(state.table.melds) :]
            points = sum(m.point_value() for m in new_melds)
            if points < INITIAL_MELD_POINTS:
                raise IllegalMove(
                    f"Initial meld must total at least {INITIAL_MELD_POINTS} (got {points})"
                )
            for meld in new_melds:
                if any(t.is_joker for t in meld.tiles):
                    raise IllegalMove("La apertura de 30 puntos no puede usar comodines")
                if any(t.id in old_ids for t in meld.tiles):
                    raise IllegalMove("Initial meld must use only rack tiles")

    def _finish_round(self, state: GameState, winner_id: int) -> None:
        state.over = True
        state.winner = winner_id
        for player in state.players:
            if player.id == winner_id:
                continue
            penalty = player.deadwood()
            state.scores[player.id] -= penalty
            state.scores[winner_id] += penalty
        state.history.append(
            PublicEvent(
                player_id=winner_id,
                type=EventType.WIN,
                rack_size=0,
                table_hash=state.table.canonical_hash(),
            )
        )

    def _finish_stalemate(self, state: GameState) -> None:
        deadwood = [p.deadwood() for p in state.players]
        best = min(deadwood)
        winners = [i for i, value in enumerate(deadwood) if value == best]
        if len(winners) == 1:
            self._finish_round(state, winners[0])
            return
        state.over = True
        state.winner = None
        for i, value in enumerate(deadwood):
            state.scores[i] -= value

    def _ensure_active(self, state: GameState) -> None:
        if state.over:
            raise IllegalMove("The round is already over")

    def _advance(self, state: GameState) -> None:
        state.current = (state.current + 1) % len(state.players)


def new_game(
    n_players: int = 2,
    seed: int = 1,
    names: list[str] | None = None,
    bots: list[str | None] | None = None,
) -> GameState:
    return GameEngine().new_game(n_players=n_players, seed=seed, names=names, bots=bots)
