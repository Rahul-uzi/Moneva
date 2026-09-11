/**
 * Keeps the Render service awake, from Google's infrastructure.
 *
 * WHY NOT THE GITHUB ACTION. It was measured over the first 12 hours: a cron
 * asking for a run every 10 minutes produced FOUR runs, with gaps of 2h09m,
 * 2h29m, 2h00m and 4h38m. GitHub throttles scheduled workflows on
 * low-activity repositories, and asking more often does not help - the
 * shortfall is an order of magnitude, not a few minutes.
 *
 * The consequence was the opposite of the intent: Render sleeps 15 minutes
 * after the last request, so each late ping WOKE the service rather than
 * keeping it awake, and it slept again a quarter of an hour later. About three
 * hours awake out of twenty-four.
 *
 * Apps Script triggers fire on time. The minimum interval is five minutes,
 * which is comfortably inside Render's fifteen.
 *
 * WHY HERE. This account already runs an Apps Script for the mail relay, so
 * this needs no new service, no new account and no billing details - and it
 * runs whether or not any computer of yours is switched on.
 *
 * ---------------------------------------------------------------------------
 * SETUP (once, about two minutes)
 *
 *   1. script.google.com -> New project. Paste this file in.
 *   2. Run `install` once. Google will ask for permission to make external
 *      requests; approve it.
 *   3. Done. `ping` now runs every five minutes, forever.
 *
 * To check it is working: Executions in the left sidebar shows every run.
 * To stop it: run `uninstall`.
 * ---------------------------------------------------------------------------
 *
 * WHAT THIS DOES NOT FIX. Two things, both worth knowing before relying on it:
 *
 *   - Keeping one service awake round the clock consumes about 744 of the 750
 *     free compute hours Render allows per month, across the whole account.
 *     There is no room for a second free service alongside it.
 *   - Render's free Postgres expires after about 30 days regardless. Nothing
 *     here touches that, and when it goes, the data goes.
 *
 * This buys speed now. It is not a substitute for a paid plan.
 */

// A real application route. Render's edge answers /robots.txt itself while the
// service is asleep, so pinging that returns 200 and nothing ever wakes.
const HEALTH_URL = 'https://moneva.onrender.com/api/health';

// Five is the smallest interval Apps Script allows, and Render's window is
// fifteen - so two pings can be missed entirely before anything sleeps.
const EVERY_MINUTES = 5;

function ping() {
  const started = Date.now();
  try {
    const res = UrlFetchApp.fetch(HEALTH_URL, {
      muteHttpExceptions: true,   // a 5xx is information, not a reason to throw
      followRedirects: true,
      validateHttpsCertificates: true,
    });
    const seconds = Math.round((Date.now() - started) / 1000);

    // The elapsed time is the useful half. Under a second means the service
    // was already awake and the schedule is holding. Twenty or more means it
    // had gone to sleep and this call is what woke it - which says a ping was
    // missed, and a real user arriving first would have waited that long.
    if (seconds >= 20) {
      console.warn('Service was asleep: ' + seconds + 's to answer. A ping was missed.');
    } else {
      console.log('awake in ' + seconds + 's (HTTP ' + res.getResponseCode() + ')');
    }
  } catch (err) {
    // Never rethrow. A failed ping is one missed beat; a trigger that throws
    // repeatedly gets disabled by Google, which would stop the pinging
    // silently and leave the service asleep with nothing to say so.
    console.error('ping failed: ' + err);
  }
}

/** Run once, by hand. Safe to run again - it clears its own old triggers. */
function install() {
  uninstall();
  ScriptApp.newTrigger('ping').timeBased().everyMinutes(EVERY_MINUTES).create();
  ping();   // prove it works now rather than in five minutes
  console.log('Installed. Pinging every ' + EVERY_MINUTES + ' minutes.');
}

/** Stops the pinging. */
function uninstall() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'ping')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  console.log('Stopped.');
}
