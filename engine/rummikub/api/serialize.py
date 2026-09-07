from __future__ import annotations

from rummikub.ai.debug import BotDecision, CandidateReport
from rummikub.game.meld import Meld, MeldKind
from rummikub.game.table import Table
from rummikub.game.tile import Tile
from rummikub.game.view import PlayerView, PublicEvent


def tile_to_dict(tile: Tile) -> dict:
    if tile.is_joker:
        return {
            "id": tile.id,
            "isJoker": True,
            "label": "J",
            "color": "joker",
            "rank": None,
        }
    return {
        "id": tile.id,
        "isJoker": False,
        "label": str(tile),
        "color": tile.color.name.lower(),
        "rank": tile.rank,
    }


def meld_to_dict(meld: Meld) -> dict:
    return {
        "kind": "group" if meld.kind is MeldKind.GROUP else "run",
        "tiles": [tile_to_dict(t) for t in meld.tiles],
        "bindings": [
            {
                "jokerId": b.joker_id,
                "color": b.color.name.lower(),
                "rank": b.rank,
            }
            for b in meld.bindings
        ],
        "label": str(meld),
    }


def table_to_dict(table: Table) -> dict:
    return {
        "melds": [meld_to_dict(m) for m in table.melds],
        "hash": table.canonical_hash(),
        "label": str(table),
    }


def event_to_dict(event: PublicEvent, *, names: tuple[str, ...] = (), is_bot: tuple[bool, ...] = ()) -> dict:
    player_id = event.player_id
    name = names[player_id] if player_id < len(names) else f"P{player_id}"
    bot = is_bot[player_id] if player_id < len(is_bot) else False
    return {
        "playerId": player_id,
        "playerName": name,
        "isBot": bot,
        "type": event.type.value,
        "tilesFromRack": [tile_to_dict(t) for t in event.tiles_from_rack],
        "tableHash": event.table_hash,
        "rackSize": event.rack_size,
        "drawn": event.drawn,
    }


def view_to_dict(view: PlayerView) -> dict:
    return {
        "playerId": view.player_id,
        "rack": [tile_to_dict(t) for t in sorted(view.rack, key=_rack_sort)],
        "table": table_to_dict(view.table),
        "rackSizes": list(view.rack_sizes),
        "poolSize": view.pool_size,
        "current": view.current,
        "hasInitialMeld": list(view.has_initial_meld),
        "scores": list(view.scores),
        "names": list(view.names),
        "isBot": list(view.is_bot),
        "difficulties": list(view.difficulties),
        "over": view.over,
        "winner": view.winner,
        "seed": view.seed_public,
        "history": [
            event_to_dict(e, names=view.names, is_bot=view.is_bot)
            for e in view.history[-24:]
        ],
    }


def decision_to_dict(decision: BotDecision) -> dict:
    return {
        "action": decision.action,
        "score": round(decision.score, 3),
        "reasons": {k: round(v, 3) for k, v in decision.reasons.items()},
        "initialHand": decision.initial_hand,
        "initialTable": decision.initial_table,
        "finalTable": decision.final_table,
        "played": decision.discarded,
        "searchDepth": decision.search_depth,
        "statesEvaluated": decision.states_evaluated,
        "cacheHits": decision.cache_hits,
        "simulations": decision.simulation_count,
        "timeMs": round(decision.time_ms, 2),
        "difficulty": decision.difficulty,
        "topCandidates": [_candidate_to_dict(c) for c in decision.top_candidates],
        "log": decision.format(),
    }


def _candidate_to_dict(candidate: CandidateReport) -> dict:
    return {
        "action": candidate.action,
        "score": round(candidate.score, 3),
        "terms": {k: round(v, 3) for k, v in candidate.terms.items()},
        "table": candidate.table,
        "rackUsed": candidate.rack_used,
        "tilesPlayed": candidate.tiles_played,
    }


def _rack_sort(tile: Tile) -> tuple:
    if tile.is_joker:
        return (99, 0, tile.id)
    return (int(tile.color), tile.rank, tile.id)
