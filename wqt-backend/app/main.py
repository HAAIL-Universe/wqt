from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
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
    get_all_device_states,
    send_admin_message,
    pop_admin_messages,
    create_user,
    verify_user,
    get_user,  # NEW
    record_order_from_payload,  # NEW: orders table integration
    load_device_state,          # NEW: legacy fallback
    save_device_state,          # NEW: migrate to user key
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
# Main state API (user/device-aware)
# -------------------------------------------------------------------
@app.get("/api/state", response_model=MainState)
async def get_state(
    device_id: Optional[str] = Query(default=None, alias="device-id"),
    user_id: Optional[str] = Query(default=None, alias="user-id"),
) -> MainState:
    """
    Load MainState.

    Priority:
      1) Per-user state: device_states.device_id = "user:<PIN>"
      2) Legacy per-device state (device_states.device_id = "<device uuid>"),
         migrated into the user key when found.
      3) Global / legacy fallback from storage.load_main().
    """
    # Build keys
    primary_key: Optional[str] = f"user:{user_id}" if user_id else device_id
    legacy_key: Optional[str] = device_id if (user_id and device_id) else None

    raw: Optional[dict] = None

    # 1) Try the primary key (user:<PIN> or bare device_id if no user)
    if primary_key:
        raw = load_device_state(primary_key)

    # 2) Fallback: legacy device-only state, then migrate → user:<PIN>
    if raw is None and legacy_key and legacy_key != primary_key:
        legacy_raw = load_device_state(legacy_key)
        if legacy_raw:
            raw = legacy_raw
            try:
                # Only migrate when we *know* primary_key is real
                if primary_key:
                    save_device_state(primary_key, legacy_raw)
            except Exception:
                # Migration failure should not break load
                pass

    # 3) If we found anything, return it as a MainState
    if raw is not None:
        return MainState(**raw)

    # 4) Final fallback: let storage decide (global JSON or blank state)
    return load_main(device_id=None)

@app.post("/api/state", response_model=MainState)
async def set_state(
    state: MainState,
    device_id: Optional[str] = Query(default=None, alias="device-id"),
    operator_id: Optional[str] = Query(default=None, alias="operator-id"),
    user_id: Optional[str] = Query(default=None, alias="user-id"),
) -> MainState:
    """
    Save MainState.
    Includes fixes for User ID persistence and Live Rate calculation.
    """

    # 1) Determine storage key (User > Device) and capture raw device for display
    raw_device_id = device_id
    target_id = f"user:{user_id}" if user_id else device_id

    # Ensure current dict exists
    if state.current is None:
        state.current = {}
    elif not isinstance(state.current, dict):
        state.current = dict(state.current)

    # Store the real device id inside the state payload for admin display
    if raw_device_id:
        state.current["device_id"] = raw_device_id

    # Ensure operator_id is inside the state object (PIN as ID, not for display)
    if user_id is not None:
        state.current["operator_id"] = user_id
    elif operator_id is not None:
        state.current["operator_id"] = operator_id

    # Calculate Live Rate on backend (based on closed picks only)
    if state.current and state.startTime:
        try:
            total_units = sum(p.get("units", 0) for p in state.picks)

            now = datetime.now()
            start_parts = state.startTime.split(":")
            if len(start_parts) == 2:
                start_dt = now.replace(
                    hour=int(start_parts[0]),
                    minute=int(start_parts[1]),
                    second=0,
                    microsecond=0,
                )

                # Handle crossing midnight
                if start_dt > now:
                    start_dt -= timedelta(days=1)

                elapsed_hours = (now - start_dt).total_seconds() / 3600.0

                if elapsed_hours > 0.05:
                    calculated_rate = int(total_units / elapsed_hours)
                    state.current["liveRate"] = calculated_rate
        except Exception:
            # If date parsing fails, just ignore rate calc
            pass

    # Save to DB
    save_main(state, device_id=target_id)

    # Logging
    detail: Dict[str, Any] = {"version": state.version}
    if target_id:
        detail["storage_key"] = target_id

    if user_id:
        detail["logged_in_user"] = user_id
    elif operator_id is not None:
        detail["operator_id"] = operator_id

    if device_id:
        detail["device_id"] = device_id

    # The Admin Panel looks for 'current_name'
    # Prefer human-friendly operator name/role, then order name.
    # Never show the raw PIN here.
    if state.current and isinstance(state.current, dict):
        op_name = state.current.get("operator_name")
        op_role = state.current.get("operator_role")
        order_name = state.current.get("name")

        if op_name:
            detail["current_name"] = op_name
        elif op_role:
            detail["current_name"] = op_role
        elif order_name:
            detail["current_name"] = order_name

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
    return {"days": days, "series": get_usage_summary(days=days)}


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
# Admin Message API
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
    device_id: str = Query(..., alias="device-id"),
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
# Auth API
# -------------------------------------------------------------------
class AuthPayload(BaseModel):
    username: str
    pin: str
    full_name: Optional[str] = None  # comes from login.js register flow
    role: Optional[str] = None


@app.post("/api/auth/register")
async def api_register(payload: AuthPayload) -> Dict[str, Any]:
    # Basic validation
    if len(payload.pin) < 4:
        return {"success": False, "message": "PIN must be 4 digits"}

    clean_user = payload.username.strip()
    # Prefer provided full_name, else fall back to username
    full_name = (payload.full_name or "").strip() or clean_user
    # Normalise role, default to 'picker'
    role = (payload.role or "picker").strip() or "picker"

    created = create_user(
        username=clean_user,
        pin=payload.pin,
        display_name=full_name,
        role=role,
    )
    if not created:
        return {"success": False, "message": "Username taken"}

    user = get_user(clean_user)
    if not user:
        return {"success": False, "message": "User created but not found"}

    return {
        "success": True,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
    }


@app.post("/api/auth/login")
async def api_login(payload: AuthPayload) -> Dict[str, Any]:
    clean_user = payload.username.strip()
    valid = verify_user(clean_user, payload.pin)
    if not valid:
        return {"success": False, "message": "Invalid username or PIN"}

    user = get_user(clean_user)
    if not user:
        return {"success": False, "message": "User record missing"}

    return {
        "success": True,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
    }


# -------------------------------------------------------------------
# Unified PIN Login
# -------------------------------------------------------------------
class PinLoginPayload(BaseModel):
    pin_code: str
    device_id: Optional[str] = None

# Role access payload for overlay modal
class RoleAccessPayload(BaseModel):
    role: str          # "operative" or "supervisor"
    pin_code: str
    pin_code: str
    device_id: Optional[str] = None

@app.post("/auth/login_pin")
async def auth_login_pin(payload: PinLoginPayload) -> Dict[str, Any]:
    @app.post("/auth/role_access")
    async def auth_role_access(payload: RoleAccessPayload) -> Dict[str, Any]:
        """
        Secondary role overlay for the History tab 'Request role access' modal.

        - Does NOT change the primary logged-in picker.
        - Only checks that there is an existing Neon user whose role matches
          the requested role and whose PIN matches the given PIN.
        - Returns a small JSON blob the frontend can use to confirm access.
        """

        from fastapi import HTTPException

        role = payload.role.strip().lower()
        pin = payload.pin_code.strip()

        # Only allow known overlay roles
        if role not in {"operative", "supervisor"}:
            raise HTTPException(status_code=400, detail="Invalid role")

        user = get_user(pin)
        if not user or user.role.strip().lower() != role:
            # Don't leak which part was wrong
            raise HTTPException(status_code=401, detail="Invalid PIN or role")

        return {
            "ok": True,
            "user_id": str(user.id),
            "display_name": user.display_name or user.username,
            "role": user.role,
        }
    """
    Unified identity entrypoint for the app.
    - Uses PIN as username.
    - Only logs in existing users that match the PIN.
    - Returns display_name and role from the DB.
    """
    pin = payload.pin_code.strip()
    if not pin:
        return {"success": False, "message": "PIN required"}

    mode = getattr(payload, "mode", None) or "primary"
    requested_role = getattr(payload, "requested_role", None)

    username = pin
    valid = verify_user(username, pin)
    if not valid:
        return {
            "success": False,
            "message": "Unknown or invalid code. Please create user first.",
        }

    user = get_user(username)
    if not user:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Access denied")

    if mode == "overlay":
        from fastapi import HTTPException
        # Permission rules
        if requested_role == "operative":
            if user.role not in ["operative", "supervisor"]:
                raise HTTPException(status_code=403, detail="Access denied")
        elif requested_role == "supervisor":
            if user.role != "supervisor":
                raise HTTPException(status_code=403, detail="Access denied")
        else:
            raise HTTPException(status_code=403, detail="Access denied")
        # Do NOT log in primary user, do NOT create session
        return {
            "user_id": user.username,
            "display_name": user.display_name or user.username,
            "role": requested_role,
            "mode": "overlay"
        }

    # Primary mode (default) stays as-is
    return {
        "success": True,
        "user_id": user.username,
        "display_name": user.display_name or user.username,
        "role": user.role or "picker",
        "token": None,
    }


# -------------------------------------------------------------------
# Orders API – record closed-order summaries
# -------------------------------------------------------------------
class OrderRecordPayload(BaseModel):
    operator_id: str
    operator_name: Optional[str] = None
    device_id: Optional[str] = None
    order: Dict[str, Any]
    notes: Optional[str] = None


@app.post("/api/orders/record")
async def api_orders_record(payload: OrderRecordPayload) -> Dict[str, Any]:
    """
    Record a CLOSED order into the orders summary table.

    The frontend calls this once when an order is closed, passing the same
    object it pushes into main.picks[] as `order`.
    """
    record_order_from_payload(
        operator_id=payload.operator_id,
        device_id=payload.device_id,
        order_payload=payload.order,
        operator_name=payload.operator_name,
        notes=payload.notes,
    )

    # Optional: log a lightweight usage event for admin analytics
    detail: Dict[str, Any] = {
        "operator_id": payload.operator_id,
        "operator_name": payload.operator_name,
        "device_id": payload.device_id,
        "order_name": payload.order.get("name"),
        "units": payload.order.get("units"),
    }
    log_usage_event("ORDER_RECORDED", detail)

    return {"status": "ok"}
