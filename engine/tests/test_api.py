from fastapi.testclient import TestClient

from rummikub.api.server import GAMES, GameSession, app
from rummikub.game.engine import GameEngine
from rummikub.game.tile import parse_tiles
from tests.helpers import run, table_of


def test_spectator_game_is_all_bots_and_ticks():
    GAMES.clear()
    client = TestClient(app)
    created = client.post(
        "/api/games",
        json={
            "spectator": True,
            "botCount": 2,
            "difficulties": ["easy", "easy"],
            "seed": 42,
            "debug": False,
        },
    )
    assert created.status_code == 200
    data = created.json()
    assert data["spectator"] is True
    assert data["yourTurn"] is False
    assert data["view"]["isBot"] == [True, True]
    assert data["view"]["names"] == ["Easy 1", "Easy 2"]
    assert data["steps"] == []

    ticked = client.post(f"/api/games/{data['id']}/tick")
    assert ticked.status_code == 200
    body = ticked.json()
    assert body["steps"]
    assert body["steps"][0]["event"]["type"] in {"draw", "play", "initial", "win"}
    assert body["view"]["history"]


def test_preview_places_tiles_without_ending_the_turn():
    GAMES.clear()
    engine = GameEngine()
    state = engine.new_game(n_players=2, seed=1, names=["You", "Bot"], bots=[None, "easy"])
    rack = parse_tiles("5R 1A 12N")
    state.players[0].rack = list(rack)
    state.players[0].has_initial_meld = True
    state.table = table_of(run("2R 3R 4R"))
    state.current = 0
    GAMES["preview"] = GameSession(state=state, human_id=0, debug=False)
    client = TestClient(app)
    preview = client.post("/api/games/preview/preview", json={"tileIds": [rack[0].id]})
    assert preview.status_code == 200
    body = preview.json()
    assert body["tileIds"] == [rack[0].id]
    assert len(body["table"]["melds"][0]["tiles"]) == 4
    again = client.get("/api/games/preview")
    assert again.status_code == 200
    data = again.json()
    assert data["yourTurn"] is True
    assert data["view"]["current"] == 0
    assert len(data["view"]["table"]["melds"][0]["tiles"]) == 3
    assert data["view"]["history"] == []


def test_human_game_rejects_tick_on_human_turn():
    GAMES.clear()
    client = TestClient(app)
    created = client.post(
        "/api/games",
        json={"difficulty": "easy", "opponents": 1, "seed": 7, "debug": False},
    )
    assert created.status_code == 200
    data = created.json()
    assert data["spectator"] is False
    if data["yourTurn"]:
        ticked = client.post(f"/api/games/{data['id']}/tick")
        assert ticked.status_code == 400
