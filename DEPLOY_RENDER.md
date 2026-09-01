# Deploying the MONEVA API to Render

Everything in the repo is ready. What remains needs your accounts, so it has to
be done by you — the steps below are exact.

---

## What I changed to make this deployable

| Problem | Why it would have failed | Fix |
|---|---|---|
| `asyncpg` missing | The async engine cannot talk to Postgres without it. Build succeeds, every request 500s. | Added to `requirements.txt` |
| `aiosqlite`, `greenlet` missing | Not listed at all — a clean `pip install -r requirements.txt` produced an app that could not open any database. | Added |
| `postgres://` URL scheme | Render hands out `postgres://`; SQLAlchemy removed that alias. | `app/db/url.py` normalises it to `postgresql+asyncpg://` |
| Naive timestamps | All 25 datetime columns were `TIMESTAMP WITHOUT TIME ZONE`, but the app writes timezone-aware values. **asyncpg rejects that — every INSERT would have failed in production.** | Columns are now `TIMESTAMPTZ` (migration `a1b2c3d4e5f6`) |
| SQLite on Render | Render's disk is wiped on every deploy and restart. Users, accounts and transactions would silently vanish. | Blueprint provisions Postgres |
| No connection pooling | Managed Postgres drops idle connections; requests would fail intermittently. | `pool_pre_ping`, `pool_recycle=280` |

---

## Step 1 — Put the code in a Git repository

**Render deploys from Git.** There is no way around this short of publishing a
Docker image, which needs a registry account anyway. `D:\MONEVA\.git` is an
empty directory, so this repo has never been initialised.

`.gitignore` already excludes `.venv/`, `node_modules/`, `*.db` and `.env`, so
your database and secrets will not be committed. **Verify that yourself before
pushing** — run `git status` and confirm `monevadb.db` is not listed.

```bash
cd D:\MONEVA
git init
git add -A
git status
```

Check the file list, then:

```bash
git commit -m "MONEVA: initial commit"
git branch -M main
git remote add origin https://github.com/<you>/moneva.git
git push -u origin main
```

Create the empty GitHub repo first at github.com/new. Make it **private** —
this is a personal finance app.

## Step 2 — Create the Render stack

1. Go to <https://dashboard.render.com> and sign in.
2. **New +** → **Blueprint**.
3. Connect your GitHub account and pick the `moneva` repo.
4. Render reads `render.yaml` and shows two resources: `moneva-api` and
   `moneva-db`. Click **Apply**.

It provisions the Postgres instance, wires `DATABASE_URL` into the service,
generates `JWT_SECRET`, runs `alembic upgrade head`, then starts uvicorn.

## Step 3 — Add your Gemini key

In the Render dashboard: **moneva-api** → **Environment** → **Add Environment
Variable**:

```
GEMINI_API_KEY = <your key from aistudio.google.com/apikey>
```

Leave it out and the assistant still works, but falls back to the keyword
engine — `bike refueled at 711.83` will not parse.

## Step 4 — Point the app at it

Take your service URL from Render (e.g. `https://moneva-api.onrender.com`) and
put it in `apps/web/.env.production`:

```
VITE_API_BASE_URL=https://moneva-api.onrender.com/api
```

Then build a release APK:

```bash
npm run build:web
cd apps/web && npx cap sync android
cd android && gradlew.bat assembleRelease
```

It **must** be `https`. The release network security config refuses cleartext,
so an `http://` endpoint produces an app that cannot reach its own API.

You can also change it without rebuilding: **Profile → Security → Server
Address**, paste the URL, **Save & Test**.

---

## Free tier caveats — read before relying on this

- **The service sleeps.** Free web services spin down after ~15 minutes idle.
  The next request takes roughly 50 seconds while it wakes. For an app you open
  a few times a day, every session starts with that delay.
- **The free database expires.** Render's free Postgres is time-limited. When
  it goes, so does the data. Move to a paid instance before this holds anything
  you would be upset to lose, and take backups.
- **Nothing migrates your local data.** The Render database starts empty. Your
  219 local users and 421 transactions stay in `services/api/monevadb.db`.

## Before this is genuinely production-ready

These are real and currently unaddressed:

1. **Refresh tokens are not revocable.** A stolen one stays valid for 60 days;
   there is no server-side store and no logout-everywhere. See the note in
   `app/core/config.py`.
2. **Avatars are base64 in a database column.** Fine at your scale, wasteful at
   any other. Object storage is the right home for them.
3. **No rate limiting** on `/auth/login` or `/auth/register`. On a public URL
   that is an open invitation to credential stuffing.
4. **No backups configured.**
