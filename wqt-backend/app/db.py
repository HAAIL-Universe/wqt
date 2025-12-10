import os
import json
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

from passlib.context import CryptContext

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    Text,
    DateTime,
    Float,
    func,
    Boolean,
    ForeignKey,
)
from sqlalchemy import text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

DATABASE_URL = os.getenv("DATABASE_URL")

Base = declarative_base()
engine = None
SessionLocal: Optional[sessionmaker] = None

# Password hashing (PINs are stored hashed)
# Switched to pbkdf2_sha256 to avoid bcrypt backend issues in some environments.
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


def hash_pin_value(pin: str) -> str:
    # Bcrypt has a 72-byte limit; enforce upstream but guard defensively
    if len(pin) > 72:
        raise ValueError("PIN too long for bcrypt (max 72 bytes)")
    return pwd_context.hash(pin)


def verify_pin_value(pin: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(pin, hashed)
    except Exception:
        return False


def init_db() -> None:
    """
    Initialise the DB engine + session factory and create any missing tables.

    NOTE:
    - This will create any *new* tables such as `order_events`.
    - It will NOT add new columns to existing tables; use ALTER TABLE in Neon for that.
    """
    global engine, SessionLocal
    if not DATABASE_URL:
        # Fail fast: running without a DB URL leaves the service half-initialised
        msg = "DATABASE_URL is not set; backend cannot start"
        print(f"[AUTH_INIT_ERROR] {msg}")
        raise RuntimeError(msg)
    if engine is not None:
        return
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    # Attempt to add new columns to existing tables where possible.
    # This is a best-effort migration for the `locations` column on `orders`.
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS locations INTEGER DEFAULT 0;"))
            conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_rate_uh FLOAT;"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_pin TEXT;"))
    except Exception:
        # If ALTER fails (e.g., non-Postgres or permission issues), ignore —
        # admins can run the migration manually in the DB.
        pass


def get_session() -> Session:
    if SessionLocal is None:
        raise RuntimeError("DB not initialised")
    return SessionLocal()


# --- Models ---


class GlobalState(Base):
    """
    Legacy single row of global payload.
    Only really used for global admin flags / feature toggles.
    """
    __tablename__ = "global_state"
    id = Column(Integer, primary_key=True, index=True)
    payload = Column(Text, nullable=False)


class DeviceState(Base):
    """
    Legacy state blob per device_id.

    This currently stores the full MainState JSON, including:
      - picks[]
      - historyDays[]
      - shift metadata

    We will gradually move the *meaningful* historical data into
    proper tables (ShiftSession, OrderRecord, OrderEvent), so this blob
    can eventually be trimmed down or removed.
    """
    __tablename__ = "device_states"
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Text, unique=True, index=True, nullable=False)
    payload = Column(Text, nullable=False)


class UsageEvent(Base):
    __tablename__ = "usage_events"
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    category = Column(Text, nullable=False)
    detail = Column(Text, nullable=True)


class ShiftSession(Base):
    """
    Per-shift metadata, keyed by operator_id (PIN) and optionally device_id.
    Represents a single continuous shift window.
    """
    __tablename__ = "shift_sessions"
    id = Column(Integer, primary_key=True, index=True)
    operator_id = Column(Text, nullable=False, index=True)
    # Link shifts to devices
    device_id = Column(Text, nullable=True)
    operator_name = Column(Text, nullable=True)
    site = Column(Text, nullable=True)
    shift_type = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    total_units = Column(Integer, nullable=True)
    avg_rate = Column(Float, nullable=True)


class OrderRecord(Base):
    """
    Per-order summary record.

    This is designed primarily for CLOSED orders. Open order state (wraps,
    in-progress metrics) still lives inside the device_states JSON blob.

    Longer term, the day-by-day and event-by-event history will live
    in ShiftSession + OrderRecord + OrderEvent so we don't rely on
    a giant JSON blob for analytics.
    """
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)

    # Identity
    operator_id = Column(Text, nullable=False, index=True)   # PIN
    operator_name = Column(Text, nullable=True)
    device_id = Column(Text, nullable=True, index=True)

    # Order info
    order_name = Column(Text, nullable=True)                 # e.g. p["name"]
    is_shared = Column(Boolean, nullable=False, default=False)
    total_units = Column(Integer, nullable=True)             # e.g. p["units"]
    pallets = Column(Integer, nullable=True)
    locations = Column(Integer, nullable=True, default=0)

    # Timing
    order_date = Column(DateTime(timezone=True), index=True, server_default=func.now())
    start_hhmm = Column(Text, nullable=True)                 # 'HH:MM'
    close_hhmm = Column(Text, nullable=True)                 # 'HH:MM'
    duration_min = Column(Integer, nullable=True)
    excl_min = Column(Integer, nullable=True)                # excluded mins (breaks)
    order_rate_uh = Column(Float, nullable=True)             # units/hour, computed from total_units / (duration_min / 60)

    # Status / notes
    closed_early = Column(Boolean, nullable=False, default=False)
    early_reason = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)                      # optional aggregated notes

    # Optional raw log for debugging (wraps/breaks) – JSON string
    log_json = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class OrderEvent(Base):
    """
    Per-event ledger row tied to an OrderRecord.

    This is the foundation for "Layer 2: what actually happened" without
    relying on a giant history blob.

    Typical usage:
      - Wrap logged       → event_type='wrap',   value_units=units_done, value_min=None
      - Break/Lunch       → event_type='break',  value_units=None,       value_min=minutes
      - Delay             → event_type='delay',  value_units=None,       value_min=minutes
      - Shared submission → event_type='shared', value_units=units,      value_min=None
      - Note              → event_type='note',   value_units=None,       value_min=None
    Extra context (cause, customer, etc) goes in meta_json.
    """
    __tablename__ = "order_events"

    id = Column(Integer, primary_key=True, index=True)

    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    operator_id = Column(Text, nullable=True, index=True)
    device_id = Column(Text, nullable=True, index=True)

    event_type = Column(Text, nullable=False)       # 'wrap', 'break', 'delay', 'note', 'shared', ...
    value_units = Column(Integer, nullable=True)    # units for wraps/shared
    value_min = Column(Integer, nullable=True)      # minutes for breaks/delays
    meta_json = Column(Text, nullable=True)         # JSON string with any extra detail

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


# --- User Authentication Table ---


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(Text, unique=True, index=True, nullable=False)
    pin = Column(Text, nullable=False)  # legacy column; now stores hashed value
    hashed_pin = Column(Text, nullable=True)  # canonical hashed PIN
    display_name = Column(Text, nullable=True)
    role = Column(Text, nullable=False, default="picker")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# Admin Message Table


class AdminMessage(Base):
    __tablename__ = "admin_messages"
    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Text, index=True, nullable=False)
    message_text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    read_at = Column(DateTime(timezone=True), nullable=True)


# --- Global / device state helpers ---


def load_global_state() -> Optional[dict]:
    if engine is None:
        return None
    session = get_session()
    try:
        row = session.query(GlobalState).filter(GlobalState.id == 1).first()
        return json.loads(row.payload) if row else None
    except Exception:
        return None
    finally:
        session.close()


def save_global_state(payload: dict) -> None:
    if engine is None:
        return
    session = get_session()
    try:
        row = session.query(GlobalState).filter(GlobalState.id == 1).first()
        if not row:
            session.add(GlobalState(id=1, payload=json.dumps(payload or {})))
        else:
            row.payload = json.dumps(payload or {})
        session.commit()
    finally:
        session.close()


def load_device_state(device_id: str) -> Optional[dict]:
    if engine is None or not device_id:
        return None
    session = get_session()
    try:
        row = session.query(DeviceState).filter(DeviceState.device_id == device_id).first()
        return json.loads(row.payload) if row else None
    except Exception:
        return None
    finally:
        session.close()


def save_device_state(device_id: str, payload: dict) -> None:
    if engine is None or not device_id:
        return
    session = get_session()
    try:
        # Defensive normalization: ensure any order objects include `locations`
        safe_payload = dict(payload or {})
        try:
            # Normalize top-level current.locations
            cur = safe_payload.get('current')
            if isinstance(cur, dict):
                cur['locations'] = int(cur.get('locations') or 0)
        except Exception:
            pass

        try:
            # Normalize picks[] entries
            picks = safe_payload.get('picks')
            if isinstance(picks, list):
                for p in picks:
                    try:
                        if isinstance(p, dict):
                            p['locations'] = int(p.get('locations') or 0)
                    except Exception:
                        p['locations'] = 0
        except Exception:
            pass

        try:
            # Normalize history -> each day's picks if present
            history = safe_payload.get('history')
            if isinstance(history, list):
                for day in history:
                    if isinstance(day, dict):
                        day_picks = day.get('picks')
                        if isinstance(day_picks, list):
                            for p in day_picks:
                                try:
                                    if isinstance(p, dict):
                                        p['locations'] = int(p.get('locations') or 0)
                                except Exception:
                                    p['locations'] = 0
        except Exception:
            pass

        row = session.query(DeviceState).filter(DeviceState.device_id == device_id).first()
        if not row:
            session.add(DeviceState(device_id=device_id, payload=json.dumps(safe_payload or {})))
        else:
            row.payload = json.dumps(safe_payload or {})
        session.commit()
    finally:
        session.close()


def log_usage_event(category: str, detail: Optional[Dict[str, Any]] = None) -> None:
    if engine is None:
        return
    session = get_session()
    try:
        session.add(UsageEvent(category=category, detail=json.dumps(detail or {})))
        session.commit()
    finally:
        session.close()


def get_recent_usage(limit: int = 100) -> List[Dict[str, Any]]:
    if engine is None:
        return []
    session = get_session()
    try:
        q = session.query(UsageEvent).order_by(UsageEvent.id.desc()).limit(limit)
        results: List[Dict[str, Any]] = []
        for r in list(q):
            det: Dict[str, Any] = {}
            if r.detail:
                try:
                    det = json.loads(r.detail)
                except Exception:
                    det = {}
            results.append(
                {
                    "id": r.id,
                    "created_at": None if r.created_at is None else r.created_at.isoformat(),
                    "category": r.category,
                    "device_id": det.get("device_id"),
                    "operator_id": det.get("operator_id"),
                    "detail": det,
                }
            )
        return results
    finally:
        session.close()


def get_usage_summary(days: int = 7) -> List[Dict[str, Any]]:
    if engine is None:
        return []
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    session = get_session()
    try:
        q = (
            session.query(UsageEvent)
            .filter(UsageEvent.category == "STATE_SAVE")
            .filter(UsageEvent.created_at >= cutoff)
            .order_by(UsageEvent.created_at.asc())
        )
        counts: Dict[str, int] = {}
        for evt in q:
            if not evt.created_at:
                continue
            d = evt.created_at.date().isoformat()
            counts[d] = counts.get(d, 0) + 1

        # Return list of {date, count}
        return [
            {
                "date": (now - timedelta(days=days - 1 - i)).date().isoformat(),
                "count": counts.get(
                    (now - timedelta(days=days - 1 - i)).date().isoformat(), 0
                ),
            }
            for i in range(days)
        ]
    finally:
        session.close()


# --- Admin Message Helpers ---


def send_admin_message(device_id: str, text: str) -> None:
    if engine is None:
        return
    session = get_session()
    try:
        msg = AdminMessage(device_id=device_id, message_text=text)
        session.add(msg)
        session.commit()
    finally:
        session.close()


def pop_admin_messages(device_id: str) -> List[str]:
    """
    Fetch unread messages for a device and mark them as read immediately.
    Returns a list of message strings.
    """
    if engine is None:
        return []
    session = get_session()
    try:
        msgs = (
            session.query(AdminMessage)
            .filter(AdminMessage.device_id == device_id, AdminMessage.read_at == None)
            .all()
        )

        results: List[str] = []
        for m in msgs:
            results.append(m.message_text)
            m.read_at = datetime.now(timezone.utc)

        session.commit()
        return results
    finally:
        session.close()


# --- Shift helpers ---


def start_shift(
    operator_id: str,
    device_id: Optional[str] = None,
    operator_name: Optional[str] = None,
    site: Optional[str] = None,
    shift_type: Optional[str] = None,
) -> int:
    if engine is None:
        return 0
    session = get_session()
    try:
        shift = ShiftSession(
            operator_id=operator_id,
            device_id=device_id,
            operator_name=operator_name,
            site=site,
            shift_type=shift_type,
        )
        session.add(shift)
        session.commit()
        session.refresh(shift)
        return shift.id if shift.id is not None else 0
    finally:
        session.close()


def end_shift(
    shift_id: int,
    total_units: Optional[int] = None,
    avg_rate: Optional[float] = None,
) -> None:
    if engine is None:
        return
    session = get_session()
    try:
        shift = session.get(ShiftSession, shift_id)
        if shift:
            shift.ended_at = datetime.now(timezone.utc)
            if total_units is not None:
                shift.total_units = total_units
            if avg_rate is not None:
                shift.avg_rate = avg_rate
            session.commit()
    finally:
        session.close()


def get_recent_shifts(limit: int = 50, operator_id: Optional[str] = None) -> List[Dict[str, Any]]:
    if engine is None:
        return []
    session = get_session()
    try:
        q = session.query(ShiftSession)
        if operator_id:
            q = q.filter(ShiftSession.operator_id == operator_id)
        q = q.order_by(ShiftSession.started_at.desc()).limit(limit)
        return [
            {
                "id": s.id,
                "operator_id": s.operator_id,
                "device_id": s.device_id,
                "operator_name": s.operator_name,
                "site": s.site,
                "shift_type": s.shift_type,
                "started_at": s.started_at.isoformat() if s.started_at else None,
                "ended_at": s.ended_at.isoformat() if s.ended_at else None,
                "total_units": s.total_units,
                "avg_rate": s.avg_rate,
            }
            for s in q
        ]
    finally:
        session.close()


def get_all_device_states() -> List[Dict[str, Any]]:
    """
    Fetches the latest state (JSON payload) for ALL *logical users*.

    We may have multiple DeviceState rows representing the same human:
    - old rows keyed by raw device UUIDs
    - new rows keyed as "user:<PIN>"

    To avoid duplicate chips in the Admin dashboard, we:
      1) Parse each payload.
      2) Derive a logical key: operator_id -> operator_name -> device_id.
      3) Keep only the MOST RECENT savedAt per logical key.
    """
    if engine is None:
        return []

    session = get_session()
    try:
        rows = session.query(DeviceState).all()

        # temp map: logical_key -> latest payload
        latest_by_key: Dict[str, Dict[str, Any]] = {}

        for row in rows:
            try:
                data = json.loads(row.payload) or {}
            except Exception:
                continue

            # Attach the DB device_id for UI / messaging
            data["device_id"] = row.device_id

            current = data.get("current") or {}

            operator_id = current.get("operator_id")
            operator_name = current.get("operator_name")

            # savedAt is ISO string from frontend; may be missing
            saved_at_str = data.get("savedAt")
            try:
                saved_at = (
                    datetime.fromisoformat(saved_at_str)
                    if saved_at_str
                    else None
                )
            except Exception:
                saved_at = None

            # Choose a stable logical key:
            #  - Prefer operator_id (PIN / DB username)
            #  - Else operator_name (Julius / Supervisor Acc)
            #  - Else fall back to raw device_id
            logical_key = operator_id or operator_name or row.device_id

            existing = latest_by_key.get(logical_key)
            if existing is not None:
                # Compare timestamps; keep the newer one
                prev_str = existing.get("savedAt")
                try:
                    prev_ts = (
                        datetime.fromisoformat(prev_str)
                        if prev_str
                        else None
                    )
                except Exception:
                    prev_ts = None

                # If we don't have a timestamp or this one isn't newer, skip
                if prev_ts and saved_at and saved_at <= prev_ts:
                    continue

            latest_by_key[logical_key] = data

        # Strip any helper fields (none right now) and return list
        return list(latest_by_key.values())

    finally:
        session.close()


# --- Order helpers ---


def _compute_duration_min(start_hhmm: Optional[str], close_hhmm: Optional[str]) -> Optional[int]:
    """
    Compute duration in minutes from 'HH:MM' strings.
    Returns None if parsing fails.
    """
    if not start_hhmm or not close_hhmm:
        return None
    try:
        s_h, s_m = [int(x) for x in start_hhmm.split(":")]
        c_h, c_m = [int(x) for x in close_hhmm.split(":")]
        start_total = s_h * 60 + s_m
        close_total = c_h * 60 + c_m
        diff = close_total - start_total
        if diff < 0:
            return None
        return diff
    except Exception:
        return None


def record_order_from_payload(
    operator_id: str,
    device_id: Optional[str],
    order_payload: Dict[str, Any],
    operator_name: Optional[str] = None,
    notes: Optional[str] = None,
) -> None:
    """
    Persist a closed-order summary into the orders table.

    `order_payload` is expected to look like the objects pushed into `picks[]`
    in the frontend (core-tracker-history.js), e.g.:

        {
          "name": "MORWAK",
          "units": 250,
          "pallets": 3,
          "start": "08:00",
          "close": "08:45",
          "excl": 5,
          "closedEarly": false,
          "earlyReason": "",
          "log": {...}
        }

    NOTE:
      - This writes a single summary row into `orders`.
      - In Step 2 we can optionally parse `p["log"]` and emit a row-per-event
        into `order_events` for deeper analytics, without changing the API
        contract for the frontend.
    """
    if engine is None:
        return

    # Defensive copy so we don't accidentally mutate caller data
    p = dict(order_payload or {})

    order_name = p.get("name")
    is_shared = bool(p.get("shared"))
    total_units = p.get("units") or p.get("total_units") or p.get("total")
    try:
        if isinstance(total_units, str):
            total_units = int(total_units)
    except Exception:
        total_units = None

    pallets = p.get("pallets")
    try:
        if isinstance(pallets, str):
            pallets = int(pallets)
    except Exception:
        pallets = None

    start_hhmm = p.get("start")
    close_hhmm = p.get("close") or p.get("closed")
    duration_min = _compute_duration_min(start_hhmm, close_hhmm)

    excl_min = p.get("excl")
    try:
        if isinstance(excl_min, str):
            excl_min = int(excl_min)
    except Exception:
        excl_min = None

    # Locations (new): optional integer number of locations in the order
    locations = p.get("locations")
    try:
        if isinstance(locations, str):
            locations = int(locations)
        elif locations is None:
            locations = 0
        else:
            locations = int(locations)
    except Exception:
        locations = 0

    closed_early = bool(p.get("closedEarly"))
    early_reason = p.get("earlyReason") or None

    # Notes override any `notes` field in payload
    combined_notes = notes or p.get("notes") or None

    # Compute order_rate_uh (units per hour)
    order_rate_uh = None
    if total_units is not None and isinstance(total_units, (int, float)) and duration_min and duration_min > 0:
        try:
            order_rate_uh = float(total_units) / (float(duration_min) / 60.0)
        except Exception:
            order_rate_uh = None

    log_json = None
    if "log" in p:
        try:
            log_json = json.dumps(p.get("log") or {})
        except Exception:
            log_json = None

    session = get_session()
    try:
        rec = OrderRecord(
            operator_id=operator_id,
            operator_name=operator_name,
            device_id=device_id,
            order_name=order_name,
            is_shared=is_shared,
            total_units=total_units,
            pallets=pallets,
            locations=locations,
            start_hhmm=start_hhmm,
            close_hhmm=close_hhmm,
            duration_min=duration_min,
            excl_min=excl_min,
            order_rate_uh=order_rate_uh,
            closed_early=closed_early,
            early_reason=early_reason,
            notes=combined_notes,
            log_json=log_json,
        )
        session.add(rec)
        session.commit()
    finally:
        session.close()


def get_recent_orders_for_operator(
    operator_id: str,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """
    Simple helper for future admin views / analytics.

    Returns the most recent orders for a given operator_id (PIN).
    """
    if engine is None:
        return []
    session = get_session()
    try:
        q = (
            session.query(OrderRecord)
            .filter(OrderRecord.operator_id == operator_id)
            .order_by(OrderRecord.created_at.desc())
            .limit(limit)
        )
        results: List[Dict[str, Any]] = []
        for o in q:
            results.append(
                {
                    "id": o.id,
                    "operator_id": o.operator_id,
                    "operator_name": o.operator_name,
                    "device_id": o.device_id,
                    "order_name": o.order_name,
                    "is_shared": o.is_shared,
                        "total_units": o.total_units,
                        "locations": o.locations,
                    "pallets": o.pallets,
                    "order_date": o.order_date.isoformat() if o.order_date else None,
                    "start_hhmm": o.start_hhmm,
                    "close_hhmm": o.close_hhmm,
                    "duration_min": o.duration_min,
                    "excl_min": o.excl_min,
                    "order_rate_uh": o.order_rate_uh,
                    "closed_early": o.closed_early,
                    "early_reason": o.early_reason,
                    "notes": o.notes,
                    "created_at": o.created_at.isoformat() if o.created_at else None,
                }
            )
        return results
    finally:
        session.close()


def get_history_for_operator(
    operator_id: str,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """
    Fetch archived/completed orders for a given operator, formatted for frontend History rendering.

    Returns list of orders with fields:
      - id: order record ID
      - customer: order name
      - units: total units completed
      - locations: number of locations
      - pallets: number of pallets (if applicable)
      - startTime: ISO datetime string or None
      - closeTime: ISO datetime string or None
      - orderRate: units/hour (float) or None

    This matches the shape expected by the frontend's History table rendering code.
    """
    if engine is None:
        return []
    session = get_session()
    try:
        q = (
            session.query(OrderRecord)
            .filter(OrderRecord.operator_id == operator_id)
            .order_by(OrderRecord.order_date.desc())
            .limit(limit)
        )
        results: List[Dict[str, Any]] = []
        for o in q:
            # Convert HH:MM format to full datetime if possible
            start_time_iso = None
            close_time_iso = None
            
            if o.start_hhmm and o.order_date:
                try:
                    # Parse HH:MM and combine with order date
                    parts = o.start_hhmm.split(":")
                    h, m = int(parts[0]), int(parts[1])
                    start_dt = o.order_date.replace(hour=h, minute=m, second=0, microsecond=0)
                    start_time_iso = start_dt.isoformat()
                except Exception:
                    pass

            if o.close_hhmm and o.order_date:
                try:
                    # Parse HH:MM and combine with order date
                    parts = o.close_hhmm.split(":")
                    h, m = int(parts[0]), int(parts[1])
                    close_dt = o.order_date.replace(hour=h, minute=m, second=0, microsecond=0)
                    close_time_iso = close_dt.isoformat()
                except Exception:
                    pass

            results.append(
                {
                    "id": o.id,
                    "customer": o.order_name,
                    "units": o.total_units or 0,
                    "locations": o.locations or 0,
                    "pallets": o.pallets,
                    "startTime": start_time_iso,
                    "closeTime": close_time_iso,
                    "orderRate": o.order_rate_uh,
                }
            )
        return results
    finally:
        session.close()


# --- User Authentication Helpers ---


def create_user(
    username: str,
    pin: str,
    display_name: Optional[str] = None,
    role: str = "picker",
) -> tuple[bool, str]:
    """
    Creates a new user with PIN, display_name and role.

    Returns (success, code):
      - (False, "db_not_initialised") if engine is missing
      - (False, "username_exists") if username already present
      - (False, "db_error") on commit failure
      - (True, "created") on success
    """
    if engine is None:
        return False, "db_not_initialised"
    session = get_session()
    try:
        existing = session.query(User).filter(User.username == username).first()
        if existing:
            return False, "username_exists"

        clean_display_name = (display_name or username).strip()
        clean_role = (role or "picker").strip().lower()

        hashed = hash_pin_value(pin)

        new_user = User(
            username=username,
            pin=hashed,          # store hashed even in legacy column
            hashed_pin=hashed,
            display_name=clean_display_name,
            role=clean_role,
        )
        session.add(new_user)
        session.commit()
        return True, "created"
    except Exception:
        session.rollback()
        return False, "db_error"
    finally:
        session.close()


def verify_user(username: str, pin: str) -> bool:
    """Verifies a username and PIN."""
    if engine is None:
        print("[AUTH_VERIFY_ERROR] DATABASE_URL/engine not initialised")
        return False
    session = get_session()
    try:
        user = session.query(User).filter(User.username == username).first()
        if not user:
            return False

        # Prefer hashed PIN verification
        if user.hashed_pin and verify_pin_value(pin, user.hashed_pin):
            return True

        # Legacy fallback: plain-text pin stored in `pin` column
        if user.pin and user.pin == pin:
            try:
                new_hash = hash_pin_value(pin)
                user.hashed_pin = new_hash
                user.pin = new_hash  # scrub legacy column by replacing with hashed value
                session.commit()
            except Exception:
                session.rollback()
            return True

        return False
    finally:
        session.close()


def get_user(username: str) -> Optional[User]:
    """Fetches a user record by username."""
    if engine is None:
        return None
    session = get_session()
    try:
        return session.query(User).filter(User.username == username).first()
    finally:
        session.close()


def get_user_by_id(user_id: int) -> Optional[User]:
    """Fetches a user record by numeric ID."""
    if engine is None:
        return None
    session = get_session()
    try:
        return session.get(User, user_id)
    finally:
        session.close()
