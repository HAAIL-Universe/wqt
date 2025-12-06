import os
import json
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any

from sqlalchemy import create_engine, Column, Integer, Text, DateTime, Float, func, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker, Session

DATABASE_URL = os.getenv("DATABASE_URL")

Base = declarative_base()
engine = None
SessionLocal: Optional[sessionmaker] = None


def init_db() -> None:
    global engine, SessionLocal
    if not DATABASE_URL:
        # In production, you might want to raise an error here
        return
    if engine is not None:
        return
    engine = create_engine(DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    # NOTE: This will create missing tables, but will NOT add new columns
    # to existing tables. Use ALTER TABLE in Neon to add new columns.
    Base.metadata.create_all(bind=engine)


def get_session() -> Session:
    if SessionLocal is None:
        raise RuntimeError("DB not initialised")
    return SessionLocal()


# --- Models ---


class GlobalState(Base):
    __tablename__ = "global_state"
    id = Column(Integer, primary_key=True, index=True)
    payload = Column(Text, nullable=False)


class DeviceState(Base):
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


# --- User Authentication Table ---


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(Text, unique=True, index=True, nullable=False)
    pin = Column(Text, nullable=False)  # Plain text 4/5-digit PIN for simplicity
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
    except:
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
    except:
        return None
    finally:
        session.close()


def save_device_state(device_id: str, payload: dict) -> None:
    if engine is None or not device_id:
        return
    session = get_session()
    try:
        row = session.query(DeviceState).filter(DeviceState.device_id == device_id).first()
        if not row:
            session.add(DeviceState(device_id=device_id, payload=json.dumps(payload or {})))
        else:
            row.payload = json.dumps(payload or {})
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
        results = []
        for r in list(q):
            det: Dict[str, Any] = {}
            if r.detail:
                try:
                    det = json.loads(r.detail)
                except:
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


def get_recent_shifts(limit: int = 50) -> List[Dict[str, Any]]:
    if engine is None:
        return []
    session = get_session()
    try:
        q = session.query(ShiftSession).order_by(ShiftSession.started_at.desc()).limit(
            limit
        )
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
    Fetches the latest state (JSON payload) for ALL devices.
    Used for the Admin Dashboard to show live status (Picks/Current).
    """
    if engine is None:
        return []
    session = get_session()
    try:
        rows = session.query(DeviceState).all()
        results: List[Dict[str, Any]] = []
        for row in rows:
            try:
                data = json.loads(row.payload)
                data["device_id"] = row.device_id
                results.append(data)
            except:
                continue
        return results
    finally:
        session.close()


# --- User Authentication Helpers ---


def create_user(
    username: str,
    pin: str,
    display_name: Optional[str] = None,
    role: str = "picker",
) -> bool:
    """Creates a new user with PIN, display_name and role."""
    if engine is None:
        return False
    session = get_session()
    try:
        existing = session.query(User).filter(User.username == username).first()
        if existing:
            return False

        clean_display_name = (display_name or username).strip()
        clean_role = (role or "picker").strip().lower()

        new_user = User(
            username=username,
            pin=pin,
            display_name=clean_display_name,
            role=clean_role,
        )
        session.add(new_user)
        session.commit()
        return True
    finally:
        session.close()


def verify_user(username: str, pin: str) -> bool:
    """Verifies a username and PIN."""
    if engine is None:
        return False
    session = get_session()
    try:
        user = session.query(User).filter(User.username == username).first()
        if user and user.pin == pin:
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
