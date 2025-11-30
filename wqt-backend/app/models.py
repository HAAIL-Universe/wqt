# app/models.py
from typing import List, Optional, Any
from pydantic import BaseModel


class MainState(BaseModel):
    version: str
    savedAt: Optional[str] = None

    picks: List[dict] = []
    history: List[dict] = []
    current: Optional[dict] = None
    tempWraps: List[dict] = []

    startTime: str = ""
    lastClose: str = ""
    pickingCutoff: str = ""

    undoStack: List[dict] = []
    proUnlocked: bool = False
    snakeUnlocked: bool = False

    shiftBreaks: List[dict] = []
    operativeLog: List[dict] = []
    operativeActive: Optional[dict] = None
