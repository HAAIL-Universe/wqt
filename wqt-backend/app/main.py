# app/main.py
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta 

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Ensure these modules exist in your project
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
    get_all_device_states,
    send_admin_message,  # NEW
    pop_admin_messages,  # NEW
    create_user,         # NEW - Added for login system
    verify_user,         # NEW - Added for login system
)

app = FastAPI(title="WQT Backend v1")

# -------------------------------------------------------------------
# CORS
# -------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
# Main state API (now user/device-aware)
# -------------------------------------------------------------------
@app.get("/api/state", response_model=MainState)
async def get_state(
    device_id: Optional[str] = Query(default=None, alias="device-id"),
    user_id: Optional[str] = Query(default=None, alias="user-id"), # NEW: For user-locked state
) -> MainState:
    """
    Load MainState. Prefer user-locked state, then device-specific state.
    """
    # PRIORITY: If a user is logged in, use their ID as the storage key (e.g., 'user:Urma')
    target_id = f"user:{user_id}" if user_id else device_id
    
    return load_main(device_id=target_id)


@app.post("/api/state", response_model=MainState)
async def set_state(
    state: MainState,
    device_id: Optional[str] = Query(default=None, alias="device-id"),
    operator_id: Optional[str] = Query(default=None, alias="operator-id"),
    user_id: Optional[str] = Query(default=None, alias="user-id"), # NEW: For user-locked state
) -> MainState:
    """
    Save MainState.
    Includes fixes for User ID persistence and Live Rate calculation.
    """
    
    # NEW: 1. Determine Storage Key (User > Device)
    target_id = f"user:{user_id}" if user_id else device_id

    # --- FIX 1: Ensure Operator ID is inside the state object ---
    # If user is logged in, force operator_id to match username (User Identity)
    if user_id and state.current:
        state.current["operator_id"] = user_id
    # Else, use the provided operator_id (Device Identity / Guest)
    # PATCH: Check 'is not None' so we allow empty strings to clear the ID
    elif operator_id is not None and state.current:
        state.current["operator_id"] = operator_id

    # --- FIX 2: Calculate Live Rate on Backend ---
    # Since the phone might not be sending a live rate, we calculate it here
    # Formula: Total Closed Units / Hours Elapsed since Start Time
    if state.current and state.startTime:
        try:
            # 1. Sum up total units from completed picks
            total_units = sum(p.get("units", 0) for p in state.picks)
            
            # 2. Calculate elapsed hours
            # Parse "HH:MM" (e.g. "06:30")
            now = datetime.now()
            start_parts = state.startTime.split(":")
            if len(start_parts) == 2:
                start_dt = now.replace(hour=int(start_parts[0]), minute=int(start_parts[1]), second=0, microsecond=0)
                
                # Handle shift crossing midnight (if start time is in future, it meant yesterday)
                if start_dt > now:
                    start_dt -= timedelta(days=1)
                    
                elapsed_hours = (now - start_dt).total_seconds() / 3600.0
                
                # 3. Inject Rate if valid
                if elapsed_hours > 0.05: # Avoid divide-by-zero or tiny intervals
                    calculated_rate = int(total_units / elapsed_hours)
                    state.current["liveRate"] = calculated_rate
        except Exception:
            # If date parsing fails, just ignore rate calc
            pass

    # Save to DB (using the determined target_id)
    save_main(state, device_id=target_id)

    # --- Logging Logic ---
    detail: Dict[str, Any] = {"version": state.version}
    
    # Log the target key used for storage
    if target_id:
        detail["storage_key"] = target_id

    if user_id:
        detail["logged_in_user"] = user_id
    elif operator_id is not None:
        detail["operator_id"] = operator_id
    
    if device_id:
        detail["device_id"] = device_id

    # --- FIX 3: Fix Log "User" Display ---
    # The Admin Panel looks for 'current_name'. 
    # Prioritize logged in user, then operator_id, then state.current['name']
    if user_id:
        detail["current_name"] = user_id
    # PATCH: Allow empty string to reflect cleared name
    elif operator_id is not None:
        detail["current_name"] = operator_id
    elif state.current and isinstance(state.current, dict):
        if "name" in state.current:
            detail["current_name"] = state.current["name"]

    log_usage_event("STATE_SAVE", detail)

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
    return {
        "days": days,
        "series": get_usage_summary(days=days),
    }

# -------------------------------------------------------------------
# Admin / Dashboard API
# -------------------------------------------------------------------
@app.get("/api/admin/devices")
async def api_admin_devices() -> List[Dict[str, Any]]:
    """
    Returns the full JSON state (including Picks & Current) for all devices.
    Used by the Admin Dashboard to show live status.
    """
    return get_all_device_states()


# -------------------------------------------------------------------
# Admin Message API (NEW)
# -------------------------------------------------------------------
class MessagePayload(BaseModel):
    device_id: str
    text: str

@app.post("/api/admin/message")
async def api_send_message(payload: MessagePayload) -> Dict[str, str]:
    """
    Send a message from Admin to a specific Device.
    """
    send_admin_message(payload.device_id, payload.text)
    return {"status": "sent"}

@app.get("/api/messages/check")
async def api_check_messages(
    device_id: str = Query(..., alias="device-id")
) -> List[str]:
    """
    Called by the WQT App (client) to poll for new admin messages.
    Returns list of message texts and marks them as read.
    """
    return pop_admin_messages(device_id)


# -------------------------------------------------------------------
# Shift/session API
# -------------------------------------------------------------------
class ShiftStartPayload(BaseModel):
    operator_id: str
    operator_name: Optional[str] = None
    site: Optional[str] = None
    shift_type: Optional[str] = None


class ShiftEndPayload(BaseModel):
    shift_id: int
    total_units: Optional[int] = None
    avg_rate: Optional[float] = None


@app.post("/api/shifts/start")
async def api_shift_start(
    payload: ShiftStartPayload,
    device_id: Optional[str] = Query(default=None, alias="device-id"),
) -> Dict[str, Any]:
    shift_id = start_shift(
        operator_id=payload.operator_id,
        device_id=device_id,
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

# -------------------------------------------------------------------
# Auth API (NEW)
# -------------------------------------------------------------------
class AuthPayload(BaseModel):
    username: str
    pin: str

@app.post("/api/auth/register")
async def api_register(payload: AuthPayload) -> Dict[str, Any]:
    # Basic validation
    if len(payload.pin) < 4:
        return {"success": False, "message": "PIN must be 4 digits"}
    
    clean_user = payload.username.strip()
    success = create_user(clean_user, payload.pin) 
    if success:
        return {"success": True, "username": clean_user}
    else:
        return {"success": False, "message": "Username taken"}

@app.post("/api/auth/login")
async def api_login(payload: AuthPayload) -> Dict[str, Any]:
    clean_user = payload.username.strip()
    valid = verify_user(clean_user, payload.pin) 
    if valid:
        return {"success": True, "username": clean_user}
    else:
        return {"success": False, "message": "Invalid PIN"}