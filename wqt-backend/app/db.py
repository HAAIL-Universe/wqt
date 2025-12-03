# app/db.py
import os
import json
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    Text,
    DateTime,
    Float,
    func,
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# DATABASE_URL must be set in environment for DB mode (Render/Neon).
# If it's missing (e.g. pure local dev), all DB helpers become no-ops.
DATABASE_URL = os.getenv("DATABASE_URL")

Base = declarative_base()
engine = None
SessionLocal: Optional[sessionmaker] = None


def init_db() -> None:
    """
    Initialise the SQLAlchemy engine and create tables if DATABASE_URL is set.
    Safe to call multiple times.
    """
    global engine, SessionLocal

    if not DATABASE_URL:
        # Running in "file only" mode – nothing to do.
        return

    if engine is not None:
        # Already initialised
        return

    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)


def get_session() -> Session:
    """
    Return a new SQLAlchemy session. Assumes init_db() has been called.
    """
    if SessionLocal is None:
        raise RuntimeError("DB not initialised – call init_db() first.")
    return SessionLocal()


class GlobalState(Base):
    """
    Single-row table that stores the latest full WQT MainState payload as JSON.
    """
    __tablename__ = "global_state"

    id = Column(Integer, primary_key=True, index=True)
    payload = Column(Text, nullable=False)


class DeviceState(Base):
    """
    Per-device state table. Each browser / device gets a device_id and
    its own JSON payload. This is what lets us keep data isolated per device
    without logins.
    """
    __tablename__ = "device_states"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Text, unique=True, index=True, nullable=False)
    payload = Column(Text, nullable=False)


class UsageEvent(Base):
    """
    Append-only usage log so you can see how often WQT is used.
    """
    __tablename__ = "usage_events"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    category = Column(Text, nullable=False)  # e.g. "STATE_SAVE", "LOGIN", "SHIFT_END"
    detail = Column(Text, nullable=True)     # JSON string with extra data


class ShiftSession(Base):
    """
    Shift/session log to track pickers by name, shift, units/hour, etc.
    """
    __tablename__ = "shift_sessions"

    id = Column(Integer, primary_key=True, index=True)
    operator_id = Column(Text, nullable=False, index=True)
    operator_name = Column(Text, nullable=True)
    site = Column(Text, nullable=True)
    shift_type = Column(Text, nullable=True)  # e.g. "9h", "10h", "night"
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    total_units = Column(Integer, nullable=True)
    avg_rate = Column(Float, nullable=True)  # units/hour


# ------------------------ Global state helpers ------------------------


def load_global_state() -> Optional[dict]:
    """
    Load the single global state row from Postgres.
    Returns None if DB isn't configured or row doesn't exist / is invalid.
    """
    if engine is None:
        return None

    session = get_session()
    try:
        row = session.query(GlobalState).filter(GlobalState.id == 1).first()
        if not row:
            return None
        try:
            return json.loads(row.payload)
        except json.JSONDecodeError:
            return None
    finally:
        session.close()


def save_global_state(payload: dict) -> None:
    """
    Upsert the single global state row in Postgres.
    No-op if DB isn't configured.
    """
    if engine is None:
        return

    session = get_session()
    try:
        row = session.query(GlobalState).filter(GlobalState.id == 1).first()
        if not row:
            row = GlobalState(id=1, payload=json.dumps(payload or {}))
            session.add(row)
        else:
            row.payload = json.dumps(payload or {})
        session.commit()
    finally:
        session.close()


# ------------------------ Device state helpers ------------------------


def load_device_state(device_id: str) -> Optional[dict]:
    """
    Load state for a specific device_id from Postgres.
    Returns None if DB isn't configured or row doesn't exist / is invalid.
    """
    if engine is None:
        return None

    if not device_id:
        return None

    session = get_session()
    try:
        row = (
            session.query(DeviceState)
            .filter(DeviceState.device_id == device_id)
            .first()
        )
        if not row:
            return None
        try:
            return json.loads(row.payload)
        except json.JSONDecodeError:
            return None
    finally:
        session.close()


def save_device_state(device_id: str, payload: dict) -> None:
    """
    Upsert per-device state row in Postgres.
    No-op if DB isn't configured or device_id is missing.
    """
    if engine is None:
        return

    if not device_id:
        return

    session = get_session()
    try:
        row = (
            session.query(DeviceState)
            .filter(DeviceState.device_id == device_id)
            .first()
        )
        if not row:
            row = DeviceState(device_id=device_id, payload=json.dumps(payload or {}))
            session.add(row)
        else:
            row.payload = json.dumps(payload or {})
        session.commit()
    finally:
        session.close()


# ------------------------ Usage event helpers ------------------------


def log_usage_event(category: str, detail: Optional[Dict[str, Any]] = None) -> None:
    """
    Insert a simple usage event row. Safe to call; becomes a no-op if DB
    isn't configured.
    """
    if engine is None:
        return

    session = get_session()
    try:
        evt = UsageEvent(
            category=category,
            detail=json.dumps(detail or {}),
        )
        session.add(evt)
        session.commit()
    finally:
        session.close()


def get_recent_usage(limit: int = 100) -> List[Dict[str, Any]]:
    """
    Return the most recent usage events as simple dicts so the frontend can
    easily render them.
    """
    if engine is None:
        return []

    session = get_session()
    try:
        q = (
            session.query(UsageEvent)
            .order_by(UsageEvent.id.desc())
            .limit(limit)
        )
        rows = list(q)
        return [
            {
                "id": r.id,
                "created_at": None if r.created_at is None else r.created_at.isoformat(),
                "category": r.category,
                "detail": {} if not r.detail else json.loads(r.detail),
            }
            for r in rows
        ]
    finally:
        session.close()


def get_usage_summary(days: int = 7) -> List[Dict[str, Any]]:
    """
    Return a per-day count of STATE_SAVE events for the last `days` days.
    Format: [{"date": "2025-12-01", "count": 12}, ...]
    """
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
            day_str = evt.created_at.date().isoformat()
            counts[day_str] = counts.get(day_str, 0) + 1

        # Build an ordered series, including days with zero usage.
        result: List[Dict[str, Any]] = []
        for i in range(days):
            day = (now - timedelta(days=days - 1 - i)).date()
            dstr = day.isoformat()
            result.append({"date": dstr, "count": counts.get(dstr, 0)})

        return result
    finally:
        session.close()


# ------------------------ Shift/session helpers ------------------------


def start_shift(
    operator_id: str,
    operator_name: Optional[str] = None,
    site: Optional[str] = None,
    shift_type: Optional[str] = None,
) -> int:
    """
    Create a new ShiftSession row and return its ID.
    Returns 0 if DB is not configured (so frontend can still continue).
    """
    if engine is None:
        return 0

    session = get_session()
    try:
        shift = ShiftSession(
            operator_id=operator_id,
            operator_name=operator_name,
            site=site,
            shift_type=shift_type,
        )
        session.add(shift)
        session.commit()
        session.refresh(shift)
        return shift.id
    finally:
        session.close()


def end_shift(
    shift_id: int,
    total_units: Optional[int] = None,
    avg_rate: Optional[float] = None,
) -> None:
    """
    Mark a ShiftSession as ended and update summary stats.
    No-op if DB not configured or shift not found.
    """
    if engine is None:
        return

    session = get_session()
    try:
        shift = session.get(ShiftSession, shift_id)
        if not shift:
            return

        shift.ended_at = datetime.now(timezone.utc)
        if total_units is not None:
            shift.total_units = total_units
        if avg_rate is not None:
            shift.avg_rate = avg_rate

        session.commit()
    finally:
        session.close()


def get_recent_shifts(limit: int = 50) -> List[Dict[str, Any]]:
    """
    Return recent shift sessions with basic stats.
    """
    if engine is None:
        return []

    session = get_session()
    try:
        q = (
            session.query(ShiftSession)
            .order_by(ShiftSession.started_at.desc())
            .limit(limit)
        )
        rows = list(q)
        result: List[Dict[str, Any]] = []
        for s in rows:
            result.append(
                {
                    "id": s.id,
                    "operator_id": s.operator_id,
                    "operator_name": s.operator_name,
                    "site": s.site,
                    "shift_type": s.shift_type,
                    "started_at": None if s.started_at is None else s.started_at.isoformat(),
                    "ended_at": None if s.ended_at is None else s.ended_at.isoformat(),
                    "total_units": s.total_units,
                    "avg_rate": s.avg_rate,
                }
            )
        return result
    finally:
        session.close()
