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
    Load the MainState from, in order of preference:
      1. Per-device state in Postgres (if device_id is provided and DB is configured)
      2. Global state in Postgres (if configured)
      3. Local JSON file
      4. A fresh default MainState

    This lets each device have its own slice of state while still preserving
    legacy behaviour for existing installs.
    """
    payload: Optional[dict] = None

    # 1) Try per-device state if we were given a device_id
    if device_id:
        payload = load_device_state(device_id)

    # 2) Fall back to global state if nothing found
    if not payload:
        payload = load_global_state()

    # 3) Fall back to legacy file
    if not payload:
        payload = _load_from_file()

    # 4) Fresh install / first run – minimal sane defaults.
    if not payload:
        return MainState(version="3.3.55")

    # Ensure it maps into MainState safely – Pydantic will enforce shape.
    return MainState(**payload)


def save_main(state: MainState, device_id: Optional[str] = None) -> None:
    """
    Persist main state to Postgres (per-device if device_id is provided, or
    global otherwise), and always to the legacy JSON file as backup / local
    dev support.
    """
    if isinstance(state, MainState):
        payload = state.model_dump()
    else:
        payload = dict(state or {})

    # 1) Save to per-device or global DB, depending on whether we know the device
    if device_id:
        save_device_state(device_id, payload)
    else:
        save_global_state(payload)

    # 2) Also save to local JSON file (acts as a "last known state" snapshot)
    _save_to_file(payload)
