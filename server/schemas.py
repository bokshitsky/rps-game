from typing import Optional

from pydantic import BaseModel, Field


class CreateRoomRequest(BaseModel):
    preset: str = "standard"
    victory_target: int = Field(default=12, ge=1, le=16)
    time_limit_minutes: int = Field(default=5, ge=1, le=15)


class RoomActionRequest(BaseModel):
    type: str
    pieceId: Optional[str] = None
    targetCol: Optional[int] = None
    targetRow: Optional[int] = None
    choice: Optional[str] = None
    accepted: Optional[bool] = None
