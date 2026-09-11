/**
 * An HTTPS mail relay, hosted on your own Google account.
 *
 * WHY THIS EXISTS. Render blocks outbound SMTP ports to deter spam, so correct
 * Gmail credentials produce a connection that simply times out and no mail is
 * ever sent - with nothing in the logs to say why, because a blocked port does
 * not refuse, it never answers. Port 443 is not blocked anywhere. This runs
 * under the Gmail account you already have, needs an account with no third
 * party, and is reached by one POST.
 *
 * ---------------------------------------------------------------------------
 * SETUP
 *
 *   1. script.google.com -> New project. Paste this in.
 *   2. Project Settings (the gear) -> Script Properties -> Add script property
 *        Property: SHARED_SECRET
 *        Value:    40+ random characters, generated fresh
 *   3. Deploy -> New deployment -> Web app
 *        Execute as:      Me
 *        Who has access:  Anyone
 *   4. Copy the /exec URL.
 *   5. In Render -> Environment:
 *        MAIL_RELAY_URL   = that /exec URL
 *        MAIL_RELAY_TOKEN = the same value as SHARED_SECRET
 *
 * ROTATING THE SECRET. Change the Script Property, redeploy (Manage
 * deployments -> Edit -> Deploy keeps the same URL), then update
 * MAIL_RELAY_TOKEN in Render. Mail stops working in between, so do both
 * quickly.
 * ---------------------------------------------------------------------------
 *
 * THE SECRET IS NOT IN THIS FILE, ON PURPOSE.
 *
 * It used to be a const at the top, and that is how it leaks: this file gets
 * pasted into a chat, screenshotted, committed, or shared with someone helping
 * out, and the token goes with it every time. A Script Property stays in the
 * project - it is not in the source, so it is not in the copy.
 *
 * That matters more here than it looks. The deployment URL has to be reachable
 * by anyone, because Render calls it from an address that cannot be
 * predicted. The token is therefore the ONLY thing between this URL and being
 * an open mail relay that sends as you, from your address, with your
 * reputation attached.
 */

/** Read once per execution. Throws if unset, rather than defaulting to open. */
function sharedSecret() {
  const value = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!value) {
    // A missing property must fail closed. Falling back to '' would compare
    // every request against the empty string and accept the ones that send it.
    throw new Error('SHARED_SECRET script property is not set');
  }
  return value;
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return reply('ERROR empty request');

    const body = JSON.parse(e.postData.contents);

    if (!constantTimeEquals(String(body.token || ''), sharedSecret())) {
      return reply('FORBIDDEN bad token');
    }
    if (!body.to || !body.subject) return reply('ERROR missing to/subject');

    GmailApp.sendEmail(body.to, body.subject, body.text || '', {
      htmlBody: body.html || undefined,
      name: 'MONEVA',
    });

    // Apps Script answers HTTP 200 to everything, including what it refused,
    // so the API judges success on this word, not the status code.
    return reply('OK sent');
  } catch (err) {
    // Never echo the request back - it carries a live reset or confirmation
    // code. The name alone is enough to tell a parse failure from a send
    // failure, and carries none of the payload.
    return reply('ERROR ' + err.name);
  }
}

function doGet() {
  return reply('OK relay is up (POST to send)');
}

/**
 * Compare two secrets without revealing anything by how long it takes.
 *
 * The digests, not the strings. Comparing the raw values had to return early
 * when the lengths differed, and that early return is itself an answer: an
 * attacker timing the response learns the token's length, which turns an
 * impossible search into a merely large one. Two SHA-256 digests are always
 * 32 bytes, so the loop below runs for exactly the same time whatever is sent.
 */
function constantTimeEquals(a, b) {
  const da = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, a);
  const db = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

function reply(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}
