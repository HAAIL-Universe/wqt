# app/models.py
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class OrderSummary(BaseModel):
  """
  Lightweight schema for a single closed-order summary as carried
  inside `picks[]` and history blobs. This makes the `locations`
  field explicit for validation / docs, while keeping MainState
  flexible.
  """
  name: Optional[str] = None
  units: Optional[int] = None
  locations: int = 0
  start: Optional[str] = None
  close: Optional[str] = None
  pallets: Optional[int] = None
  excl: Optional[int] = None
  closedEarly: Optional[bool] = False
  log: Optional[Dict[str, Any]] = None

  class Config:
    extra = "allow"


class MainState(BaseModel):
    """
    Canonical shape of the main WQT state blob as used by the frontend.

    This is intentionally:
    - Very close to the JS DEFAULT_MAIN_STATE.
    - Flexible: we allow extra fields so the backend doesn't drop new keys
      if the frontend evolves (SaaS-safe).
    """

    # Core meta
    version: str
    savedAt: Optional[str] = None  # ISO string from the frontend

    # Main collections
    picks: List[Dict[str, Any]] = Field(default_factory=list)
    history: List[Dict[str, Any]] = Field(default_factory=list)
    current: Optional[Dict[str, Any]] = None
    tempWraps: List[Dict[str, Any]] = Field(default_factory=list)

    # Session timing
    startTime: str = ""
    lastClose: str = ""
    pickingCutoff: str = ""

    # UX / power user features
    undoStack: List[Dict[str, Any]] = Field(default_factory=list)
    proUnlocked: bool = False

    # Shift + operative logging
    shiftBreaks: List[Dict[str, Any]] = Field(default_factory=list)
    operativeLog: List[Dict[str, Any]] = Field(default_factory=list)
    operativeActive: Optional[Dict[str, Any]] = None

    class Config:
        # Important for forward-compat: don't explode or silently drop
        # if the frontend adds extra fields – just round-trip them.
        extra = "allow"
