# app/storage.py
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
    Load the legacy JSON file if it exists.
    """
    if not STATE_FILE.exists():
        return None
    try:
        with STATE_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_to_file(payload: dict) -> None:
    """
    Persist the legacy JSON file. Used both for local dev and as a backup
    even when Postgres is enabled.
    """
    with STATE_FILE.open("w", encoding="utf-8") as f:
        json.dump(payload or {}, f, ensure_ascii=False)


def load_main() -> MainState:
    """
    Load the main state, preferring Postgres if available, falling back to JSON.

    Always returns a MainState pydantic model, so existing callers don't change.
    """
    # 1) Try DB-backed global state
    payload = load_global_state()

    # 2) Fallback to legacy file if DB has nothing or DB is unavailable
    if not payload:
        payload = _load_from_file()

    # 3) Last resort: default MainState (uses model defaults)
    if not payload:
        # If nothing is stored anywhere, fall back to a minimal default state.
        # Version is required by the model; other fields have sensible defaults.
        return MainState(version="3.3.55")

    # Ensure it maps into MainState safely
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
