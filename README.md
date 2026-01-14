# WQT

WQT is a lightweight warehouse picking / shift tracking UI (static HTML/JS) with an optional FastAPI backend for authentication, state storage, and history.

This README is intentionally **safe to share**: it contains **no secrets**, no private URLs, and includes redaction guidance for AI agents.

## Screenshots

<img width="755" height="1536" alt="image" src="https://github.com/user-attachments/assets/6dfdb113-c636-493c-b69c-2352ce3ae1c2" />

![10586830-E821-4DBE-AAA9-29F33BE01448](https://github.com/user-attachments/assets/1c4fd396-8dbf-4059-b947-6034b291f6a3)


<img width="755" height="1536" alt="image" src="https://github.com/user-attachments/assets/70da1ca5-0e19-4447-ab43-8e4ee84e6ce9" />


## Repo layout

- **Frontend (static)**: `index.html`, `login.html`, `super.html`, `admin.html`, `scripts/`, `styles/`
- **Backend (FastAPI)**: `wqt-backend/app/`
- **Backend migrations**: `wqt-backend/migrations/`
- **Backend seed/sample data** (ignored by git): `wqt-backend/data/`

## Quick start (local dev)

### 1) Backend (FastAPI)

From `wqt-backend/`:

1.  **Create a virtualenv**
    - Windows PowerShell: `python -m venv .venv`
2.  **Install deps**
    - `pip install -r requirements.txt`
3.  **Create env file**
    - Copy `wqt-backend/.env.example` -> `wqt-backend/.env`
    - Fill in real values locally (do **not** commit)
4.  **Run**
    - `uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload`

**Backend env vars:**

- `DATABASE_URL` (required): Postgres connection string
- `JWT_SECRET_KEY` (required): JWT signing secret (HS256)
- `ALLOWED_ORIGINS` (required): comma-separated list of allowed frontend origins
- `JWT_EXPIRE_MINUTES` (optional): default `720`
- `WQT_VERSION` (optional)

### 2) Frontend (static)

Serve the repo root with any static file server, for example:

- `python -m http.server 5500`

Then open:

- `http://127.0.0.1:5500/login.html`

**Point the frontend at your backend:**

- The frontend defaults to a hosted backend in `scripts/api.js`.
- For local development, the UI supports overriding the backend URL via a global `window.WQT_BACKEND_URL` value set before `scripts/api.js` loads.
- Add this snippet near the top of your HTML (before loading `scripts/api.js`):

```html
<script>
  window.WQT_BACKEND_URL = 'http://127.0.0.1:8000';
</script>
```

Make sure the backend `ALLOWED_ORIGINS` includes your frontend origin, e.g. `http://127.0.0.1:5500`.

## Deployment

- **Backend**: Deployment config lives in `render.yaml` (Render.com).
- **Frontend**: Static; host it anywhere (Render static, S3, GitHub Pages, etc.).

## License

This project is licensed for **Personal and Educational Use Only**. See [LICENSE](LICENSE) for details.

## AI hand-off / redaction rules

Before sharing this repo (or any subset) with an external agent:

- **Do not include** any `.env` files (repo ignores them by default).
- **Do not include** DB URLs, API keys, JWT secrets, or bearer tokens.
- **Treat** `wqt-backend/data/` and `debug_artifacts/` as potentially sensitive (they may contain real operator names/IDs in some environments).
- **Logs**: If you must share logs, remove `Authorization` headers and any `token` fields.

## Security posture (audit summary)

This is a fast-moving, UI-first project. It is not “hardened” by default.

### Critical
- **Credential hygiene**: Ensure no real `.env` files are ever committed. (The repo ignores `.env`, but verify before zipping).
  - *Action*: Rotate any database credentials that may have been exposed in previous untracked dev sessions.

### High
- **Token storage**: Frontend auth token is stored in `localStorage` (`WQT_CURRENT_USER.token`).
  - *Action*: For high-security environments, migrate to HttpOnly cookies to mitigate XSS risks.
- **XSS Surface**: Significant use of `innerHTML` in the UI.
  - *Action*: Prefer `textContent` or use a sanitization library.
- **"Unlock codes"**: Admin features use client-side code checks ("obscurity").
  - *Action*: Rely on server-side role claims in JWT.

### Medium
- **CORS**: Uses `allow_credentials=True`. 
  - *Action*: Ensure `ALLOWED_ORIGINS` is explicitly defined in production.

### Operational notes
- Backend requires Postgres (`DATABASE_URL`) and will fail-fast if missing.
- Migrations are SQL files in `wqt-backend/migrations/` and should be applied in order against your database.
