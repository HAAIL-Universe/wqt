import os
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta

from fastapi import FastAPI, Query, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

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
    get_user_by_id,
    record_order_from_payload,  # NEW: orders table integration
    get_history_for_operator,   # NEW: fetch archived orders for frontend
    load_device_state,          # NEW: legacy fallback
    save_device_state,          # NEW: migrate to user key
    load_global_state,
    save_global_state,
    User,
    bulk_upsert_locations,
)

app = FastAPI(title="WQT Backend v1")

# -------------------------------------------------------------------
# Auth configuration
# -------------------------------------------------------------------
JWT_SECRET = os.getenv("JWT_SECRET") or os.getenv("AUTH_SECRET") or "dev-change-me"
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))
ALLOWED_ROLES = {"picker", "operative", "supervisor", "gm"}

security = HTTPBearer(auto_error=False)


class TokenPayload(BaseModel):
    sub: str
    username: str
    role: str
    exp: int


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


class ShiftEndPayload(BaseModel):
    shift_id: int
    total_units: Optional[int] = None
    avg_rate: Optional[float] = None


@app.post("/api/shifts/start")
async def api_shift_start(
    payload: ShiftStartPayload,
    device_id: Optional[str] = Query(default=None, alias="device-id"),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    # Force authenticated identity for all shift writes
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")

    shift_id = start_shift(
        operator_id=current_user.username,
        device_id=device_id,
        operator_name=payload.operator_name or current_user.display_name,
        site=payload.site,
        shift_type=payload.shift_type,
    )

    detail: Dict[str, Any] = {
        "shift_id": shift_id,
        "operator_id": current_user.username,
        "operator_name": payload.operator_name,
        "site": payload.site,
        "shift_type": payload.shift_type,
    }
    if device_id:
        detail["device_id"] = device_id

    log_usage_event("SHIFT_START", detail)

    log_usage_event("SHIFT_DEBUG_WRITE", {
        "operator_id": current_user.username,
        "device_id": device_id,
        "note": "Shift start bound to authenticated user",
    })

    return {"shift_id": shift_id}


@app.post("/api/shifts/end")
async def api_shift_end(
    payload: ShiftEndPayload,
    device_id: Optional[str] = Query(default=None, alias="device-id"),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    if not current_user:
        raise HTTPException(status_code=401, detail="Missing user identity")

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


class WarehouseMapPayload(BaseModel):
    map: Dict[str, Any]


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
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    payload = load_global_state() or {}
    existing_map = payload.get("warehouse_map") if isinstance(payload, dict) else None
    if not isinstance(existing_map, dict):
        existing_map = {"aisles": {}}

    return {"success": True, "map": existing_map}


@app.post("/api/warehouse-map")
async def api_set_warehouse_map(
    data: WarehouseMapPayload,
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    payload: Dict[str, Any] = load_global_state() or {}
    if not isinstance(payload, dict):
        payload = {}

    payload["warehouse_map"] = data.map
    save_global_state(payload)

    return {"success": True, "map": payload["warehouse_map"]}


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
