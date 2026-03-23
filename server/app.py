from __future__ import annotations

import asyncio
import json
import secrets
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


BOARD_COLS = 8
BOARD_ROWS = 6
PIECE_TYPES = ("rock", "paper", "scissors")
TYPE_ORDER = {
    "rock": "scissors",
    "scissors": "paper",
    "paper": "rock",
}


@dataclass
class Piece:
    id: str
    owner: int
    type: str
    col: int
    row: int
    alive: bool = True


@dataclass
class BattleState:
    attacker_id: str
    defender_id: str
    chooser: int
    round: int


@dataclass
class Room:
    room_id: str
    parameters: dict[str, Any]
    phase: str = "waiting"
    current_player: Optional[int] = None
    pieces: list[Piece] = field(default_factory=list)
    selected_piece_id: Optional[str] = None
    winner: Optional[int] = None
    battle: Optional[BattleState] = None
    message: str = "Ждем второго игрока по ссылке."
    turn_count: int = 0
    last_battle_summary: str = ""
    player_tokens: dict[int, str] = field(default_factory=dict)
    sockets: dict[int, WebSocket] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def connected_players(self) -> int:
        return len(self.sockets)

    def registered_players(self) -> int:
        return len(self.player_tokens)

    def get_piece_by_id(self, piece_id: str) -> Optional[Piece]:
        return next((piece for piece in self.pieces if piece.id == piece_id), None)

    def get_piece_at(self, col: int, row: int) -> Optional[Piece]:
        return next(
            (
                piece
                for piece in self.pieces
                if piece.alive and piece.col == col and piece.row == row
            ),
            None,
        )

    def get_alive_pieces(self, owner: int) -> list[Piece]:
        return [piece for piece in self.pieces if piece.alive and piece.owner == owner]

    def viewer_selected_piece_id(self, viewer: int) -> Optional[str]:
        if self.phase == "turn" and self.current_player == viewer:
            return self.selected_piece_id
        return None

    def can_act(self, player_id: int) -> bool:
        if self.connected_players() < 2:
            return False
        if self.phase == "turn":
            return self.current_player == player_id
        if self.phase == "battle_pick" and self.battle:
            return self.battle.chooser == player_id
        return False

    def snapshot_for(self, player_id: int) -> dict[str, Any]:
        viewer = player_id
        visible_pieces = [
            {
                "id": piece.id,
                "owner": piece.owner,
                "col": piece.col,
                "row": piece.row,
                "knownType": piece.type if piece.owner == viewer or self.phase == "game_over" else "hidden",
            }
            for piece in self.pieces
            if piece.alive
        ]
        return {
            "roomId": self.room_id,
            "phase": self.phase,
            "yourPlayerId": player_id,
            "playerToken": self.player_tokens[player_id],
            "currentPlayer": self.current_player,
            "selectedPieceId": self.viewer_selected_piece_id(player_id),
            "winner": self.winner,
            "battle": None
            if not self.battle
            else {
                "chooser": self.battle.chooser,
                "round": self.battle.round,
            },
            "message": self.message,
            "lastBattleSummary": self.last_battle_summary,
            "connectedPlayers": self.connected_players(),
            "requiredPlayers": 2,
            "parameters": self.parameters,
            "canAct": self.can_act(player_id),
            "counts": {
                "player1": len(self.get_alive_pieces(1)),
                "player2": len(self.get_alive_pieces(2)),
            },
            "visiblePieces": visible_pieces,
        }


def compare_types(attacker: str, defender: str) -> str:
    if attacker == defender:
        return "tie"
    return "attacker" if TYPE_ORDER[attacker] == defender else "defender"


def create_chess_like_cells(player_id: int) -> list[dict[str, int]]:
    main_rows = [5, 4] if player_id == 1 else [0, 1]
    extra_row = 3 if player_id == 1 else 2
    cells: list[dict[str, int]] = []
    for row in main_rows:
        for col in range(BOARD_COLS):
            cells.append({"col": col, "row": row})
    cells.extend([{"col": 3, "row": extra_row}, {"col": 4, "row": extra_row}])
    return cells


def create_initial_pieces() -> list[Piece]:
    distribution = ["rock"] * 6 + ["paper"] * 6 + ["scissors"] * 6
    p1_cells = create_chess_like_cells(1)
    p2_cells = create_chess_like_cells(2)
    pieces: list[Piece] = []
    for index, piece_type in enumerate(distribution):
        pieces.append(
            Piece(
                id=f"p1-{index}",
                owner=1,
                type=piece_type,
                col=p1_cells[index]["col"],
                row=p1_cells[index]["row"],
            )
        )
        pieces.append(
            Piece(
                id=f"p2-{index}",
                owner=2,
                type=piece_type,
                col=p2_cells[index]["col"],
                row=p2_cells[index]["row"],
            )
        )
    return pieces


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}

    def create_room(self, parameters: dict[str, Any]) -> tuple[Room, int]:
        room_id = secrets.token_urlsafe(6)
        room = Room(room_id=room_id, parameters=parameters)
        player_id = 1
        room.player_tokens[player_id] = secrets.token_urlsafe(16)
        self.rooms[room_id] = room
        return room, player_id

    def get_room(self, room_id: str) -> Room:
        room = self.rooms.get(room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")
        return room

    async def connect(self, room_id: str, websocket: WebSocket, token: Optional[str]) -> tuple[Room, int]:
        room = self.get_room(room_id)
        async with room.lock:
            player_id = self._resolve_player(room, token)
            await websocket.accept()
            room.sockets[player_id] = websocket

            if room.registered_players() == 2 and room.phase == "waiting":
                self._start_match(room)
            elif room.phase != "waiting" and room.connected_players() < 2:
                room.message = "Противник отключился. Ждем переподключения."

            return room, player_id

    def disconnect(self, room: Room, player_id: int) -> None:
        room.sockets.pop(player_id, None)
        if room.phase in {"turn", "battle_pick"} and room.connected_players() < 2:
            room.message = "Противник отключился. Ждем переподключения."

    async def handle_action(self, room: Room, player_id: int, payload: dict[str, Any]) -> None:
        async with room.lock:
            action_type = payload.get("type")
            if action_type == "cell_click":
                self._handle_cell_click(room, player_id, int(payload["col"]), int(payload["row"]))
            elif action_type == "battle_choice":
                self._resolve_battle_choice(room, player_id, str(payload["choice"]))

    async def broadcast(self, room: Room) -> None:
        stale_players: list[int] = []
        for player_id, socket in list(room.sockets.items()):
            try:
                await socket.send_text(json.dumps({"type": "snapshot", "payload": room.snapshot_for(player_id)}))
            except Exception:
                stale_players.append(player_id)
        for player_id in stale_players:
            self.disconnect(room, player_id)

    def _resolve_player(self, room: Room, token: Optional[str]) -> int:
        if token:
            for player_id, player_token in room.player_tokens.items():
                if secrets.compare_digest(player_token, token):
                    return player_id

        for player_id in (1, 2):
            if player_id not in room.player_tokens:
                room.player_tokens[player_id] = secrets.token_urlsafe(16)
                return player_id

        raise HTTPException(status_code=403, detail="Room is full")

    def _start_match(self, room: Room) -> None:
        room.phase = "turn"
        room.current_player = 1
        room.pieces = create_initial_pieces()
        room.selected_piece_id = None
        room.winner = None
        room.battle = None
        room.turn_count = 1
        room.last_battle_summary = ""
        room.message = "Оба игрока подключились. Ход игрока 1."

    def _is_adjacent(self, piece: Piece, col: int, row: int) -> bool:
        return abs(piece.col - col) + abs(piece.row - row) == 1

    def _handle_cell_click(self, room: Room, player_id: int, col: int, row: int) -> None:
        if room.connected_players() < 2 or room.phase != "turn" or room.current_player != player_id:
            return

        clicked_piece = room.get_piece_at(col, row)
        if clicked_piece and clicked_piece.owner == player_id:
            room.selected_piece_id = clicked_piece.id
            room.message = f"Игрок {player_id}: фигура выбрана. Сделайте ход на соседнюю клетку."
            return

        if not room.selected_piece_id:
            return

        selected = room.get_piece_by_id(room.selected_piece_id)
        if not selected or not selected.alive:
            room.selected_piece_id = None
            return

        if not self._is_adjacent(selected, col, row):
            room.message = "Ходить можно только на 1 клетку по вертикали или горизонтали."
            return

        if not clicked_piece:
            selected.col = col
            selected.row = row
            self._end_turn(room, f"Игрок {player_id} переместил фигуру.")
            return

        if clicked_piece.owner == player_id:
            room.message = "Нельзя ходить на клетку со своей фигурой."
            return

        self._begin_battle(room, selected, clicked_piece)

    def _begin_battle(self, room: Room, attacker: Piece, defender: Piece) -> None:
        result = compare_types(attacker.type, defender.type)
        if result == "attacker":
            defender.alive = False
            attacker.col = defender.col
            attacker.row = defender.row
            room.last_battle_summary = (
                f"Игрок {attacker.owner}: {attacker.type} побеждает {defender.type}."
            )
            self._check_winner_or_end_turn(room)
            return

        if result == "defender":
            attacker.alive = False
            room.last_battle_summary = (
                f"Игрок {defender.owner}: {defender.type} побеждает {attacker.type}."
            )
            self._check_winner_or_end_turn(room)
            return

        room.phase = "battle_pick"
        room.battle = BattleState(
            attacker_id=attacker.id,
            defender_id=defender.id,
            chooser=attacker.owner,
            round=1,
        )
        room.selected_piece_id = None
        room.message = f"Ничья. Игрок {attacker.owner} тайно выбирает новый тип."

    def _resolve_battle_choice(self, room: Room, player_id: int, choice: str) -> None:
        if room.connected_players() < 2 or room.phase != "battle_pick" or not room.battle:
            return
        if player_id != room.battle.chooser or choice not in PIECE_TYPES:
            return

        attacker = room.get_piece_by_id(room.battle.attacker_id)
        defender = room.get_piece_by_id(room.battle.defender_id)
        if not attacker or not defender or not attacker.alive or not defender.alive:
            room.phase = "turn"
            room.battle = None
            room.message = "Бой сброшен из-за несогласованного состояния."
            return

        if room.battle.chooser == attacker.owner:
            attacker.type = choice
            room.battle.chooser = defender.owner
            room.message = f"Игрок {defender.owner} тайно выбирает новый тип."
            return

        defender.type = choice
        result = compare_types(attacker.type, defender.type)
        if result == "tie":
            room.battle.round += 1
            room.battle.chooser = attacker.owner
            room.message = f"Снова ничья. Раунд {room.battle.round}: игрок {attacker.owner} выбирает тип."
            return

        room.battle = None
        if result == "attacker":
            defender.alive = False
            attacker.col = defender.col
            attacker.row = defender.row
            room.last_battle_summary = f"После переопределения типов игрок {attacker.owner} победил."
        else:
            attacker.alive = False
            room.last_battle_summary = f"После переопределения типов игрок {defender.owner} победил."
        self._check_winner_or_end_turn(room)

    def _check_winner_or_end_turn(self, room: Room) -> None:
        winner = 2 if len(room.get_alive_pieces(1)) == 0 else 1 if len(room.get_alive_pieces(2)) == 0 else None
        if winner:
            room.phase = "game_over"
            room.winner = winner
            room.message = f"Игрок {winner} победил и захватил поле."
            room.selected_piece_id = None
            return
        self._end_turn(room, room.last_battle_summary or f"Игрок {room.current_player} завершил действие.")

    def _end_turn(self, room: Room, message: str) -> None:
        room.current_player = 2 if room.current_player == 1 else 1
        room.selected_piece_id = None
        room.phase = "turn"
        room.turn_count += 1
        room.message = f"{message} Теперь ход игрока {room.current_player}."


manager = RoomManager()


class CreateRoomRequest(BaseModel):
    preset: str = "standard"


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


@app.websocket("/ws/games/{room_id}")
async def room_socket(websocket: WebSocket, room_id: str, token: Optional[str] = None) -> None:
    room: Optional[Room] = None
    player_id: Optional[int] = None
    try:
        room, player_id = await manager.connect(room_id, websocket, token)
        await manager.broadcast(room)
        while True:
            payload = await websocket.receive_json()
            await manager.handle_action(room, player_id, payload)
            await manager.broadcast(room)
    except HTTPException as exc:
        await websocket.accept()
        await websocket.send_text(json.dumps({"type": "error", "message": exc.detail}))
        await websocket.close(code=4403)
    except WebSocketDisconnect:
        if room is not None and player_id is not None:
            manager.disconnect(room, player_id)
            await manager.broadcast(room)


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
