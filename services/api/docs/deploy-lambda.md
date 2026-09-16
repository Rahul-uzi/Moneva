# Running the MONEVA API on AWS Lambda

The same FastAPI app, behind Mangum. `main.app` is unchanged — there is no
second copy of the API to keep in step.

## Deploy

```bash
cd services/api
sam build
sam deploy --guided
```

`sam build` reads `Dockerfile.lambda`; `sam deploy` asks for the five
parameters in `template.yaml` and prints the Function URL. Point the app's
`VITE_API_URL` at it.

Migrations do **not** run from the function. Run them from a machine that can
reach the database, before the new image goes live:

```bash
DATABASE_URL="postgresql://..." alembic upgrade head
```

## Three things that must be right

### The database must be Postgres, and pooled

`lambda_guard.py` refuses to start on SQLite, including the case where
`DATABASE_URL` is simply unset — `normalise()` falls back to a local file, so
without that check the function would come up healthy and lose every write to a
filesystem that is discarded when the execution environment is recycled.

Pooled matters separately. The engine is built with `pool_size 5` and
`max_overflow 5`, so **each execution environment** can hold ten connections.
Twenty concurrent functions is two hundred, which is more than a small Postgres
will accept. Either use a pooling endpoint (RDS Proxy, or the pooled string a
serverless Postgres gives you) or keep `ReservedConcurrentExecutions` low — the
template sets 20, which is a ceiling on connections as much as on traffic.

### Mail must go over the relay, not SMTP

Set `MAIL_RELAY_URL` and `MAIL_RELAY_TOKEN`. Leave `SMTP_*` unset.

Starlette awaits background tasks **inside** the ASGI call — `await
self.background()` at `starlette/responses.py:169`, after the body is sent.
Under uvicorn the socket is already flushed, so the caller has their answer and
the send happens behind them. Under Mangum nothing reaches the caller until the
ASGI call returns, so the send happens while they wait.

That is the whole reason the mailer was made a background task: a blocked SMTP
port does not fail fast, it hangs until the socket times out — around twenty
seconds, measured. On Lambda that is twenty seconds of billed time and a caller
who has given up. The relay is one POST to 443, which no host blocks and which
fails in milliseconds when it fails.

The app already prefers whichever transport is configured, so this is
configuration, not code.

### The rate limiter gets weaker, and this is not fixed

`app/core/ratelimit.py` keeps its counters in the worker's memory. That is
correct for one long-lived process and close to useless here: every concurrent
execution environment has its own counters, and every cold start starts them
again.

So `LOGIN_BY_ACCOUNT = 8 per 15 minutes` becomes 8 per environment, and there
can be many at once. The login and 2FA limits read stronger than they are.

The reset-email cooldown is unaffected — it sits on a `users` column precisely
because an in-memory counter could not survive a worker that sleeps. Moving the
rest to DynamoDB or the database is the outstanding work, and it is
security-relevant rather than cosmetic.

## Choices in the template, and why

**No VPC.** A Lambda in a VPC has no route to the internet without a NAT
gateway, which costs roughly as much per month as everything else here
together. This function needs the internet for the mail relay and the Gemini
API. Staying outside means the database must be reachable publicly — a
serverless Postgres, or RDS with public access and tight security groups.

**A Function URL, not API Gateway.** The app already does its own CORS, auth
and routing; API Gateway would be a second router in front of the one that
works, at its own per-request cost. API Gateway earns its place when you want
WAF, usage plans, or a custom domain with mTLS.

**arm64, 1024 MB, 20s.** arm64 is cheaper per millisecond and every wheel here
has one. The memory is not about memory: Lambda scales CPU with it, and this
app's slowest moment is bcrypt on a login, by design — at 512 MB a sign-in is
slower for no saving, because the billed milliseconds rise as fast as the price
per millisecond falls.

**A container image, not a zip.** Measured: the installed dependencies come to
about 200 MB without the development ones, against a 250 MB unzipped limit for
a zip. `google-generativeai` pulls in `googleapiclient` (100 MB) and `grpc`
(13 MB). Splitting that across layers would mean artefacts that have to be kept
in step; a container allows 10 GB and needs none of it.

## What this does and does not solve

It removes the sleeping-instance problem — there is no instance to sleep, so
there is no 40-second wake. Lambda has its own cold start, smaller but not
zero, and `ReservedConcurrentExecutions` bounds cost and connections at the
price of queuing a burst.

It does not remove the keepalive question so much as change it: nothing needs
pinging to stay awake, but a function that has not run recently still pays a
cold start on the next request.
