from __future__ import annotations

import json
import secrets
from typing import Any, Optional

from fastapi import HTTPException, WebSocket

from .constants import BOARD_COLS, PIECE_TYPES, TYPE_ORDER
from .models import BattleState, Piece, Room


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
            if action_type == "move_piece":
                self._move_piece(
                    room,
                    player_id,
                    str(payload["pieceId"]),
                    int(payload["targetCol"]),
                    int(payload["targetRow"]),
                )
            elif action_type == "attempt_capture":
                self._attempt_capture(
                    room,
                    player_id,
                    str(payload["pieceId"]),
                    int(payload["targetCol"]),
                    int(payload["targetRow"]),
                )
            elif action_type == "battle_choice":
                self._resolve_battle_choice(room, player_id, str(payload["choice"]))

    async def notify_refresh(self, room: Room) -> None:
        stale_players: list[int] = []
        for player_id, socket in list(room.sockets.items()):
            try:
                await socket.send_text(json.dumps({"type": "refresh"}))
            except Exception:
                stale_players.append(player_id)
        for player_id in stale_players:
            self.disconnect(room, player_id)

    def resolve_player(self, room: Room, token: Optional[str]) -> int:
        return self._resolve_player(room, token)

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
        room.winner = None
        room.battle = None
        room.turn_count = 1
        room.last_battle_summary = ""
        room.message = "Оба игрока подключились. Ход игрока 1."

    def _is_adjacent(self, piece: Piece, col: int, row: int) -> bool:
        return abs(piece.col - col) + abs(piece.row - row) == 1

    def _load_action_piece(self, room: Room, player_id: int, piece_id: str) -> Optional[Piece]:
        if room.connected_players() < 2 or room.phase != "turn" or room.current_player != player_id:
            return None
        piece = room.get_piece_by_id(piece_id)
        if not piece or not piece.alive or piece.owner != player_id:
            return None
        return piece

    def _move_piece(self, room: Room, player_id: int, piece_id: str, col: int, row: int) -> None:
        selected = self._load_action_piece(room, player_id, piece_id)
        if not selected or not self._is_adjacent(selected, col, row):
            return

        if room.get_piece_at(col, row):
            return

        selected.col = col
        selected.row = row
        self._end_turn(room, f"Игрок {player_id} переместил фигуру.")

    def _attempt_capture(self, room: Room, player_id: int, piece_id: str, col: int, row: int) -> None:
        selected = self._load_action_piece(room, player_id, piece_id)
        if not selected or not self._is_adjacent(selected, col, row):
            return

        target = room.get_piece_at(col, row)
        if not target or target.owner == player_id:
            return

        self._begin_battle(room, selected, target)

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
            return
        self._end_turn(room, room.last_battle_summary or f"Игрок {room.current_player} завершил действие.")

    def _end_turn(self, room: Room, message: str) -> None:
        room.current_player = 2 if room.current_player == 1 else 1
        room.phase = "turn"
        room.turn_count += 1
        room.message = f"{message} Теперь ход игрока {room.current_player}."
