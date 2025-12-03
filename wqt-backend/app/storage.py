# wqt-backend/app/storage.py
import json
from pathlib import Path
from typing import Optional

from .models import MainState
from .db import load_global_state, save_global_state

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


def load_main() -> MainState:
    """
    Load the MainState from, in order of preference:
      1. Postgres (if configured)
      2. Local JSON file
      3. A fresh default MainState
    """
    payload = load_global_state()
    if not payload:
        payload = _load_from_file()

    if not payload:
        # Fresh install / first run – minimal sane defaults.
        return MainState(version="3.3.55")

    # Ensure it maps into MainState safely – Pydantic will enforce shape.
    return MainState(**payload)


def save_main(state: MainState) -> None:
    """
    Persist main state to Postgres if available, and always to the legacy JSON
    file as backup / local dev support.
    """
    if isinstance(state, MainState):
        payload = state.model_dump()
    else:
        payload = dict(state or {})

    # 1) Save to DB (no-op if DATABASE_URL is missing)
    save_global_state(payload)

    # 2) Also save to local JSON file
    _save_to_file(payload)
