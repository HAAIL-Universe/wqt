# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models import MainState
from .storage import load_main, save_main
from .db import init_db  # NEW: DB init hook

app = FastAPI(title="WQT Backend v0")

# Allow your frontend (Render / localhost) to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """
    FastAPI startup hook: initialise database tables if DATABASE_URL is set.
    """
    init_db()


@app.get("/")
async def root():
    # optional but useful sanity check at the root URL
    return {"status": "ok"}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/state", response_model=MainState)
async def get_state():
    return load_main()


@app.post("/api/state", response_model=MainState)
async def set_state(state: MainState):
    save_main(state)
    return state
