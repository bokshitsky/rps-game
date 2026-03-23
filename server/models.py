from __future__ import annotations

import asyncio
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


@dataclass
class BattleState:
    attacker_id: str
    defender_id: str
    attacker_owner: int
    defender_owner: int
    round: int
    locked_choices: dict[int, str] = field(default_factory=dict)


@dataclass
class Room:
    room_id: str
    parameters: dict[str, Any]
    phase: str = "waiting"
    current_player: Optional[int] = None
    pieces: list[Piece] = field(default_factory=list)
    winner: Optional[int] = None
    battle: Optional[BattleState] = None
    message: str = "Ждем второго игрока по ссылке."
    turn_count: int = 0
    last_battle_summary: str = ""
    ready_players: dict[int, bool] = field(default_factory=dict)
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

    def can_act(self, player_id: int) -> bool:
        if self.connected_players() < 2:
            return False
        if self.phase == "turn":
            return self.current_player == player_id
        if self.phase == "setup":
            return True
        if self.phase == "battle_pick" and self.battle:
            return player_id in {self.battle.attacker_owner, self.battle.defender_owner} and player_id not in self.battle.locked_choices
        return False

    def snapshot_for(self, player_id: int) -> dict[str, Any]:
        visible_pieces = [
            {
                "id": piece.id,
                "owner": piece.owner,
                "col": piece.col,
                "row": piece.row,
                "knownType": piece.type if piece.owner == player_id or self.phase == "game_over" else "hidden",
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
            "selectedPieceId": None,
            "winner": self.winner,
            "setup": {
                "yourReady": self.ready_players.get(player_id, False),
                "opponentReady": self.ready_players.get(2 if player_id == 1 else 1, False),
            },
            "battle": None
            if not self.battle
            else {
                "round": self.battle.round,
                "yourLocked": player_id in self.battle.locked_choices,
                "opponentLocked": (2 if player_id == 1 else 1) in self.battle.locked_choices,
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
