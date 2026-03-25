from __future__ import annotations

import json
import random
import secrets
import time
from typing import Any, Optional

from fastapi import HTTPException, WebSocket

from .constants import BOARD_COLS, KING_TYPE, PIECE_TYPES, STARTING_PIECES_PER_PLAYER, TYPE_ORDER
from .models import BattleState, Piece, RestartState, Room


ROOM_POLL_TIMEOUT_SECONDS = 20.0
PLAYER_PRESENCE_TIMEOUT_SECONDS = 5.0


def compare_types(attacker: str, defender: str) -> str:
    if attacker == KING_TYPE and defender == KING_TYPE:
        return "attacker"
    if defender == KING_TYPE:
        return "attacker"
    if attacker == KING_TYPE:
        return "defender"
    if attacker == defender:
        return "tie"
    return "attacker" if TYPE_ORDER[attacker] == defender else "defender"


def create_chess_like_cells(player_id: int) -> list[dict[str, int]]:
    main_rows = [5, 4] if player_id == 1 else [0, 1]
    cells: list[dict[str, int]] = []
    for row in main_rows:
        for col in range(BOARD_COLS):
            cells.append({"col": col, "row": row})
    return cells


def create_random_distribution(preset: str) -> list[str]:
    if preset == "king":
        distribution = ["rock"] * 5 + ["paper"] * 5 + ["scissors"] * 5 + [KING_TYPE]
    else:
        distribution = ["rock"] * 5 + ["paper"] * 5 + ["scissors"] * 5 + [random.choice(PIECE_TYPES)]
    random.shuffle(distribution)
    return distribution


def create_player_pieces(player_id: int, preset: str) -> list[Piece]:
    distribution = create_random_distribution(preset)
    cells = create_chess_like_cells(player_id)
    pieces: list[Piece] = []
    for index, piece_type in enumerate(distribution):
        pieces.append(
            Piece(
                id=f"p{player_id}-{index}",
                owner=player_id,
                type=piece_type,
                col=cells[index]["col"],
                row=cells[index]["row"],
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
        room.player_last_seen_at[player_id] = time.monotonic()
        self.rooms[room_id] = room
        return room, player_id

    def get_room(self, room_id: str) -> Room:
        self._prune_expired_room(room_id)
        room = self.rooms.get(room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")
        return room

    def touch_poll(self, room: Room) -> None:
        room.last_poll_at = time.monotonic()

    def touch_player(self, room: Room, player_id: int) -> None:
        room.player_last_seen_at[player_id] = time.monotonic()
        self._refresh_presence_message(room)

    async def connect(self, room_id: str, websocket: WebSocket, token: Optional[str]) -> tuple[Room, int]:
        room = self.get_room(room_id)
        async with room.lock:
            player_id = self._resolve_player(room, token)
            await websocket.accept()
            room.sockets[player_id] = websocket
            room.player_last_seen_at[player_id] = time.monotonic()

            if room.registered_players() == 2 and room.phase == "waiting":
                self._start_setup(room)
            else:
                self._refresh_presence_message(room)

            return room, player_id

    def disconnect(self, room: Room, player_id: int) -> None:
        room.sockets.pop(player_id, None)
        self._refresh_presence_message(room)

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
            elif action_type == "reroll_setup":
                self._reroll_setup(room, player_id)
            elif action_type == "ready_setup":
                self._ready_setup(room, player_id)
            elif action_type == "request_restart":
                self._request_restart(room, player_id)
            elif action_type == "respond_restart":
                self._respond_restart(room, player_id, bool(payload.get("accepted")))

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
                room.player_last_seen_at[player_id] = time.monotonic()
                return player_id

        raise HTTPException(status_code=403, detail="Room is full")

    def _prune_expired_room(self, room_id: str) -> None:
        room = self.rooms.get(room_id)
        if not room:
            return
        if time.monotonic() - room.last_poll_at <= ROOM_POLL_TIMEOUT_SECONDS:
            return
        self.rooms.pop(room_id, None)

    def _start_setup(self, room: Room) -> None:
        room.phase = "setup"
        room.current_player = None
        preset = str(room.parameters.get("preset", "standard"))
        room.pieces = create_player_pieces(1, preset) + create_player_pieces(2, preset)
        room.winner = None
        room.battle = None
        room.restart = None
        room.turn_count = 0
        room.last_battle_summary = ""
        room.ready_players = {1: False, 2: False}
        room.message = "Оба игрока подключились. Пересбросьте расстановку при желании и нажмите «Готов»."

    def _start_match(self, room: Room) -> None:
        room.phase = "turn"
        room.current_player = random.choice((1, 2))
        room.turn_count = 1
        room.restart = None
        room.message = ""

    def _refresh_presence_message(self, room: Room) -> None:
        active_players = room.active_players(PLAYER_PRESENCE_TIMEOUT_SECONDS)
        if room.phase == "waiting":
            room.message = "Ждем второго игрока по ссылке."
            return
        if room.phase == "game_over":
            return
        if active_players < 2:
            room.message = "Противник отключился. Ждем переподключения."
            return
        if room.restart:
            room.message = "Ожидаем ответ соперника на предложение начать сначала."
            return
        if room.phase == "setup":
            if room.ready_players.get(1) and room.ready_players.get(2):
                room.message = ""
            elif room.ready_players.get(1) or room.ready_players.get(2):
                room.message = "Ждем подтверждение соперника."
            else:
                room.message = "Оба игрока подключились. Пересбросьте расстановку при желании и нажмите «Готов»."
            return
        if room.message == "Противник отключился. Ждем переподключения.":
            room.message = ""

    def _replace_player_pieces(self, room: Room, player_id: int) -> None:
        other_pieces = [piece for piece in room.pieces if piece.owner != player_id]
        preset = str(room.parameters.get("preset", "standard"))
        room.pieces = other_pieces + create_player_pieces(player_id, preset)

    def _reroll_setup(self, room: Room, player_id: int) -> None:
        if room.connected_players() < 2 or room.phase != "setup":
            return
        self._replace_player_pieces(room, player_id)
        room.ready_players[player_id] = False
        room.message = f"Игрок {player_id} пересобрал стартовую расстановку."

    def _ready_setup(self, room: Room, player_id: int) -> None:
        if room.connected_players() < 2 or room.phase != "setup":
            return
        room.ready_players[player_id] = True
        if room.ready_players.get(1) and room.ready_players.get(2):
            self._start_match(room)
            return
        room.message = "Ждем подтверждение соперника."

    def _request_restart(self, room: Room, player_id: int) -> None:
        if room.active_players(PLAYER_PRESENCE_TIMEOUT_SECONDS) < 2 or room.restart:
            return
        room.restart = RestartState(requester_id=player_id)
        room.message = "Ожидаем ответ соперника на предложение начать сначала."

    def _respond_restart(self, room: Room, player_id: int, accepted: bool) -> None:
        if room.active_players(PLAYER_PRESENCE_TIMEOUT_SECONDS) < 2 or not room.restart:
            return
        if room.restart.requester_id == player_id:
            return
        if accepted:
            self._start_setup(room)
            return
        room.restart = None
        room.message = "Предложение начать сначала было отклонено."

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
        self._end_turn(room)

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
            self._reveal_piece(room, attacker)
            room.last_battle_summary = (
                f"Игрок {attacker.owner}: {attacker.type} побеждает {defender.type}."
            )
            self._check_winner_or_end_turn(room)
            return

        if result == "defender":
            attacker.alive = False
            self._reveal_piece(room, defender)
            room.last_battle_summary = (
                f"Игрок {defender.owner}: {defender.type} побеждает {attacker.type}."
            )
            self._check_winner_or_end_turn(room)
            return

        room.phase = "battle_pick"
        room.battle = BattleState(
            attacker_id=attacker.id,
            defender_id=defender.id,
            attacker_owner=attacker.owner,
            defender_owner=defender.owner,
            round=1,
        )
        room.message = "Ничья. Оба игрока одновременно выбирают новый тип."

    def _resolve_battle_choice(self, room: Room, player_id: int, choice: str) -> None:
        if room.connected_players() < 2 or room.phase != "battle_pick" or not room.battle:
            return
        if player_id not in {room.battle.attacker_owner, room.battle.defender_owner} or choice not in PIECE_TYPES:
            return

        attacker = room.get_piece_by_id(room.battle.attacker_id)
        defender = room.get_piece_by_id(room.battle.defender_id)
        if not attacker or not defender or not attacker.alive or not defender.alive:
            room.phase = "turn"
            room.battle = None
            room.message = "Бой сброшен из-за несогласованного состояния."
            return

        room.battle.locked_choices[player_id] = choice
        if len(room.battle.locked_choices) < 2:
            room.message = "Ожидаем тайный выбор соперника."
            return

        attacker.type = room.battle.locked_choices[attacker.owner]
        defender.type = room.battle.locked_choices[defender.owner]
        result = compare_types(attacker.type, defender.type)
        if result == "tie":
            room.battle.round += 1
            room.battle.locked_choices.clear()
            room.message = f"Снова ничья. Раунд {room.battle.round}: оба игрока выбирают новый тип."
            return

        room.battle = None
        if result == "attacker":
            defender.alive = False
            attacker.col = defender.col
            attacker.row = defender.row
            self._reveal_piece(room, attacker)
            room.last_battle_summary = f"После переопределения типов игрок {attacker.owner} победил."
        else:
            attacker.alive = False
            self._reveal_piece(room, defender)
            room.last_battle_summary = f"После переопределения типов игрок {defender.owner} победил."
        self._check_winner_or_end_turn(room)

    def _reveal_piece(self, room: Room, piece: Piece) -> None:
        piece.revealed_until_turn = max(piece.revealed_until_turn, room.turn_count + 2)

    def _check_winner_or_end_turn(self, room: Room) -> None:
        victory_target = int(room.parameters.get("victoryTarget", 12))
        player1_captured = STARTING_PIECES_PER_PLAYER - len(room.get_alive_pieces(2))
        player2_captured = STARTING_PIECES_PER_PLAYER - len(room.get_alive_pieces(1))
        winner = None

        if room.parameters.get("preset") == "king":
            player1_king_alive = any(piece.alive and piece.owner == 1 and piece.type == KING_TYPE for piece in room.pieces)
            player2_king_alive = any(piece.alive and piece.owner == 2 and piece.type == KING_TYPE for piece in room.pieces)
            if not player2_king_alive:
                winner = 1
            elif not player1_king_alive:
                winner = 2

        if winner is None and (player1_captured >= victory_target or len(room.get_alive_pieces(2)) == 0):
            winner = 1
        elif winner is None and (player2_captured >= victory_target or len(room.get_alive_pieces(1)) == 0):
            winner = 2

        if winner:
            room.phase = "game_over"
            room.winner = winner
            room.restart = None
            room.message = f"Игрок {winner} победил и захватил поле."
            return
        self._end_turn(room)

    def _end_turn(self, room: Room) -> None:
        room.current_player = 2 if room.current_player == 1 else 1
        room.phase = "turn"
        room.turn_count += 1
        room.message = ""
