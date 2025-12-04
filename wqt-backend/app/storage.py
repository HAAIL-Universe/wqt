# wqt-backend/app/storage.py
import json
from pathlib import Path
from typing import Optional

from .models import MainState
from .db import (
    load_global_state,
    save_global_state,
    load_device_state,
    save_device_state,
)

# Legacy file path for local / fallback mode
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
STATE_FILE = DATA_DIR / "main_state.json"


def _load_from_file() -> Optional[dict]:
    """
    Load the last saved MainState payload from the local JSON file.
    Returns None if the file does not exist or is invalid.
    """
    if not STATE_FILE.exists():
        return None

    try:
        with STATE_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        # Treat any corrupted / partial file as "no data"
        return None


def _save_to_file(payload: dict) -> None:
    """
    Persist a JSON-serialisable payload to the local JSON file.
    """
    try:
        with STATE_FILE.open("w", encoding="utf-8") as f:
            json.dump(payload or {}, f)
    except Exception:
        # Local file is only a safety net; if it fails we don't want 500s.
        pass


def load_main(device_id: Optional[str] = None) -> MainState:
    """
    Load the MainState for a specific device.

    Order of precedence now:
      1. Per-device state in Postgres (device_id required)
      2. Local JSON file (legacy single-device / offline)
      3. A fresh default MainState

    We deliberately do NOT fall back to a global DB state anymore,
    to avoid cross-device history bleed.
    """
    payload: Optional[dict] = None

    # 1) Try per-device state if we were given a device_id
    if device_id:
        payload = load_device_state(device_id)

    # 2) Fall back to legacy file (for offline / dev)
    if not payload:
        payload = _load_from_file()

    # 3) Fresh install / first run – minimal sane defaults.
    if not payload:
        return MainState(version="3.3.55")

    return MainState(**payload)


def save_main(state: MainState, device_id: Optional[str] = None) -> None:
    """
    Persist main state to Postgres *per-device* when we know the device_id.
    If we don't know the device, only write to the local JSON snapshot to
    avoid creating a shared global blob.
    """
    if isinstance(state, MainState):
        payload = state.model_dump()
    else:
        payload = dict(state or {})

    # Only use per-device rows in Postgres now
    if device_id:
        save_device_state(device_id, payload)
    else:
        # No device_id – only keep a local backup, don't pollute global DB state
        _save_to_file(payload)
        return

    # Still keep the local JSON snapshot as a last-known-state backup
    _save_to_file(payload)
