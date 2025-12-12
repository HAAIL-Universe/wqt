# WQT — Warehouse QuickCalc & Tracker

WQT is a fast, mobile-first warehouse companion app for tracking pick performance and shift metrics with minimal friction. The UI is a static HTML/JS/CSS app (runs in any modern browser) with a FastAPI + Postgres backend for per-device state sync, shift sessions, and basic supervisor/admin visibility.

This repository contains both the frontend and the backend.

## Screens / entry points

- `login.html` — PIN-based sign-in and “Create user” flow with role selection (Picker / Operative / Supervisor).
- `index.html` — main picker/operative experience (QuickCalc + Tracker + History + settings/tools).
- `onboarding.html` — walkthrough overlay content that `index.html` loads and injects on first runs.
- `super.html` — supervisor dashboard (live device state list + recent activity/logs).
- `admin.html` — admin/GM-style dashboard (note: this file is stored as UTF-16LE in this repo).

## Repository layout

- Frontend pages: `index.html`, `login.html`, `super.html`, `admin.html`, `onboarding.html`
- Styling: `styles/index.css`
- Frontend scripts: `scripts/`
  - `api.js` — backend URL resolution, fetch helpers, auth helpers, state sync helpers
  - `login.js` — login + registration logic
  - `boot.js` — startup/bootstrap wiring
  - `core-state-ui.js`, `core-metrics-actions.js`, `core-tracker-history.js` — main app logic
  - `customer-selector-modal.js` — customer selection modal logic
  - `storage.js` — local persistence helpers
- Backend: `wqt-backend/`
  - `app/main.py` — FastAPI app, CORS, auth, API routes
  - `app/db.py` — SQLAlchemy models, DB init, persistence helpers
  - `app/storage.py` — per-device state load/save (DB-first, local JSON fallback)
  - `requirements.txt` — backend dependencies
- Deployment: `render.yaml` (Render blueprint for backend)
- Project log: `WQT_UPDATE_LOG.md` (running changelog/notes)

## Running locally

### 1) Backend (FastAPI)

Prereqs: Python 3.10+ and a Postgres database.

From the repo root:

```bash
cd wqt-backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
