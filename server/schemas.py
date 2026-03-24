from typing import Optional

from pydantic import BaseModel


class CreateRoomRequest(BaseModel):
    preset: str = "standard"


class RoomActionRequest(BaseModel):
    type: str
    pieceId: Optional[str] = None
    targetCol: Optional[int] = None
    targetRow: Optional[int] = None
    choice: Optional[str] = None
    accepted: Optional[bool] = None
