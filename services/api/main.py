import uvicorn
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder

from app.core.config import settings
from app.db.database import engine
from app.models.models import Base
from app.routers import (
    auth,
    accounts,
    categories,
    transactions,
    finance,
    budgets,
    goals,
    bills,
    income,
    notifications,
    profile,
    ai
)

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url="/api/redoc"
)

import os

# Configure CORS Middleware
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,capacitor://localhost,http://localhost")
origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if os.getenv("ENVIRONMENT") == "production" else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # How long a browser may reuse a preflight answer. Starlette defaults to
    # 600s, and the access log shows what that costs: every ten minutes, and on
    # every app launch, a dozen OPTIONS round trips to this server before a
    # single GET is allowed out - the app talks to roughly twelve endpoints and
    # each one is preflighted separately.
    #
    # 7200 is Chrome's ceiling; larger values are silently clamped to it, and
    # Firefox caps at 86400. Nothing here is per-user or per-token, so a stale
    # preflight answer cannot leak or misauthorise anything: the reply says
    # which origins, methods and headers are permitted, and those change only
    # when this file does.
    max_age=7200,
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Return 400 for malformed request bodies instead of FastAPI's default 422.

    The whole API contract - and every verification suite - treats a rejected
    payload as a Bad Request, so schema-level and handler-level validation
    failures now surface the same status and the same `detail` shape.
    """
    errors = exc.errors()
    if errors:
        first = errors[0]
        field = ".".join(str(p) for p in first.get("loc", ()) if p not in ("body", "query", "path"))
        message = first.get("msg", "Invalid request payload.")
        detail = f"{field}: {message}" if field else message
    else:
        detail = "Invalid request payload."

    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"detail": detail, "errors": jsonable_encoder(errors)},
    )


@app.on_event("startup")
async def startup_event():
    """Startup event initialization."""
    pass

# Register API Routers
app.include_router(auth.router, prefix=settings.API_PREFIX)
app.include_router(accounts.router, prefix=settings.API_PREFIX)
app.include_router(categories.router, prefix=settings.API_PREFIX)
app.include_router(transactions.router, prefix=settings.API_PREFIX)
app.include_router(finance.router, prefix=settings.API_PREFIX)
app.include_router(budgets.router, prefix=settings.API_PREFIX)
app.include_router(goals.router, prefix=settings.API_PREFIX)
app.include_router(bills.router, prefix=settings.API_PREFIX)
app.include_router(income.router, prefix=settings.API_PREFIX)
app.include_router(notifications.router, prefix=settings.API_PREFIX)
app.include_router(profile.router, prefix=settings.API_PREFIX)
app.include_router(ai.router, prefix=settings.API_PREFIX)

@app.get("/health", tags=["Health"])
@app.get("/api/health", tags=["Health"])
async def health_check():
    """API health status endpoint."""
    from app.services.mailer import delivery_status

    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        # Which mail settings are present, never their values - see
        # delivery_status(). Password resets fail silently by design, so
        # without this a broken mail config can only be found by noticing
        # that no email ever arrives.
        "email": delivery_status(),
    }


@app.get("/api/health/mail-probe", tags=["Health"])
async def mail_probe():
    """
    Which SMTP ports this deployment can actually open a socket to.

    Deliberately a separate route: it makes four outbound connections and can
    take several seconds, which has no place in the health check a platform
    polls. Nothing here touches a credential - it is a bare TCP connect to
    Gmail's published mail ports, so the answer is "can this host send mail at
    all", which is the one thing nothing else in the system will tell you.
    """
    import asyncio

    from app.services.mailer import probe_smtp_ports

    # Blocking sockets, so keep them off the event loop.
    return await asyncio.to_thread(probe_smtp_ports)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
