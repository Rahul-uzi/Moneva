"""What counts as a password here.

The minimum was six characters and nothing else, which made `123456` a valid
password on an app that holds someone's entire financial history. Length alone
is also not the answer: `password` is eight characters and is guessed first.

Three rules, in the order they actually stop attacks:

  1. **Length.** Ten, not eight. Every offline-guessing estimate moves by
     orders of magnitude per character, and the cost to a person choosing a
     passphrase is two extra keystrokes.
  2. **Not a known-common password.** Guessing does not proceed alphabetically;
     it proceeds down a list, and the top few thousand entries account for a
     large share of real compromises. A password on that list is not weak
     because of its shape - it is weak because it is *someone else's* first
     guess.
  3. **Not derived from what the attacker already knows.** An address is
     public and a display name is on the screen. `rahul@2026` for
     rahul@example.com defeats length and the common-list at once, and is
     exactly what people pick when told to make it longer.

WHY A BUNDLED LIST RATHER THAN HAVE I BEEN PWNED.

HIBP's k-anonymity API is better data - hundreds of millions of real breached
passwords against a few thousand here. It is not used because registration
would then depend on a third-party HTTP call completing: the API is on the
critical path of the one action a new user cannot retry around, and this
backend already has one hard-won lesson about outbound network calls that
simply never answer (see render.yaml on SMTP). The list below needs no network
and cannot fail.

If registration ever gets slack to spend, HIBP as a *supplementary* check -
advisory, never blocking, failing open on timeout - is the upgrade.
"""

from __future__ import annotations

import re
from typing import Optional

MIN_LENGTH = 10
MAX_LENGTH = 128

# The passwords that appear at the top of every leaked-credential list, plus
# the ones this app invites specifically - its own name, and the rupee-adjacent
# words an Indian user reaches for. Deliberately short: this is not meant to be
# a dictionary, only to refuse the first few thousand guesses. Compared
# case-insensitively and after stripping trailing digits, so `password123` and
# `Password1` are both caught by the single entry `password`.
_COMMON = frozenset(
    """
    password passw0rd pass welcome welcome1 admin administrator root toor
    qwerty qwertyuiop asdfgh zxcvbn 1q2w3e4r qazwsx
    123456 12345678 123456789 1234567890 111111 000000 121212 abc123 a1b2c3
    iloveyou letmein monkey dragon sunshine princess football baseball master
    superman batman trustno1 whatever shadow michael jennifer jordan hunter
    login guest test testing demo sample changeme secret temp
    india indian bharat mumbai delhi chennai kolkata bangalore hyderabad
    rupee rupees paisa money cash bank banking finance wallet
    moneva monevaapp
    krishna ganesh shivam rahul rohit amit sachin priya pooja neha
    """.split()
)

# Trailing digits and punctuation are what people add when a rule demands more
# characters. Stripping them before the list check means one entry covers the
# whole family.
#
# One character class rather than two in sequence, because the decoration comes
# in whatever order the person typed it. Digits-then-punctuation caught
# `password1!` and missed `iloveyou@1`, which is the same password.
_DECORATION = re.compile(r"[0-9!@#$%^&*_.\-]*$")


def _normalise(password: str) -> str:
    """Lowercased, with the usual trailing decoration removed."""
    return _DECORATION.sub("", password.strip().lower())


def _tokens(*sources: Optional[str]) -> list[str]:
    """Words worth refusing, taken from what the attacker already knows.

    An email yields its local part and the parts of that ("rahul.dhiman" gives
    "rahul" and "dhiman"); a display name yields its words. Anything under four
    characters is dropped - refusing every password containing a three-letter
    name would reject far more good passwords than bad ones.
    """
    out: list[str] = []
    for source in sources:
        if not source:
            continue
        local = source.split("@")[0]
        for part in re.split(r"[^a-zA-Z0-9]+", local):
            if len(part) >= 4:
                out.append(part.lower())
    return out


def password_problem(
    password: str,
    *,
    email: Optional[str] = None,
    display_name: Optional[str] = None,
) -> Optional[str]:
    """The reason this password is refused, or None if it is fine.

    Returns a sentence for the user, not a code. Each one says what to do
    instead - "too short" with no target length is a riddle, and a person who
    cannot tell what would satisfy the rule tries `Password1!` next.
    """
    if password is None:
        return "Enter a password."

    # Not stripped: leading and trailing spaces are legitimate characters in a
    # password, and silently trimming them would mean a password that cannot be
    # typed back in.
    if len(password) < MIN_LENGTH:
        return f"Use at least {MIN_LENGTH} characters. A short phrase you will remember works well."

    if len(password) > MAX_LENGTH:
        return f"Keep it under {MAX_LENGTH} characters."

    # Before the stem, not after. A digits-only password normalises to the
    # empty string - the decoration stripper eats all of it - so guarding this
    # on a non-empty stem skipped exactly the passwords it was meant to catch.
    if all(ch.isdigit() for ch in password):
        return "Digits alone are quick to guess. Add some words."

    stem = _normalise(password)

    if stem in _COMMON:
        return "That is one of the most commonly used passwords, so it is guessed early. Pick something else."

    for token in _tokens(email, display_name):
        if token and token in password.lower():
            return "That contains your name or email address, which is the first thing anyone tries. Pick something else."

    return None
