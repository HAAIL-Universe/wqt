import os
import json
from typing import Optional

from sqlalchemy import create_engine, Column, Integer, Text
from sqlalchemy.orm import declarative_base, sessionmaker

# DATABASE_URL must be set in environment for DB mode (Render/Neon).
# If it's missing (e.g. pure local dev), all DB helpers become no-ops.
DATABASE_URL = os.getenv("DATABASE_URL")

Base = declarative_base()
engine = None
SessionLocal: Optional[sessionmaker] = None

if DATABASE_URL:
    # echo=False keeps logs clean; flip to True if you want SQL prints
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class GlobalState(Base):
    """
    Minimal table: a single row (id=1) holding the entire main state as JSON.

    Later we can split this into proper users/shifts tables, but for now this is
    a DB-backed replacement for data/main_state.json.
    """
    __tablename__ = "global_state"

    id = Column(Integer, primary_key=True, index=True)
    payload = Column(Text, nullable=False, default="{}")


def init_db() -> None:
    """
    Initialise tables if DATABASE_URL is configured.
    Called from FastAPI startup.
    """
    if engine is None:
        return
    Base.metadata.create_all(bind=engine)


def get_session():
    """
    Helper to get a SQLAlchemy session.
    Raises if DATABASE_URL is not configured.
    """
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL not set; DB session unavailable.")
    return SessionLocal()


def load_global_state() -> Optional[dict]:
    """
    Fetch the global state JSON blob from DB.
    Returns dict or None if DB is not configured or row doesn't exist.
    """
    if engine is None:
        return None

    session = get_session()
    try:
        row = session.query(GlobalState).filter(GlobalState.id == 1).first()
        if not row or not row.payload:
            return None
        return json.loads(row.payload)
    finally:
        session.close()


def save_global_state(payload: dict) -> None:
    """
    Upsert the global state row (id=1) with the given JSON-serialisable payload.
    Does nothing if DB is not configured.
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
