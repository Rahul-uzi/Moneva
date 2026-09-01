# MONEVA — Personal Finance Application

MONEVA is an offline-first, production-ready personal finance tracker. It runs as a responsive web application in development and is packaged as a native Android application using Capacitor for production.

---

## 1. Technology Stack

*   **Frontend**: React (v19) + TypeScript + Vite
*   **Backend**: Python (v3.12/v3.14) + FastAPI + Uvicorn
*   **Database (Production Server)**: PostgreSQL
*   **Database (Local / Android / Offline Fallback)**: SQLite
*   **Hybrid Wrapper**: Capacitor (v6)
*   **ORM**: SQLAlchemy (async) on server, Capacitor SQLite on mobile client
*   **CSS System**: Pure Vanilla CSS matching the Stitch design system

---

## 2. Project Folder Structure

```
/MONEVA
  ├── apps
  │   └── web                    # React Web & Capacitor app
  │       ├── src
  │       │   ├── assets         # Design assets & logo location
  │       │   ├── components     # Reusable UI forms and buttons
  │       │   ├── styles         # Central CSS design token variables
  │       │   ├── utils          # Paise integer calculation helpers
  │       │   └── main.tsx
  │       └── android            # Native Android container project
  ├── services
  │   └── api                    # FastAPI Python Backend
  │       ├── main.py            # Entry point for backend dev server
  │       ├── requirements.txt   # Backend dependency definitions
  │       └── app
  │           ├── models.py      # SQLAlchemy DB models
  │           └── routers/       # API endpoints
  ├── package.json               # Root monorepo workspace configuration
  ├── .gitignore                 # Excluded directories (node_modules, venv, local databases)
  └── README.md                  # This documentation file
```

---

## 3. Local Development Environment Setup

### Environment Variables
1.  **Frontend**: Copy `apps/web/.env.example` to `apps/web/.env` and update variables.
2.  **Backend**: Copy `services/api/.env.example` to `services/api/.env` and update variables.

### Local Run Commands

#### Starting the Frontend (React + Vite)
From the monorepo root folder, run:
```powershell
# Adjust PATH dynamically if Node.js is not globally registered
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
npm run dev:web
```

#### Starting the Backend (FastAPI + Uvicorn)
From the `services/api` folder, run:
```powershell
# Set pythonpath to point to our isolated dependency store
$env:PYTHONPATH = "D:\MONEVA\services\api\.venv\Lib\site-packages"
python main.py
```

---

## 4. Architectural Rules

1.  **Monetary Arithmetic**: Floating-point numbers are banned for authoritative monetary values. Values must use integer minor units (e.g. `125050 paise` representing `₹1,250.50`). Math calculations must utilize Python's `decimal` or React's integer converters.
2.  **Ledger Integrity**: Account balances must not be raw mutable cells. They are computed dynamically based on the sum of transaction events. Transfers are excluded from net income/expense calculations.
3.  **Idempotency & Offline Sync**: All local offline actions write directly to the local SQLite DB, flag `is_pending_sync = true`, and append metadata (`client_mutation_id`, `device_id`, `created_at`, `sync_status`) to the local sync queue.
4.  **AI Assistant Safety**: The AI assistant has no direct SQL execution permission. All financial mutations must return a structured JSON proposal that renders a manual user confirmation dialog in the UI before hitting standard write APIs.
