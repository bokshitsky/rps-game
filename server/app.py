from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .manager import PLAYER_PRESENCE_TIMEOUT_SECONDS, RoomManager
from .models import Room
from .schemas import CreateRoomRequest, RoomActionRequest


manager = RoomManager()
app = FastAPI(title="Hidden RPS Multiplayer")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/games")
async def create_game(payload: CreateRoomRequest) -> dict[str, Any]:
    room, player_id = manager.create_room({"preset": payload.preset})
    return {
        "roomId": room.room_id,
        "playerId": player_id,
        "playerToken": room.player_tokens[player_id],
        "parameters": room.parameters,
    }


@app.get("/api/games/{room_id}")
async def get_game_state(room_id: str, token: Optional[str] = Query(default=None)) -> dict[str, Any]:
    room = manager.get_room(room_id)
    player_id = manager.resolve_player(room, token)
    manager.touch_poll(room)
    manager.touch_player(room, player_id)
    return room.snapshot_for(player_id, PLAYER_PRESENCE_TIMEOUT_SECONDS)


@app.post("/api/games/{room_id}/actions")
async def post_game_action(
    room_id: str,
    payload: RoomActionRequest,
    token: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    room = manager.get_room(room_id)
    player_id = manager.resolve_player(room, token)
    manager.touch_player(room, player_id)
    await manager.handle_action(room, player_id, payload.model_dump())
    await manager.notify_refresh(room)
    return {"ok": True}


@app.websocket("/ws/games/{room_id}")
async def room_socket(websocket: WebSocket, room_id: str, token: Optional[str] = None) -> None:
    room: Optional[Room] = None
    player_id: Optional[int] = None
    try:
        room, player_id = await manager.connect(room_id, websocket, token)
        await manager.notify_refresh(room)
        while True:
            await websocket.receive_text()
    except HTTPException as exc:
        await websocket.accept()
        await websocket.send_text(json.dumps({"type": "error", "message": exc.detail}))
        await websocket.close(code=4403)
    except WebSocketDisconnect:
        if room is not None and player_id is not None:
            manager.disconnect(room, player_id)
            await manager.notify_refresh(room)


DIST_DIR = Path(__file__).resolve().parent.parent / "dist"
ASSETS_DIR = DIST_DIR / "assets"

if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str) -> FileResponse:
    index_file = DIST_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend build not found")
    return FileResponse(index_file)
