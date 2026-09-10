import uuid
from datetime import datetime, timezone
from sqlalchemy import Text, Column, String, Integer, SmallInteger, BigInteger, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    display_name = Column(String, nullable=False)
    currency = Column(String, default="INR", nullable=False)
    timezone = Column(String, default="UTC", nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    notif_bills = Column(Boolean, default=True, nullable=False)
    notif_budgets = Column(Boolean, default=True, nullable=False)
    notif_goals = Column(Boolean, default=True, nullable=False)
    notif_salary = Column(Boolean, default=True, nullable=False)

    # Profile picture: a data URL (image/jpeg;base64) resized client-side to 256x256.
    # Kept inline rather than on disk so the mobile client works without a static file host.
    avatar_data_url = Column(Text, nullable=True)

    # TOTP two-factor authentication
    totp_secret = Column(String, nullable=True)          # base32, only set once 2FA is enabled
    totp_enabled = Column(Boolean, default=False, nullable=False)
    totp_recovery_codes = Column(Text, nullable=True)    # JSON list of bcrypt hashes, single-use

    # Password reset. Stored as a bcrypt hash for the same reason the recovery
    # codes above are: a leaked database must not hand over a live reset code.
    # Single-use and short-lived; `attempts` caps guessing at a six-digit code
    # even inside the expiry window.
    reset_code_hash = Column(String, nullable=True)
    reset_code_expires_at = Column(DateTime(timezone=True), nullable=True)
    reset_code_attempts = Column(SmallInteger, default=0, nullable=False)

    # Bumped to invalidate every token already issued for this account. Cheaper
    # than a server-side session store: the version is a claim inside the token,
    # so revocation is one integer write and needs no lookup table.
    token_version = Column(Integer, default=0, nullable=False)

    # Email ownership.
    #
    # Until this exists, an address is only a claim. Anyone could register with
    # anyone else's email, which squats it so the real owner cannot sign up -
    # and, far more common and far worse, a typo means the account is attached
    # to an address the person cannot read. They notice the day they forget
    # their password, and by then the ledger is unreachable: reset codes go to
    # a mailbox that is not theirs.
    #
    # The gate is soft on purpose. An unverified user may use the app; what
    # they may not do is change the address, because that is the one action
    # that turns an unverified account into a permanently stolen one.
    email_verified = Column(Boolean, default=False, nullable=False)
    verify_code_hash = Column(String, nullable=True)
    verify_code_expires_at = Column(DateTime(timezone=True), nullable=True)
    verify_code_attempts = Column(SmallInteger, default=0, nullable=False)
    # Throttles resends per account, independently of the IP rate limiter.
    verify_code_sent_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    accounts = relationship("Account", back_populates="user", cascade="all, delete-orphan")
    transactions = relationship("Transaction", back_populates="user", cascade="all, delete-orphan")
    categories = relationship("Category", back_populates="user", cascade="all, delete-orphan")
    budgets = relationship("Budget", back_populates="user", cascade="all, delete-orphan")
    savings_goals = relationship("SavingsGoal", back_populates="user", cascade="all, delete-orphan")
    bills = relationship("Bill", back_populates="user", cascade="all, delete-orphan")
    refresh_sessions = relationship("RefreshSession", back_populates="user", cascade="all, delete-orphan")
    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")
    recurring_incomes = relationship("RecurringIncome", back_populates="user", cascade="all, delete-orphan")
    sync_metadata = relationship("SyncMetadata", back_populates="user", cascade="all, delete-orphan")
    emis = relationship("Emi", back_populates="user", cascade="all, delete-orphan")


class RefreshSession(Base):
    """One device's signed-in session, and the chain of refresh tokens it used.

    WHY THIS EXISTS AT ALL.

    A refresh token used to be a bearer credential good for sixty days and
    reusable without limit. Stolen once - off a backed-up device, out of an
    intercepted response, from storage on a rooted phone - it granted sixty
    days of quiet access, and nothing anywhere could tell. The account owner
    stayed signed in throughout, because the thief's use of the token did not
    disturb theirs. There was no signal to notice and no record to check.

    Rotation fixes the silence rather than the theft. Each refresh mints a new
    token and retires the one presented, so a stolen token is only good until
    the real device refreshes next - minutes, normally. What matters more is
    what happens AFTERWARDS: whoever refreshes second presents a token that has
    already been used, and a used token coming back is not something a working
    client ever does. It means two parties hold the same credential.

    At that point the honest response is to disbelieve both. `revoke_family`
    kills the whole chain, and the real owner signs in again - an inconvenience
    that tells them something happened, which is strictly better than a thief
    with sixty silent days.

    The same rows answer a question the app could not answer before: which
    devices are signed in, and when was each last used. That is the "3 devices"
    list, and it comes free.

    NOT stored here: the token itself. Only its jti, and only hashed - a leaked
    database must not hand over live sessions, exactly as with reset codes and
    recovery codes.
    """

    __tablename__ = "refresh_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Every token descended from one sign-in shares a family. Reuse anywhere in
    # the chain condemns all of it, because there is no way to tell which half
    # of the fork is the honest one.
    family_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    # sha256 of the jti, not the jti. Indexed because every refresh looks it up.
    jti_hash = Column(String(64), nullable=False, unique=True, index=True)

    # Set the moment this token is exchanged. A second presentation after that
    # is the signal the whole design turns on.
    used_at = Column(DateTime(timezone=True), nullable=True)

    # Set when the family is condemned, by reuse or by the user ending the
    # session deliberately. Either way the row stays, so the event is auditable.
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    # Why it ended, for the screen that shows sessions: "you", or "reuse".
    revoked_reason = Column(String(32), nullable=True)

    # For the session list. Best-effort and self-reported by the client, so it
    # is a label rather than an identity - never used to make a decision.
    device_label = Column(String(120), nullable=True)
    last_ip = Column(String(45), nullable=True)          # 45 fits IPv6

    issued_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    last_seen_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    user = relationship("User", back_populates="refresh_sessions")


class Account(Base):
    __tablename__ = "accounts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    account_type = Column(String, nullable=False)  # asset or liability
    currency = Column(String, default="INR", nullable=False)
    opening_balance_minor = Column(BigInteger, default=0, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    # Credit-card billing terms. Null on every other kind of account, which is
    # also how an account is recognised AS a card - both days set. A separate
    # is_card flag would be a second source of truth able to disagree with the
    # days it depends on.
    #
    # Days are stored as given, 1-31, and clamped into the month at read time:
    # a card that closes on the 31st still closes in February, and rewriting it
    # to 28 here would move that card's closing date in every other month.
    statement_day = Column(SmallInteger, nullable=True)
    due_day = Column(SmallInteger, nullable=True)
    credit_limit_minor = Column(BigInteger, nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    user = relationship("User", back_populates="accounts")
    transactions_source = relationship("Transaction", foreign_keys="Transaction.account_id", back_populates="account")
    transactions_target = relationship("Transaction", foreign_keys="Transaction.to_account_id", back_populates="to_account")


class Category(Base):
    __tablename__ = "categories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)  # Nullable for global defaults
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # income or expense
    icon = Column(String, nullable=True)
    color = Column(String, nullable=True)
    is_default = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    user = relationship("User", back_populates="categories")
    transactions = relationship("Transaction", back_populates="category")
    budgets = relationship("Budget", back_populates="category")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    to_account_id = Column(UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)  # For transfers
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    savings_goal_id = Column(UUID(as_uuid=True), ForeignKey("savings_goals.id", ondelete="SET NULL"), nullable=True)
    transaction_type = Column(String, nullable=False)  # income, expense, transfer
    #: A correction the user made when the running balance had drifted from the
    #: real one - a missed cash spend, a payment the parser never saw, a wrong
    #: opening balance. It is a real ledger event, so it MOVES the balance like
    #: any income or expense, but it is not something the person spent or
    #: earned, so every spending figure excludes it. Without that exclusion a
    #: reconciliation would show up as the largest purchase of the month.
    is_adjustment = Column(Boolean, default=False, nullable=False)
    amount_minor = Column(BigInteger, nullable=False)
    currency = Column(String, nullable=False)
    description = Column(String, nullable=True)
    transaction_date = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    client_mutation_id = Column(UUID(as_uuid=True), unique=True, index=True, nullable=False)  # Idempotency token
    device_id = Column(String, nullable=False)
    sync_status = Column(String, default="synced", nullable=False)  # synced, pending, failed
    version = Column(Integer, default=1, nullable=False)

    # Relationships
    user = relationship("User", back_populates="transactions")
    account = relationship("Account", foreign_keys=[account_id], back_populates="transactions_source")
    to_account = relationship("Account", foreign_keys=[to_account_id], back_populates="transactions_target")
    category = relationship("Category", back_populates="transactions")
    savings_goal = relationship("SavingsGoal", back_populates="transactions")


class RecurringIncome(Base):
    __tablename__ = "recurring_incomes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source = Column(String, nullable=False)
    amount_minor = Column(BigInteger, nullable=False)
    frequency = Column(String, nullable=False)  # monthly, weekly, etc.
    next_occurrence = Column(DateTime(timezone=True), nullable=False)
    # The day of the month the stream is anchored to. Advancing from
    # next_occurrence alone drifts: a 31st salary clamps to 28 in February
    # and stays there. Nullable for rows written before this existed.
    anchor_day = Column(SmallInteger, nullable=True)
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    user = relationship("User", back_populates="recurring_incomes")


class Bill(Base):
    __tablename__ = "bills"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    amount_minor = Column(BigInteger, nullable=False)
    currency = Column(String, default="INR", nullable=False)
    due_date = Column(DateTime(timezone=True), nullable=False)
    recurrence = Column(String, nullable=True)  # monthly, weekly, yearly, one-time
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    status = Column(String, default="upcoming", nullable=False)  # upcoming, due, overdue, paid, cancelled
    reminder_enabled = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    user = relationship("User", back_populates="bills")


class Budget(Base):
    __tablename__ = "budgets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    limit_amount_minor = Column(BigInteger, nullable=False)
    period = Column(String, default="monthly", nullable=False)
    start_date = Column(DateTime(timezone=True), nullable=False)
    end_date = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    user = relationship("User", back_populates="budgets")
    category = relationship("Category", back_populates="budgets")


class SavingsGoal(Base):
    __tablename__ = "savings_goals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    target_amount_minor = Column(BigInteger, nullable=False)
    target_date = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, default="active", nullable=False)  # active, completed, paused
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    user = relationship("User", back_populates="savings_goals")
    transactions = relationship("Transaction", back_populates="savings_goal")


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    message = Column(String, nullable=False)
    notification_type = Column(String, nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    dedup_key = Column(String, nullable=True, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    user = relationship("User", back_populates="notifications")


class SyncMetadata(Base):
    __tablename__ = "sync_metadata"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    device_id = Column(String, nullable=False)
    client_mutation_id = Column(UUID(as_uuid=True), nullable=True)
    sync_status = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    version = Column(Integer, default=1, nullable=False)

    # Relationships
    user = relationship("User", back_populates="sync_metadata")


class Emi(Base):
    """A purchase converted into instalments.

    Not a transaction. An EMI is a commitment that shows up nowhere in a
    month's spending until the month it lands in, which is exactly how people
    end up with more of them running at once than they meant to - the phone,
    the laptop and the fridge each looked affordable on its own.

    It is deliberately NOT derived from the ledger. The bank takes the
    instalment whether or not the app saw the alert, so a plan reconstructed
    from captured payments would under-report the moment one notification was
    missed, and tell somebody they owe less than they do. What the user enters
    once - the instalment, how many, when it started - is the truth, and the
    calendar does the rest.
    """
    __tablename__ = "emis"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Which card or loan account it is charged to. Nullable, because plenty of
    # people are paying off something on a card they have not added here, and
    # refusing to record the commitment until they do would lose the very
    # figure this table exists to keep.
    account_id = Column(UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)

    name = Column(String, nullable=False)
    monthly_minor = Column(BigInteger, nullable=False)
    months = Column(SmallInteger, nullable=False)

    # The first instalment. Progress is counted forward from this date, so it
    # is the one field that must be right.
    started_at = Column(DateTime(timezone=True), nullable=False)

    currency = Column(String, default="INR", nullable=False)

    # Closed by hand - a plan settled early, or entered wrong. A finished plan
    # is not closed: it stays, and is reported as finished from its own dates,
    # so the history of what was being paid off stays readable.
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    user = relationship("User", back_populates="emis")
