from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from rummikub.ai.bot import RummyBot
from rummikub.ai.difficulty import parse_difficulty
from rummikub.api.serialize import decision_to_dict, event_to_dict, table_to_dict, view_to_dict
from rummikub.game.engine import GameEngine, GameState, IllegalMove
from rummikub.solver import NoLegalPlay, find_play_for_selected_tiles
from rummikub.solver.layout import configuration_from_layout

engine = GameEngine()
bot = RummyBot()
app = FastAPI(title="Rummikub AI Engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@dataclass
class GameSession:
    state: GameState
    human_id: int = 0
    debug: bool = True
    last_decision: dict | None = None
    spectator: bool = False


GAMES: dict[str, GameSession] = {}


class NewGameRequest(BaseModel):
    seed: int | None = None
    difficulty: str = "hard"
    opponents: int = 1
    debug: bool = True
    name: str = "You"
    spectator: bool = False
    botCount: int = 2
    difficulties: list[str] | None = None


class PlayRequest(BaseModel):
    tileIds: list[int] = Field(default_factory=list)
    melds: list[list[int]] | None = None


def _session(game_id: str) -> GameSession:
    session = GAMES.get(game_id)
    if session is None:
        raise HTTPException(404, "Game not found")
    return session


def _viewer_id(session: GameSession, *, acting: int | None = None) -> int:
    if not session.spectator:
        return session.human_id
    if acting is not None:
        return acting
    state = session.state
    if state.over:
        return state.winner if state.winner is not None else 0
    return state.current


def _payload(game_id: str, session: GameSession, steps: list[dict] | None = None) -> dict:
    view = engine.view(session.state, _viewer_id(session))
    your_turn = (
        (not session.spectator)
        and (not session.state.over)
        and session.state.current == session.human_id
    )
    return {
        "id": game_id,
        "view": view_to_dict(view),
        "lastDecision": session.last_decision,
        "yourTurn": your_turn,
        "spectator": session.spectator,
        "steps": steps or [],
    }


def _step_from_last_event(session: GameSession, *, acting: int | None = None) -> dict:
    state = session.state
    event = state.history[-1] if state.history else None
    view = engine.view(state, _viewer_id(session, acting=acting))
    return {
        "event": event_to_dict(event, names=view.names, is_bot=view.is_bot) if event else None,
        "view": view_to_dict(view),
        "yourTurn": (not session.spectator) and (not state.over) and state.current == session.human_id,
        "lastDecision": session.last_decision,
    }


def _play_one_bot(session: GameSession) -> dict:
    state = session.state
    player = state.players[state.current]
    if state.over or not player.is_bot:
        raise IllegalMove("It is not a bot turn")
    view = engine.view(state, player.id)
    move = bot.choose_move(view, player.difficulty or "hard", debug=session.debug)
    session.last_decision = decision_to_dict(move.decision)
    if move.action == "DRAW" or move.config is None:
        session.state = engine.draw(state)
    else:
        session.state = engine.play(state, move.config)
    return _step_from_last_event(session, acting=player.id if session.spectator else None)


def _play_bots(session: GameSession) -> list[dict]:
    if session.spectator:
        return []
    steps: list[dict] = []
    guard = 0
    while (
        not session.state.over
        and session.state.players[session.state.current].is_bot
        and guard < 12
    ):
        steps.append(_play_one_bot(session))
        guard += 1
    return steps


def _bot_names(diffs: list[str]) -> list[str]:
    counts = {name: diffs.count(name) for name in diffs}
    seen: dict[str, int] = {}
    names: list[str] = []
    for diff in diffs:
        seen[diff] = seen.get(diff, 0) + 1
        label = diff.replace("_", " ").title()
        names.append(f"{label} {seen[diff]}" if counts[diff] > 1 else label)
    return names


def _start_players(req: NewGameRequest) -> tuple[int, list[str], list[str | None]]:
    if req.spectator:
        if req.difficulties:
            diffs = [parse_difficulty(item).value for item in req.difficulties]
            n = max(2, min(4, max(len(diffs), req.botCount)))
            while len(diffs) < n:
                diffs.append(diffs[-1] if diffs else parse_difficulty(req.difficulty).value)
            diffs = diffs[:n]
        else:
            n = max(2, min(4, req.botCount))
            diffs = [parse_difficulty(req.difficulty).value] * n
        return n, _bot_names(diffs), list(diffs)
    parse_difficulty(req.difficulty)
    opponents = max(1, min(3, req.opponents))
    n_players = opponents + 1
    names = [req.name] + [f"Bot {i}" for i in range(1, n_players)]
    bots: list[str | None] = [None] + [parse_difficulty(req.difficulty).value] * opponents
    return n_players, names, bots


def _find_human_play(session: GameSession, tile_ids: list[int]):
    state = session.state
    player = state.players[session.human_id]
    try:
        return find_play_for_selected_tiles(
            state.table,
            player.rack,
            tile_ids,
            has_initial_meld=player.has_initial_meld,
        )
    except NoLegalPlay as exc:
        raise IllegalMove(str(exc)) from exc


def _play_from_layout(session: GameSession, groups: list[list[int]]):
    state = session.state
    player = state.players[session.human_id]
    try:
        return configuration_from_layout(
            state.table,
            player.rack,
            groups,
            has_initial_meld=player.has_initial_meld,
        )
    except ValueError as exc:
        raise IllegalMove(str(exc)) from exc


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/games")
def create_game(req: NewGameRequest) -> dict:
    try:
        n_players, names, bots = _start_players(req)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    seed = req.seed if req.seed is not None else int(uuid.uuid4().int % 1_000_000)
    state = engine.new_game(n_players=n_players, seed=seed, names=names, bots=bots)
    game_id = uuid.uuid4().hex[:10]
    session = GameSession(state=state, human_id=0, debug=req.debug, spectator=req.spectator)
    GAMES[game_id] = session
    steps = _play_bots(session)
    return _payload(game_id, session, steps)


@app.get("/api/games/{game_id}")
def get_game(game_id: str) -> dict:
    return _payload(game_id, _session(game_id))


@app.post("/api/games/{game_id}/draw")
def draw(game_id: str) -> dict:
    session = _session(game_id)
    if session.state.over or session.state.current != session.human_id:
        raise HTTPException(400, "It is not your turn")
    try:
        session.state = engine.draw(session.state)
    except IllegalMove as exc:
        raise HTTPException(400, str(exc)) from exc
    steps = [_step_from_last_event(session)]
    steps.extend(_play_bots(session))
    return _payload(game_id, session, steps)


@app.post("/api/games/{game_id}/preview")
def preview_play(game_id: str, req: PlayRequest) -> dict:
    session = _session(game_id)
    if session.state.over or session.state.current != session.human_id:
        raise HTTPException(400, "It is not your turn")
    if not req.tileIds:
        raise HTTPException(400, "Select at least one tile")
    try:
        config = _find_human_play(session, req.tileIds)
    except IllegalMove as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "table": table_to_dict(config.table),
        "tileIds": [t.id for t in config.rack_used],
    }


@app.post("/api/games/{game_id}/play")
def play(game_id: str, req: PlayRequest) -> dict:
    session = _session(game_id)
    if session.state.over or session.state.current != session.human_id:
        raise HTTPException(400, "It is not your turn")
    if not req.melds and not req.tileIds:
        raise HTTPException(400, "Select at least one tile")
    try:
        if req.melds:
            config = _play_from_layout(session, req.melds)
        else:
            config = _find_human_play(session, req.tileIds)
        session.state = engine.play(session.state, config)
    except IllegalMove as exc:
        raise HTTPException(400, str(exc)) from exc
    steps = [_step_from_last_event(session)]
    steps.extend(_play_bots(session))
    return _payload(game_id, session, steps)


@app.post("/api/games/{game_id}/tick")
def tick(game_id: str) -> dict:
    session = _session(game_id)
    if session.state.over:
        raise HTTPException(400, "The round is over")
    player = session.state.players[session.state.current]
    if not player.is_bot:
        raise HTTPException(400, "It is not a bot turn")
    try:
        step = _play_one_bot(session)
    except IllegalMove as exc:
        raise HTTPException(400, str(exc)) from exc
    return _payload(game_id, session, [step])


def _mount_ui() -> None:
    dist = Path(__file__).resolve().parents[3] / "web" / "dist"
    if not (dist / "index.html").is_file():
        return
    app.mount("/", StaticFiles(directory=dist, html=True), name="ui")


_mount_ui()


def create_app() -> FastAPI:
    return app
