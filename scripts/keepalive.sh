#!/usr/bin/env sh
# Keep the Render free service awake.
#
# A free web service spins down after 15 minutes without traffic, and waking it
# takes up to a minute. Measured on this deployment: 42.9 seconds, of which
# 0.14 was the network. That is the whole "the app takes 30 seconds to load"
# problem - the client is already fetching in parallel and showing a skeleton.
#
# READ THIS BEFORE RELYING ON IT.
#
#   1. Free compute is 750 hours a month across the WHOLE account. A 31-day
#      month is 744 hours, so keeping one service awake round the clock fits
#      with six hours to spare and nothing left over for a second one.
#
#   2. It does not save the database. Render's free Postgres expires after
#      about 30 days - render.yaml says so in its own comment - and no amount
#      of pinging changes that. When it goes, the data goes.
#
#   3. Do NOT ping /robots.txt. Render's edge answers that itself while the
#      service is asleep, so the ping returns 200 and the app never wakes. It
#      has to be a route the application actually serves.
#
# So: a stopgap for testing, not a plan. The $7 Starter plan is the fix.
#
#   ./scripts/keepalive.sh            # ping once
#   ./scripts/keepalive.sh --loop     # ping every 14 minutes until stopped

URL="${MONEVA_HEALTH_URL:-https://moneva.onrender.com/api/health}"
INTERVAL="${MONEVA_PING_INTERVAL:-840}"   # 14 minutes; the limit is 15

ping_once() {
    started=$(date +%s)
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 120 "$URL")
    elapsed=$(( $(date +%s) - started ))

    # The elapsed time is the useful half of the output. A ping that answers in
    # under a second found the service already awake; one that takes forty
    # means it had gone to sleep and this call is what woke it - which says the
    # schedule is not keeping up.
    if [ "$code" = "200" ]; then
        printf '%s  awake   %2ss\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$elapsed"
    else
        printf '%s  FAILED  %2ss  (HTTP %s)\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$elapsed" "$code"
    fi
}

if [ "$1" = "--loop" ]; then
    echo "Pinging $URL every ${INTERVAL}s. Ctrl-C to stop."
    while true; do
        ping_once
        sleep "$INTERVAL"
    done
else
    ping_once
fi
