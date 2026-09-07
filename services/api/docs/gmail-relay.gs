/**
 * MONEVA mail relay - paste this into script.google.com.
 *
 * WHY THIS EXISTS
 * Render blocks outbound SMTP. Not throttled, not misconfigured: the kernel
 * refuses the socket outright -
 *
 *     Reset email over SMTP failed: OSError: [Errno 101] Network is unreachable
 *
 * and a probe of Gmail's 587, 465 and 25 from the running service comes back
 * with all three closed. Correct credentials that log in from a laptop in two
 * seconds cannot leave that host at all, so no amount of fixing the password
 * was ever going to work.
 *
 * Port 443 is not blocked. This is a ten-line web app that receives one HTTPS
 * POST and sends the mail from the Gmail account you are already signed into -
 * no third-party service, no account with anyone, no OAuth client to register.
 *
 * SETUP
 *   1. script.google.com -> New project. Paste this file over Code.gs.
 *   2. Change SHARED_SECRET below to a long random string.
 *   3. Deploy -> New deployment -> type "Web app".
 *        Execute as:      Me
 *        Who has access:  Anyone            <- required; the API is not signed in
 *   4. Authorise it when Google asks (it wants permission to send mail as you).
 *   5. Copy the /exec URL. In Render -> Environment set:
 *        MAIL_RELAY_URL    = that https://script.google.com/macros/s/..../exec
 *        MAIL_RELAY_TOKEN  = the same SHARED_SECRET
 *      and CLEAR SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD, so no send
 *      wastes 24 seconds failing on a blocked port first.
 *   6. Check it: GET /api/health should show route "relay".
 *
 * "Anyone" access means anyone with the URL can reach this script, which is why
 * the token is checked before anything is sent - without it, the URL would be
 * an open mail relay. Treat the URL as a secret regardless.
 *
 * Quota: a free Gmail account may send 100 messages a day through Apps Script.
 * A password reset flow is nowhere near that.
 *
 * THE REPLY MATTERS. Apps Script answers HTTP 200 to everything, including a
 * request it refused, so the API cannot judge success by status code. It
 * requires a body starting with "OK". Every other path here returns something
 * that is deliberately NOT "OK", so a refusal can never read as a sent mail.
 */

const SHARED_SECRET = 'replace-this-with-a-long-random-string';

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return reply('ERROR empty request');
    }

    const body = JSON.parse(e.postData.contents);

    // Compared at full length rather than short-circuiting on the first
    // differing character. The timing difference is tiny over HTTPS, but this
    // costs nothing and the URL is public by necessity.
    if (!constantTimeEquals(String(body.token || ''), SHARED_SECRET)) {
      return reply('FORBIDDEN bad token');
    }

    if (!body.to || !body.subject) {
      return reply('ERROR missing to/subject');
    }

    GmailApp.sendEmail(body.to, body.subject, body.text || '', {
      htmlBody: body.html || undefined,
      name: 'MONEVA',
    });

    return reply('OK sent');
  } catch (err) {
    // Never echo the request back: it carries a live reset code.
    return reply('ERROR ' + err.name);
  }
}

/** A GET is a human checking the URL is alive. It must not send anything. */
function doGet() {
  return reply('OK relay is up (POST to send)');
}

function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  let differences = 0;
  for (let i = 0; i < a.length; i++) {
    differences |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return differences === 0;
}

function reply(text) {
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.TEXT);
}
