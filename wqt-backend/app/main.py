import os
import uuid
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Query, HTTPException, Depends, status, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from fastapi.responses import JSONResponse

from .models import MainState
import json

# -------------------------------------------------------------------
# CORS
# -------------------------------------------------------------------

import logging
VERSION = os.getenv("WQT_VERSION", "dev")
CURRENT_ONBOARDING_VERSION = 1
app = FastAPI(title="WQT Backend v1")

# --- Route inventory logging (AUDIT_ROUTES=1) ---
if os.getenv("AUDIT_ROUTES", "0") == "1":
    @app.on_event("startup")
    async def log_routes():
        print("[AUDIT] Route inventory:")
        for route in app.routes:
            methods = ','.join(sorted(route.methods))
            print(f"  {methods:10s} {route.path}")

# --- 404 logging middleware ---
@app.middleware("http")
async def log_404_middleware(request, call_next):
    response = await call_next(request)
    if response.status_code == 404:
        logging.warning(f"404 Not Found: {request.method} {request.url.path}")
    return response

# --- Root endpoint (GET /, HEAD /) ---
@app.get("/")
async def root():
    return {"service": "wqt-backend", "status": "ok", "version": VERSION}

@app.head("/")
async def root_head():
    return {"service": "wqt-backend", "status": "ok", "version": VERSION}

def get_shift_state_with_version(shift_id):
    # Fetch shift session and return state_version and active_order_snapshot
    from .db import get_session, ShiftSession
    db = get_session()
    shift = db.query(ShiftSession).filter(ShiftSession.id == shift_id).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    return {
        "state_version": shift.state_version,
        "active_order_snapshot": json.loads(shift.active_order_snapshot or '{}'),
        "shift_id": shift.id
    }

@app.patch("/api/shift/{shift_id}/state")
async def patch_shift_state(shift_id: int, payload: Dict[str, Any], base_version: int = None, explicit_clear_active_order: bool = False, request_id: str = None, device_id: str = None):
    from .db import get_session, ShiftSession
    db = get_session()
    shift = db.query(ShiftSession).filter(ShiftSession.id == shift_id).first()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    # Version check
    if base_version is not None and base_version != shift.state_version:
        # Log conflict
        print(f"[PATCH CONFLICT] request_id={request_id} device_id={device_id} shift_id={shift_id} base_version={base_version} current_version={shift.state_version}")
        return JSONResponse(status_code=409, content={"detail": "Version conflict", "server_state": get_shift_state_with_version(shift_id)})
    # Defensive clear guard
    incoming_order = payload.get("active_order_snapshot")
    if (shift.active_order_snapshot and not incoming_order) and not explicit_clear_active_order:
        # Log blocked clear
        print(f"[PATCH BLOCKED CLEAR] request_id={request_id} device_id={device_id} shift_id={shift_id} - attempted clear without explicit flag")
        return JSONResponse(status_code=409, content={"detail": "Blocked destructive clear", "server_state": get_shift_state_with_version(shift_id)})
    # Apply patch
    if incoming_order is not None:
        shift.active_order_snapshot = json.dumps(incoming_order)
    # ...apply other fields as needed...
    shift.state_version += 1
    db.commit()
    return {"ok": True, "state_version": shift.state_version}
from .storage import load_main, save_main
from .db import (
    init_db,
    log_usage_event,
    get_recent_usage,
    get_usage_summary,
    start_shift,
    end_shift,
    get_active_shift_for_operator,
    get_recent_shifts,
    get_all_device_states,
    send_admin_message,
    pop_admin_messages,
    create_user,
    verify_user,
    get_user,  # NEW
    get_user_by_id,
    record_order_from_payload,  # NEW: orders table integration
    get_history_for_operator,   # NEW: fetch archived orders for frontend
    load_device_state,          # NEW: legacy fallback
    save_device_state,          # NEW: migrate to user key
    User,
    bulk_upsert_locations,
    get_warehouse_aisle_summary,
    get_locations_by_aisle,
    get_warehouse_map_from_locations,
    set_location_empty_state,
    get_bay_occupancy,
    apply_bay_occupancy_changes,
    get_session,
    WarehouseLocation,
)

# -------------------------------------------------------------------
# Auth configuration
# -------------------------------------------------------------------
from dotenv import load_dotenv
load_dotenv()

try:
    JWT_SECRET = os.environ["JWT_SECRET_KEY"]
except KeyError:
    raise ValueError("JWT_SECRET_KEY environment variable is required for JWT signing.")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))
ALLOWED_ROLES = {"picker", "operative", "supervisor", "gm"}

security = HTTPBearer(auto_error=False)


class TokenPayload(BaseModel):
    sub: str
    username: str
    role: str
    exp: int


class MeUpdatePayload(BaseModel):
    default_shift_hours: int


def create_access_token(user: User) -> str:
    expire = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "exp": expire,
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        token_data = TokenPayload(**payload)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    user: Optional[User] = None
    # Prefer numeric id from `sub`
    if token_data.sub.isdigit():
        user = get_user_by_id(int(token_data.sub))

    if user is None:
        user = get_user(token_data.username)

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    print(f"AUTH_DEBUG: current_user.id={user.id} username={user.username} role={user.role}")
    return user


# -------------------------------------------------------------------
# Current user profile (onboarding)
# -------------------------------------------------------------------
@app.get("/api/me")
async def api_me(
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    return {
        "username": current_user.username,
        "operator_id": current_user.username,
        "role": current_user.role,
        "default_shift_hours": current_user.default_shift_hours,
        "onboarding_version": current_user.onboarding_version,
        "onboarding_completed_at": (
            current_user.onboarding_completed_at.isoformat()
            if current_user.onboarding_completed_at
            else None
        ),
    }


@app.patch("/api/me")
async def api_me_update(
    payload: MeUpdatePayload,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    if payload.default_shift_hours not in (9, 10):
        raise HTTPException(status_code=400, detail="default_shift_hours must be 9 or 10")
    session = get_session()
    try:
        user = session.get(User, current_user.id)
        if user is None:
            user = session.query(User).filter(User.username == current_user.username).first()
        if user is None:
            raise HTTPException(status_code=404, detail="User not found")
        user.default_shift_hours = payload.default_shift_hours
        user.onboarding_version = CURRENT_ONBOARDING_VERSION
        user.onboarding_completed_at = datetime.now(timezone.utc)
        session.commit()
        logging.info(
            "[OnboardingUpdate] user=%s default_shift_hours=%s onboarding_version=%s",
            user.username,
            user.default_shift_hours,
            user.onboarding_version,
        )
        return {
            "username": user.username,
            "operator_id": user.username,
            "role": user.role,
            "default_shift_hours": user.default_shift_hours,
            "onboarding_version": user.onboarding_version,
            "onboarding_completed_at": (
                user.onboarding_completed_at.isoformat()
                if user.onboarding_completed_at
                else None
            ),
        }
    finally:
        session.close()


# -------------------------------------------------------------------
# Admin logging helpers
# -------------------------------------------------------------------
def _safe_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except Exception:
        return None


def _trim_text(value: str, limit: int = 200) -> str:
    if not value:
        return ""
    return value if len(value) <= limit else value[: limit - 3] + "..."


def _get_wrap_progress(state: MainState, current: Dict[str, Any]) -> Dict[str, Optional[int]]:
    wraps = []
    for candidate in (state.tempWraps, current.get("wraps"), (current.get("log") or {}).get("wraps")):
        if candidate:
            wraps = candidate
            break

    latest = wraps[-1] if wraps else None

    units_done = _safe_int(current.get("done"))
    units_left = _safe_int(current.get("left"))
    units_total = _safe_int(current.get("total") or current.get("units"))

    if isinstance(latest, dict):
        units_done = _safe_int(latest.get("done")) or units_done
        units_left = _safe_int(latest.get("left")) or units_left
        units_total = _safe_int(latest.get("total")) or units_total

    if units_total is not None and units_done is not None and units_left is None:
        units_left = max(units_total - units_done, 0)

    return {"done": units_done, "left": units_left, "total": units_total}


def summarize_state_save(state: MainState) -> Dict[str, Any]:
    """
    Build a concise, human-friendly summary for STATE_SAVE events so the
    admin log shows what changed instead of a generic "Save State" entry.
    """

    current: Dict[str, Any] = state.current or {}
    summary_label = "state_snapshot"
    parts: List[str] = []

    operator_display = current.get("operator_name") or current.get("operator_role")
    operator_id = current.get("operator_id")
    if operator_display:
        parts.append(f"user={operator_display}")
    elif operator_id:
        parts.append(f"user_id={operator_id}")

    order_name: Optional[str] = None
    progress = _get_wrap_progress(state, current)
    locations = _safe_int(current.get("locations") or (current.get("log") or {}).get("locations"))

    active_break = current.get("active_break")
    if isinstance(active_break, dict):
        summary_label = "shift_break"
        label = "lunch" if active_break.get("type") == "L" else "break"
        break_bits = [f"type={label}"]
        if active_break.get("startHHMM"):
            break_bits.append(f"start={active_break.get('startHHMM')}")
        target_sec = _safe_int(active_break.get("targetSec"))
        if target_sec:
            break_bits.append(f"target={int(target_sec / 60)}m")
        parts.append(", ".join(break_bits))
    elif current.get("name") or progress["total"] is not None or progress["done"] is not None:
        summary_label = "order_update"
        order_name = current.get("name") or current.get("order_name") or "order"
        order_bits = [f"order={order_name}"]
        if progress["done"] is not None and progress["total"] is not None:
            order_bits.append(f"units={progress['done']}/{progress['total']}")
        elif progress["done"] is not None:
            order_bits.append(f"units_done={progress['done']}")
        if progress["left"] is not None:
            order_bits.append(f"left={progress['left']}")
        if locations is not None:
            order_bits.append(f"locations={locations}")
        if current.get("shared"):
            order_bits.append("shared=true")
        parts.append(", ".join(order_bits))
    elif state.picks:
        summary_label = "recent_pick"
        last_pick = state.picks[-1] or {}
        order_name = last_pick.get("name") or last_pick.get("order_name") or "pick"
        pick_bits = [f"order={order_name}"]
        pick_units = _safe_int(last_pick.get("units") or last_pick.get("total"))
        pick_locations = _safe_int(last_pick.get("locations"))
        if pick_units is not None:
            pick_bits.append(f"units={pick_units}")
        if pick_locations is not None:
            pick_bits.append(f"locations={pick_locations}")
        parts.append(", ".join(pick_bits))
    elif state.startTime:
        summary_label = "shift_state"
        shift_bits = [f"start={state.startTime}"]
        if state.history:
            shift_bits.append(f"history_days={len(state.history)}")
        parts.append(", ".join(shift_bits))

    summary_text = f"{summary_label}: " + "; ".join(parts) if parts else summary_label

    return {
        "summary": _trim_text(summary_text, 200),
        "summary_type": summary_label,
        "summary_parts": parts[:4],
        "operator_name": operator_display,
        "operator_id": operator_id,
        "order_name": order_name,
        "units_done": progress.get("done"),
        "units_total": progress.get("total"),
        "units_left": progress.get("left"),
        "locations": locations,
        "start_time": state.startTime or None,
        "saved_at": state.savedAt or None,
    }

# -------------------------------------------------------------------
# CORS
# -------------------------------------------------------------------
# Secure CORS configuration
allowed_origins_env = os.getenv("ALLOWED_ORIGINS")
if not allowed_origins_env:
    raise ValueError("ALLOWED_ORIGINS environment variable is required for CORS policy.")
allowed_origins = [origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()]
if not allowed_origins:
    raise ValueError("ALLOWED_ORIGINS must specify at least one allowed origin.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _cors_headers_for_origin(origin: Optional[str]) -> Dict[str, str]:
    if origin and origin in allowed_origins:
        return {
            "access-control-allow-origin": origin,
            "access-control-allow-credentials": "true",
            "vary": "Origin",
        }
    return {}

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    headers = dict(exc.headers or {})
    headers.update(_cors_headers_for_origin(request.headers.get("origin")))
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=headers)

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logging.exception("Unhandled exception", exc_info=exc)
    headers = _cors_headers_for_origin(request.headers.get("origin"))
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"}, headers=headers)


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
    current_user: User = Depends(get_current_user),
) -> MainState:
    """
    Load MainState.

    Priority:
      1) Per-user state: device_states.device_id = "user:<PIN>"
      2) Legacy per-device state (device_states.device_id = "<device uuid>"),
         migrated into the user key when found.
      3) Global / legacy fallback from storage.load_main().
    """
    # Build key strictly from authenticated user; do NOT migrate device state into new users
    primary_key: Optional[str] = f"user:{current_user.username}" if current_user else None

    raw: Optional[dict] = None

    print(f"AUTH_DEBUG: current_user.id={current_user.username} requesting state")

    # Only load per-user payload; avoid legacy device migration to prevent cross-user bleed
    if primary_key:
        raw = load_device_state(primary_key)

    if raw is not None:
        return MainState(**raw)

    # Fresh user: return an empty state (no history bleed)
    return MainState(version="3.3.55")

@app.post("/api/state", response_model=MainState)
async def set_state(
    state: MainState,
    device_id: Optional[str] = Query(default=None, alias="device-id"),
    current_user: User = Depends(get_current_user),
) -> MainState:
    """
    Save MainState.
    Includes fixes for User ID persistence and Live Rate calculation.
    """

    # 1) Determine storage key (User > Device) and capture raw device for display
    raw_device_id = device_id
    target_id = f"user:{current_user.username}" if current_user else device_id

    # Ensure current dict exists
    if state.current is None:
        state.current = {}
    elif not isinstance(state.current, dict):
        state.current = dict(state.current)

    # Store the real device id inside the state payload for admin display
    if raw_device_id:
        state.current["device_id"] = raw_device_id

    # Ensure operator_id is inside the state object (PIN as ID, not for display)
    if current_user is not None:
        state.current["operator_id"] = current_user.username

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

    if current_user:
        detail["logged_in_user"] = current_user.username

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

    # Provide a concise summary string for the admin log
    detail.update(summarize_state_save(state))

    log_usage_event("STATE_SAVE", detail)

    print(f"HISTORY_DEBUG: state save for user_id={current_user.username} device_id={device_id}")

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
    start_hhmm: Optional[str] = None
    shift_length_hours: Optional[float] = None


class ShiftEndPayload(BaseModel):
    shift_id: Optional[int] = None
    total_units: Optional[int] = None
    avg_rate: Optional[float] = None
    summary: Optional[Dict[str, Any]] = None
    end_time: Optional[str] = None


@app.post("/api/shifts/start")
async def api_shift_start(
    payload: ShiftStartPayload,
    device_id: Optional[str] = Query(default=None, alias="device-id"),
    current_user: User = Depends(get_current_user),
    request: Request = None,
) -> Dict[str, Any]:
    request_id = uuid.uuid4().hex
    # Force authenticated identity for all shift writes
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")

    logging.info(
        "[ShiftStart] request_id=%s user=%s device_id=%s start_hhmm=%s shift_length_hours=%s",
        request_id,
        getattr(current_user, "username", None),
        device_id,
        payload.start_hhmm,
        payload.shift_length_hours,
    )

    try:
        shift_id = start_shift(
            operator_id=current_user.username,
            device_id=device_id,
            operator_name=payload.operator_name or current_user.display_name,
            site=payload.site,
            shift_type=payload.shift_type,
        )

        active_shift = get_active_shift_for_operator(current_user.username)

        detail: Dict[str, Any] = {
            "shift_id": shift_id,
            "operator_id": current_user.username,
            "operator_name": payload.operator_name,
            "site": payload.site,
            "shift_type": payload.shift_type,
            "start_hhmm": payload.start_hhmm,
            "shift_length_hours": payload.shift_length_hours,
            "already_active": bool(active_shift and active_shift.get("ended_at") is None and active_shift.get("id") == shift_id),
        }
        if device_id:
            detail["device_id"] = device_id

        log_usage_event("SHIFT_START", detail)

        log_usage_event("SHIFT_DEBUG_WRITE", {
            "operator_id": current_user.username,
            "device_id": device_id,
            "note": "Shift start bound to authenticated user",
        })

        return {"shift_id": shift_id, "shift": active_shift}
    except Exception as exc:
        logging.exception(
            "[ShiftStart] request_id=%s device_id=%s user=%s",
            request_id,
            device_id,
            getattr(current_user, "username", None),
            exc_info=exc,
        )
        headers = {
            "X-Request-ID": request_id,
            **_cors_headers_for_origin(request.headers.get("origin") if request else None),
        }
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Internal Server Error",
                "request_id": request_id,
                "error": "shift_start_failed",
            },
            headers=headers,
        )


@app.get("/api/shifts/active")
async def api_shift_active(
    device_id: Optional[str] = Query(default=None, alias="device-id"),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")

    try:
        active_shift = get_active_shift_for_operator(current_user.username)
    except Exception as exc:
        logging.exception("[ShiftActive] Failed to fetch active shift", exc_info=exc)
        return {
            "active": False,
            "shift": None,
            "device_id": device_id,
            "error": "shift_active_failed",
        }
    return {
        "active": bool(active_shift),
        "shift": active_shift,
        "device_id": device_id,
    }


@app.post("/api/shifts/end")
async def api_shift_end(
    payload: ShiftEndPayload,
    device_id: Optional[str] = Query(default=None, alias="device-id"),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")

    parsed_end = None
    if payload.end_time:
        try:
            parsed_end = datetime.fromisoformat(payload.end_time)
        except Exception:
            parsed_end = None

    try:
        closed_shift = end_shift(
            operator_id=current_user.username,
            shift_id=payload.shift_id,
            total_units=payload.total_units,
            avg_rate=payload.avg_rate,
            summary=payload.summary,
            ended_at=parsed_end,
        )
    except ValueError as exc:
        log_usage_event(
            "SHIFT_END_ERROR",
            {
                "shift_id": payload.shift_id,
                "operator_id": current_user.username,
                "device_id": device_id,
                "error": str(exc),
            },
        )
        raise HTTPException(status_code=404, detail=str(exc))

    detail: Dict[str, Any] = {
        "shift_id": closed_shift.get("id"),
        "total_units": payload.total_units,
        "avg_rate": payload.avg_rate,
        "operator_id": current_user.username,
    }
    if device_id:
        detail["device_id"] = device_id

    log_usage_event("SHIFT_END", {**detail, "ended_at": closed_shift.get("ended_at")})

    return {"status": "ok", "shift": closed_shift}


@app.get("/api/shifts/recent")
async def api_shifts_recent(
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")
    return get_recent_shifts(limit=limit, operator_id=current_user.username)


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
    if len(payload.pin) < 4 or len(payload.pin) > 32:
        return {"success": False, "message": "PIN must be between 4 and 32 characters"}

    clean_user = payload.username.strip()
    # Prefer provided full_name, else fall back to username
    full_name = (payload.full_name or "").strip() or clean_user
    # Normalise role, default to 'picker'
    role = (payload.role or "picker").strip().lower() or "picker"
    if role not in ALLOWED_ROLES:
        return {"success": False, "message": "Invalid role"}

    created, reason = create_user(
        username=clean_user,
        pin=payload.pin,
        display_name=full_name,
        role=role,
    )
    if not created:
        if reason == "db_not_initialised":
            raise HTTPException(status_code=500, detail="Database not initialised")
        if reason == "username_exists":
            return {"success": False, "message": "Username taken"}
        return {"success": False, "message": "Failed to create user"}

    user = get_user(clean_user)
    if not user:
        return {"success": False, "message": "User created but not found"}

    token = create_access_token(user)
    log_usage_event("AUTH_DEBUG_LOGIN", {
        "user_id": user.id,
        "username": user.username,
        "role": user.role,
        "event": "register",
    })

    return {
        "success": True,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "token": token,
        "user_id": user.username,
    }


@app.post("/api/auth/login")
async def api_login(payload: AuthPayload) -> Dict[str, Any]:
    clean_user = payload.username.strip()
    if len(payload.pin) < 4 or len(payload.pin) > 32:
        return {"success": False, "message": "Invalid PIN"}
    valid = verify_user(clean_user, payload.pin)
    if not valid:
        return {"success": False, "message": "Invalid username or PIN"}

    user = get_user(clean_user)
    if not user:
        return {"success": False, "message": "User record missing"}

    token = create_access_token(user)
    log_usage_event("AUTH_DEBUG_LOGIN", {
        "user_id": user.id,
        "username": user.username,
        "role": user.role,
        "event": "login",
    })

    return {
        "success": True,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
        "token": token,
        "user_id": user.username,
    }


# -------------------------------------------------------------------
# Unified PIN Login
# -------------------------------------------------------------------
class PinLoginPayload(BaseModel):
    pin_code: str
    device_id: Optional[str] = None

class RoleAccessPayload(BaseModel):
    role: str          # "operative" or "supervisor"
    pin_code: str
    device_id: Optional[str] = None


@app.post("/auth/role_access")
async def auth_role_access(payload: RoleAccessPayload) -> Dict[str, Any]:
    """
    Secondary role overlay for the History tab 'Request role access' modal.

    - Does NOT change the primary logged-in picker.
    - Only checks that there is an existing user whose role matches
      the requested role and whose PIN matches the given PIN.
    - Returns a small JSON blob the frontend can use to confirm access.
    """
    role = payload.role.strip().lower()
    pin = payload.pin_code.strip()

    if role not in {"operative", "supervisor"}:
        raise HTTPException(status_code=400, detail="Invalid role")

    # Overlay flow uses PIN == username for lookup
    user = get_user(pin)
    if not user or user.role.strip().lower() != role or not verify_user(user.username, pin):
        raise HTTPException(status_code=401, detail="Invalid PIN or role")

    return {
        "ok": True,
        "user_id": str(user.id),
        "display_name": user.display_name or user.username,
        "role": user.role,
    }


@app.post("/auth/login_pin")
async def auth_login_pin(payload: PinLoginPayload) -> Dict[str, Any]:
    """Unified PIN-based login. Returns a signed bearer token on success."""
    pin = payload.pin_code.strip()
    if not pin:
        return {"success": False, "message": "PIN required"}
    if len(pin) < 4 or len(pin) > 32:
        return {"success": False, "message": "PIN must be between 4 and 32 characters"}

    username = pin
    valid = verify_user(username, pin)
    if not valid:
        return {
            "success": False,
            "message": "Unknown or invalid code. Please create user first.",
        }

    user = get_user(username)
    if not user:
        raise HTTPException(status_code=403, detail="Access denied")

    token = create_access_token(user)
    log_usage_event("AUTH_DEBUG_LOGIN", {
        "user_id": user.id,
        "username": user.username,
        "role": user.role,
        "event": "login_pin",
    })

    return {
        "success": True,
        "user_id": user.username,
        "display_name": user.display_name or user.username,
        "role": user.role or "picker",
        "token": token,
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


class WarehouseLocationItem(BaseModel):
    aisle: str
    bay: int
    layer: int
    spot: str
    code: str


class WarehouseLocationBulkPayload(BaseModel):
    warehouse: str
    row_id: str
    locations: List[WarehouseLocationItem]


class WarehouseAisleSummaryResponse(BaseModel):
    aisle: str
    total: int
    occupied: int
    empty: int


class WarehouseLocationTogglePayload(BaseModel):
    id: Optional[int] = None
    code: Optional[str] = None
    is_empty: bool


class WarehouseLocationToggleByCodePayload(BaseModel):
    code: str


class BayOccupancyChange(BaseModel):
    warehouse: str
    row_id: str
    aisle: str
    bay: int
    layer: int
    delta_euro: int = 0
    delta_uk: int = 0
    event_id: Optional[str] = None


class BayOccupancyApplyPayload(BaseModel):
    device_id: Optional[str] = None
    changes: List[BayOccupancyChange]


@app.post("/api/orders/record")
async def api_orders_record(
    payload: OrderRecordPayload,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Record a CLOSED order into the orders summary table.

    The frontend calls this once when an order is closed, passing the same
    object it pushes into main.picks[] as `order`.
    """
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")

    record_order_from_payload(
        operator_id=current_user.username,
        device_id=payload.device_id,
        order_payload=payload.order,
        operator_name=payload.operator_name or current_user.display_name,
        notes=payload.notes,
    )

    # Optional: log a lightweight usage event for admin analytics
    detail: Dict[str, Any] = {
        "operator_id": current_user.username,
        "operator_name": payload.operator_name,
        "device_id": payload.device_id,
        "order_name": payload.order.get("name"),
        "units": payload.order.get("units"),
    }
    log_usage_event("HISTORY_DEBUG_ORDER_WRITE", {
        **detail,
        "note": "Orders recorded via authenticated user header",
    })
    log_usage_event("ORDER_RECORDED", detail)

    return {"status": "ok"}


@app.get("/api/history/operator/{operator_id}")
async def api_history_operator(
    operator_id: str,
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Fetch archived/completed orders for a given operator (PIN).

    Returns a list of orders with fields matching the frontend's History table expectations:
      - id: order record ID
      - customer: order name
      - units: total units completed
      - locations: number of locations
      - pallets: number of pallets (if applicable)
      - startTime: ISO datetime string
      - closeTime: ISO datetime string
      - orderRate: units/hour (float)

    This allows the frontend to render the History (daily archives) table
    using the same order structure as the live Completed Orders table.
    """
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")

    if operator_id and operator_id != current_user.username:
        log_usage_event("HISTORY_MISMATCH", {
            "path_operator_id": operator_id,
            "header_user_id": current_user.username,
            "note": "Path ignored; using authenticated user id",
        })

    orders = get_history_for_operator(current_user.username, limit=limit)
    rows = len(orders)
    print(f"HISTORY_DEBUG: current_user.id={current_user.username} rows={rows}")
    return {
        "status": "ok",
        "orders": orders,
        "count": rows,
    }


@app.get("/api/history/me")
async def api_history_me(
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    return await api_history_operator(operator_id=current_user.username, limit=limit, current_user=current_user)


# -------------------------------------------------------------------
# Warehouse Map API (shared state)
# -------------------------------------------------------------------
@app.get("/api/warehouse-map")
async def api_get_warehouse_map(
    warehouse: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    warehouse_id = str(warehouse or "").strip()
    if not warehouse_id:
        warehouse_id = "WH3"

    canonical_map = get_warehouse_map_from_locations(warehouse_id)
    if isinstance(canonical_map, dict) and canonical_map.get("aisles"):
        return {"success": True, "map": canonical_map}
    return {"success": True, "map": {"aisles": {}}}


@app.get("/api/bay-occupancy")
async def api_get_bay_occupancy(
    warehouse: str = Query(...),
    aisle: Optional[str] = None,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")
    rows = get_bay_occupancy(warehouse=warehouse, aisle=aisle)
    return {"success": True, "rows": rows}


@app.post("/api/bay-occupancy/apply")
async def api_apply_bay_occupancy(
    payload: BayOccupancyApplyPayload,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")
    changes = [c.dict() for c in payload.changes or []]
    results = apply_bay_occupancy_changes(device_id=payload.device_id, changes=changes)
    return {"success": True, "results": results}


@app.post("/api/warehouse-locations/bulk")
async def api_warehouse_locations_bulk(
    payload: WarehouseLocationBulkPayload,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")

    try:
        inserted = bulk_upsert_locations(
            warehouse=payload.warehouse.strip(),
            row_id=payload.row_id.strip(),
            locations=[loc.dict() for loc in payload.locations or []],
            operator_id=current_user.username,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to persist warehouse locations") from exc

    return {"success": True, "inserted": inserted}


@app.get("/api/warehouse-locations/summary")
async def api_warehouse_locations_summary(
    warehouse: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")

    aisles = get_warehouse_aisle_summary(warehouse.strip())
    return {"success": True, "aisles": aisles}


@app.get("/api/warehouse-locations/by-aisle")
async def api_warehouse_locations_by_aisle(
    warehouse: str = Query(..., min_length=1),
    aisle: str = Query(..., min_length=1),
    only_empty: bool = Query(True),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")

    locations = get_locations_by_aisle(
        warehouse=warehouse.strip(),
        aisle=aisle.strip(),
        only_empty=only_empty,
    )

    return {"success": True, "locations": locations}


@app.post("/api/warehouse-locations/set-empty")
async def api_warehouse_locations_set_empty(
    payload: WarehouseLocationTogglePayload,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")

    if payload.id is None and (payload.code is None or not payload.code.strip()):
        raise HTTPException(status_code=400, detail="Provide a location id or code")

    try:
        updated = set_location_empty_state(
            location_id=payload.id,
            code=payload.code.strip() if payload.code else None,
            is_empty=payload.is_empty,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to update location") from exc

    if not updated:
        raise HTTPException(status_code=404, detail="Location not found")

    return {"success": True, "is_empty": payload.is_empty}


@app.post("/api/warehouse-locations/toggle-empty")
async def api_warehouse_locations_toggle_empty(
    payload: WarehouseLocationToggleByCodePayload,
    current_user: User = Depends(get_current_user),
) -> Any:
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")

    session = get_session()
    try:
        code = payload.code.strip()
        loc = (
            session.query(WarehouseLocation)
            .filter(WarehouseLocation.code == code)
            .first()
        )

        if not loc:
            return JSONResponse(status_code=404, content={"success": False, "message": "Location not found"})

        loc.is_empty = not bool(loc.is_empty)
        session.commit()

        return {
            "success": True,
            "is_empty": loc.is_empty,
            "aisle": loc.aisle,
        }
    finally:
        session.close()
