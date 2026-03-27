from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from fastapi import WebSocket


@dataclass
class Piece:
    id: str
    owner: int
    type: str
    col: int
    row: int
    alive: bool = True
    revealed_until_turn: int = -1
    king_return_forbidden_col: Optional[int] = None
    king_return_forbidden_row: Optional[int] = None


@dataclass
class BattleState:
    attacker_id: str
    defender_id: str
    attacker_owner: int
    defender_owner: int
    round: int
    locked_choices: dict[int, str] = field(default_factory=dict)


@dataclass
class RestartState:
    requester_id: int


@dataclass
class Room:
    room_id: str
    parameters: dict[str, Any]
    phase: str = "waiting"
    current_player: Optional[int] = None
    pieces: list[Piece] = field(default_factory=list)
    winner: Optional[int] = None
    battle: Optional[BattleState] = None
    restart: Optional[RestartState] = None
    message: str = "Ждем второго игрока по ссылке."
    turn_count: int = 0
    action_seq: int = 0
    last_battle_summary: str = ""
    animation_hint: Optional[dict[str, Any]] = None
    ready_players: dict[int, bool] = field(default_factory=dict)
    player_tokens: dict[int, str] = field(default_factory=dict)
    player_last_seen_at: dict[int, float] = field(default_factory=dict)
    player_time_remaining_ms: dict[int, int] = field(default_factory=lambda: {1: 0, 2: 0})
    player_time_started: dict[int, bool] = field(default_factory=lambda: {1: False, 2: False})
    player_clock_running_since: dict[int, Optional[float]] = field(default_factory=lambda: {1: None, 2: None})
    sockets: dict[int, WebSocket] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_poll_at: float = field(default_factory=time.monotonic)

    def connected_players(self) -> int:
        return len(self.sockets)

    def active_players(self, timeout_seconds: float) -> int:
        now = time.monotonic()
        return sum(
            1
            for player_id in self.player_tokens
            if now - self.player_last_seen_at.get(player_id, 0.0) <= timeout_seconds
        )

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

    def can_act(self, player_id: int, presence_timeout_seconds: float) -> bool:
        if self.active_players(presence_timeout_seconds) < 2:
            return False
        if self.phase == "turn":
            return self.current_player == player_id
        if self.phase == "setup":
            return True
        if self.phase == "battle_pick" and self.battle:
            return player_id in {self.battle.attacker_owner, self.battle.defender_owner} and player_id not in self.battle.locked_choices
        return False

    def snapshot_for(self, player_id: int, presence_timeout_seconds: float) -> dict[str, Any]:
        visible_pieces = [
            {
                "id": piece.id,
                "owner": piece.owner,
                "col": piece.col,
                "row": piece.row,
                "knownType": (
                    piece.type
                    if piece.owner == player_id
                    or self.phase == "game_over"
                    or self.turn_count <= piece.revealed_until_turn
                    else "hidden"
                ),
                "forbiddenReturnCol": piece.king_return_forbidden_col if piece.owner == player_id else None,
                "forbiddenReturnRow": piece.king_return_forbidden_row if piece.owner == player_id else None,
            }
            for piece in self.pieces
            if piece.alive
        ]
        return {
            "roomId": self.room_id,
            "snapshotTimeMs": int(time.time() * 1000),
            "phase": self.phase,
            "yourPlayerId": player_id,
            "playerToken": self.player_tokens[player_id],
            "currentPlayer": self.current_player,
            "selectedPieceId": None,
            "winner": self.winner,
            "setup": {
                "yourReady": self.ready_players.get(player_id, False),
                "opponentReady": self.ready_players.get(2 if player_id == 1 else 1, False),
            },
            "battle": None
            if not self.battle
            else {
                "attackerId": self.battle.attacker_id,
                "defenderId": self.battle.defender_id,
                "attackerType": self.get_piece_by_id(self.battle.attacker_id).type if self.get_piece_by_id(self.battle.attacker_id) else None,
                "defenderType": self.get_piece_by_id(self.battle.defender_id).type if self.get_piece_by_id(self.battle.defender_id) else None,
                "round": self.battle.round,
                "yourLocked": player_id in self.battle.locked_choices,
                "opponentLocked": (2 if player_id == 1 else 1) in self.battle.locked_choices,
            },
            "restart": None
            if not self.restart
            else {
                "requestedByYou": self.restart.requester_id == player_id,
                "awaitingYourDecision": self.restart.requester_id != player_id,
            },
            "message": self.message,
            "lastBattleSummary": self.last_battle_summary,
            "animationHint": self.animation_hint,
            "connectedPlayers": self.active_players(presence_timeout_seconds),
            "requiredPlayers": 2,
            "parameters": self.parameters,
            "timers": {
                "player1": {
                    "remainingMs": self.player_time_remaining_ms.get(1, 0),
                    "running": self.player_clock_running_since.get(1) is not None,
                    "started": self.player_time_started.get(1, False),
                },
                "player2": {
                    "remainingMs": self.player_time_remaining_ms.get(2, 0),
                    "running": self.player_clock_running_since.get(2) is not None,
                    "started": self.player_time_started.get(2, False),
                },
            },
            "canAct": self.can_act(player_id, presence_timeout_seconds),
            "counts": {
                "player1": len(self.get_alive_pieces(1)),
                "player2": len(self.get_alive_pieces(2)),
            },
            "visiblePieces": visible_pieces,
        }
