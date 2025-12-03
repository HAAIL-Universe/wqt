# app/main.py
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from .models import MainState
from .storage import load_main, save_main
from .db import (
    init_db,
    log_usage_event,
    get_recent_usage,
    get_usage_summary,
    start_shift,
    end_shift,
    get_recent_shifts,
)

app = FastAPI(title="WQT Backend v0")

# -------------------------------------------------------------------
# CORS
# -------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later if you want
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------------------------
# Startup
# -------------------------------------------------------------------
@app.on_event("startup")
async def on_startup() -> None:
    init_db()


# -------------------------------------------------------------------
# Health
# -------------------------------------------------------------------
@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


# -------------------------------------------------------------------
# Main state API (now device-aware)
# -------------------------------------------------------------------
@app.get("/api/state", response_model=MainState)
async def get_state(
    device_id: Optional[str] = Query(default=None, alias="device-id"),
) -> MainState:
    """
    Load MainState. If device-id is provided, we will (once storage.py is
    updated) prefer that device's state; otherwise we fall back to global.
    """
    return load_main(device_id=device_id)  # storage.py will accept this


@app.post("/api/state", response_model=MainState)
async def set_state(
    state: MainState,
    device_id: Optional[str] = Query(default=None, alias="device-id"),
    operator_id: Optional[str] = Query(default=None, alias="operator-id"),
) -> MainState:
    """
    Save MainState, optionally scoped to a device-id and tagged with operator-id.
    We deliberately do NOT log every STATE_SAVE as usage anymore to avoid
    spamming analytics with autosaves.
    """
    save_main(state, device_id=device_id)

    # If you ever want to selectively log "manual" saves, you can add a
    # separate endpoint or a flag here. For now we avoid STATE_SAVE spam.
    # detail: Dict[str, Any] = {"version": state.version}
    # if operator_id:
    #     detail["operator_id"] = operator_id
    # if device_id:
    #     detail["device_id"] = device_id
    # log_usage_event("STATE_SAVE", detail)

    return state


# -------------------------------------------------------------------
# Usage analytics API
# -------------------------------------------------------------------
@app.get("/api/usage/recent")
async def api_usage_recent(
    limit: int = Query(100, ge=1, le=1000),
) -> List[Dict[str, Any]]:
    return get_recent_usage(limit=limit)


@app.get("/api/usage/summary")
async def api_usage_summary(
    days: int = Query(7, ge=1, le=30),
) -> Dict[str, Any]:
    """
    Currently still counts STATE_SAVE events in db.get_usage_summary().
    Once you're happy with SHIFT_START-based metrics, we can switch that
    over to a different category or a mix.
    """
    return {
        "days": days,
        "series": get_usage_summary(days=days),
    }


# -------------------------------------------------------------------
# Shift/session API
# -------------------------------------------------------------------
class ShiftStartPayload(BaseModel):
    operator_id: str
    operator_name: Optional[str] = None
    site: Optional[str] = None
    shift_type: Optional[str] = None  # "9h", "10h", "night", etc.


class ShiftEndPayload(BaseModel):
    shift_id: int
    total_units: Optional[int] = None
    avg_rate: Optional[float] = None  # units/hour


@app.post("/api/shifts/start")
async def api_shift_start(
    payload: ShiftStartPayload,
    device_id: Optional[str] = Query(default=None, alias="device-id"),
) -> Dict[str, Any]:
    """
    Start a shift and log a SHIFT_START usage event.
    device_id is optional, but when present we include it in the log so
    admin views can correlate devices with shifts later.
    """
    shift_id = start_shift(
        operator_id=payload.operator_id,
        operator_name=payload.operator_name,
        site=payload.site,
        shift_type=payload.shift_type,
    )

    detail: Dict[str, Any] = {
        "shift_id": shift_id,
        "operator_id": payload.operator_id,
        "operator_name": payload.operator_name,
        "site": payload.site,
        "shift_type": payload.shift_type,
    }
    if device_id:
        detail["device_id"] = device_id

    log_usage_event("SHIFT_START", detail)

    return {"shift_id": shift_id}


@app.post("/api/shifts/end")
async def api_shift_end(
    payload: ShiftEndPayload,
    device_id: Optional[str] = Query(default=None, alias="device-id"),
) -> Dict[str, Any]:
    """
    End a shift and log a SHIFT_END usage event.
    """
    end_shift(
        shift_id=payload.shift_id,
        total_units=payload.total_units,
        avg_rate=payload.avg_rate,
    )

    detail: Dict[str, Any] = {
        "shift_id": payload.shift_id,
        "total_units": payload.total_units,
        "avg_rate": payload.avg_rate,
    }
    if device_id:
        detail["device_id"] = device_id

    log_usage_event("SHIFT_END", detail)

    return {"status": "ok"}


@app.get("/api/shifts/recent")
async def api_shifts_recent(
    limit: int = Query(50, ge=1, le=200),
) -> List[Dict[str, Any]]:
    return get_recent_shifts(limit=limit)
