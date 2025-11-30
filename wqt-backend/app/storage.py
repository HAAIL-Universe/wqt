# app/storage.py
from pathlib import Path
from typing import Optional
from .models import MainState

DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

STATE_FILE = DATA_DIR / "main_state.json"


def load_main() -> MainState:
    if not STATE_FILE.exists():
        # default empty state
        return MainState(
            version="3.3.55",
            picks=[],
            history=[],
        )
    raw = STATE_FILE.read_text(encoding="utf-8")
    import json
    data = json.loads(raw)
    return MainState(**data)


def save_main(state: MainState) -> None:
    import json
    DATA_DIR.mkdir(exist_ok=True)
    STATE_FILE.write_text(
        json.dumps(state.dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
