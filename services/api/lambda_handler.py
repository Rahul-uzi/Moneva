"""Runs the MONEVA API as an AWS Lambda function.

Mangum translates between Lambda's event/response shape and ASGI, so `main.app`
is the same application that runs under uvicorn - there is no second copy of
the API to keep in step.

WHAT CHANGES WHEN THE SAME APP RUNS HERE. Four things, and none of them are
visible in the code:

1. BACKGROUND TASKS STOP BEING IN THE BACKGROUND. Starlette awaits them inside
   the ASGI call - `await self.background()` in responses.py, after the body is
   sent - so under uvicorn the socket is already flushed and the caller has
   their answer. Under Mangum nothing reaches API Gateway until the ASGI call
   returns, so a background task runs while the caller is still waiting.

   That matters because the one background task here is sending mail, and it
   was made a background task precisely because a blocked SMTP port does not
   fail fast: it hangs until the socket times out, measured at about twenty
   seconds. Inside a Lambda that is twenty seconds of billed time and a caller
   who has usually given up.

   So on Lambda, mail must go over the HTTPS relay rather than SMTP - one POST
   to port 443, which no host blocks and which fails in milliseconds when it
   fails. Set MAIL_RELAY_URL and MAIL_RELAY_TOKEN and leave SMTP_* unset; the
   mailer already prefers whichever is configured.

2. THE RATE LIMITER STOPS LIMITING MUCH. app/core/ratelimit.py keeps its
   counters in the worker's memory, which is correct for one long-lived
   process and close to useless here: every concurrent execution environment
   has its own counters, and every cold start starts them again. A limit of
   "8 login attempts per account per 15 minutes" becomes 8 per environment,
   and there can be many. See RATE_LIMITER_NOTE below - this is the one thing
   about this move that is a step backwards rather than sideways, and it is
   not fixed by anything in this file.

3. CONNECTIONS MULTIPLY. The engine is built with pool_size 5 and
   max_overflow 5, so each execution environment can hold ten Postgres
   connections. Fifty concurrent Lambdas is then five hundred connections,
   which is several times what a small Postgres will accept. Use a pooling
   endpoint - RDS Proxy, or the pooled connection string a serverless Postgres
   gives you - and keep DB_MAX_CONNECTIONS small.

4. THE FILESYSTEM IS READ-ONLY except /tmp, which is per-environment and not
   durable. Nothing here writes files, but SQLite would silently become a
   scratch database that vanishes - hence the guard below.
"""

from app.db.url import normalise
from lambda_guard import refuse_sqlite

# Before `main` is imported, so a misconfigured deploy fails with one clear
# sentence rather than building an engine around the wrong database first.
# The check itself lives in lambda_guard so it can be tested without importing
# this module - importing this module IS the check.
refuse_sqlite(normalise())

from mangum import Mangum  # noqa: E402  - deliberately after the guard above
from main import app  # noqa: E402

RATE_LIMITER_NOTE = """\
app/core/ratelimit.py is in-process. On Lambda that means per-execution-
environment and reset on every cold start, so the login and 2FA limits are far
weaker than they read. The reset-email cooldown is unaffected - it was moved
onto a users column for this exact reason. Moving the rest to DynamoDB or the
database is the remaining work, and it is security-relevant.
"""

# lifespan="off" because main.py's startup handler is empty - checked, it is a
# bare `pass` - so nothing is lost by not running it, and Mangum then skips the
# lifespan protocol entirely.
#
# IF ANYTHING IS EVER ADDED TO THAT HANDLER, THIS MUST CHANGE TO "auto", or it
# will silently not run. Note also that lifespan here means once per execution
# ENVIRONMENT, not once per deploy: a warm-up that is safe to repeat is fine, a
# migration or a one-time seed is not.
handler = Mangum(app, lifespan="off")
