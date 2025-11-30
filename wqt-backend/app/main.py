# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .models import MainState
from .storage import load_main, save_main

app = FastAPI(title="WQT Backend v0")

# Allow your frontend (Render / localhost) to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
