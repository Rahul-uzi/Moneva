"""What the password rule must and must not refuse.

Both directions carry a real cost, and they are not symmetric in the way the
usual advice assumes.

A rule that is too loose lets `123456` guard someone's financial history. A
rule that is too tight is worse than it looks: people do not respond to a
refusal by choosing a stronger password, they respond by choosing the smallest
edit that gets past it - `Password1!` - which is weaker than the passphrase
they would have picked if simply asked for length. So the "must accept" tests
below matter as much as the "must refuse" ones.
"""

from app.core.passwords import MIN_LENGTH, password_problem


def refused(pw: str, **kw) -> bool:
    return password_problem(pw, **kw) is not None


class TestRefuses:
    def test_the_password_that_started_this(self):
        # Six characters was the old minimum, so this was valid.
        assert refused("123456")

    def test_short_passwords(self):
        assert refused("abc")
        assert refused("Tr0ub4d")          # nine, and would otherwise look fine

    def test_the_top_of_every_leaked_list(self):
        assert refused("password")
        assert refused("qwertyuiop")
        assert refused("iloveyou")
        assert refused("letmein")

    def test_a_common_password_wearing_a_number(self):
        """The whole point of stripping decoration.

        Told to add characters, people append a year. `password2026` is not a
        different password from `password` - it is the same first guess with a
        suffix any cracking rule appends automatically.
        """
        assert refused("password123")
        assert refused("Password1!")
        assert refused("qwerty2026")
        assert refused("iloveyou@1")

    def test_digits_only(self):
        # Long enough to pass the length rule and still trivial.
        assert refused("1029384756")
        assert refused("11111111111111")

    def test_the_users_own_name(self):
        assert refused("rahulsecure2026", email="rahul@example.com")
        assert refused("MyDhimanAccount", display_name="Rahul Dhiman")

    def test_the_email_local_part(self):
        # The exact shape people pick when asked for something longer.
        assert refused("rahul.dhiman@2026", email="rahul.dhiman@gmail.com")

    def test_nothing_at_all(self):
        assert refused("")
        assert password_problem(None) is not None


class TestAccepts:
    def test_an_ordinary_passphrase(self):
        assert not refused("correct horse battery")

    def test_a_reasonable_mixed_password(self):
        assert not refused("Jhelum-Tea-91")

    def test_exactly_the_minimum_length(self):
        # Boundary, from the permissive side: the rule is "at least", and an
        # off-by-one here would refuse a password the message just promised.
        pw = "a" * MIN_LENGTH
        assert len(pw) == MIN_LENGTH
        assert not refused(pw)

    def test_a_short_name_does_not_poison_everything(self):
        """Names under four characters are ignored on purpose.

        Refusing every password containing "raj" would reject far more good
        passwords than bad ones - the substring turns up inside ordinary words.
        """
        assert not refused("marajahstables", email="raj@example.com")

    def test_leading_and_trailing_spaces_are_kept(self):
        # A space is a character. Trimming it would store a password that
        # cannot be typed back in.
        assert not refused("  quiet river  ")

    def test_a_name_that_merely_resembles_the_email(self):
        assert not refused("rahulasthanavox", email="different@example.com")


class TestTheMessage:
    def test_says_what_would_be_accepted(self):
        """A refusal that does not say the target is a riddle.

        Someone who cannot tell what would satisfy the rule guesses, and their
        guess is `Password1!`. The number has to be in the sentence.
        """
        msg = password_problem("abc")
        assert msg is not None
        assert str(MIN_LENGTH) in msg

    def test_does_not_blame_the_user(self):
        msg = password_problem("password123")
        assert msg is not None
        # Says why it is weak - it is guessed early - rather than calling the
        # person careless.
        assert "guessed early" in msg
