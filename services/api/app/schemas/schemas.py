import uuid
from datetime import datetime, timezone
from typing import Optional, List, Annotated
from pydantic import BaseModel, Field, EmailStr, field_validator, AfterValidator


def _ensure_utc(value: datetime) -> datetime:
    """Stamps a naive timestamp as UTC.

    Everything here is stored in UTC, but SQLite has no timezone type, so it
    hands back naive datetimes and the API serialised them without an offset.
    A browser reads an offset-less timestamp as LOCAL time, so clients showed
    every stored date shifted by their own UTC offset. Postgres already
    returns aware values and is left untouched.
    """
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


#: A timestamp that always crosses the wire with an explicit UTC offset.
UtcDateTime = Annotated[datetime, AfterValidator(_ensure_utc)]

# ----------------- AUTH & TOKEN SCHEMAS -----------------
class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class UserLogin(BaseModel):
    email: str = Field(pattern=r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')
    password: str = Field(min_length=1, max_length=128)


# ----------------- USER & PROFILE SCHEMAS -----------------
class UserBase(BaseModel):
    email: str = Field(pattern=r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')
    display_name: str = Field(min_length=1, max_length=100)
    currency: Optional[str] = "INR"
    timezone: Optional[str] = "UTC"

class UserCreate(UserBase):
    password: str = Field(min_length=6, max_length=128)

class UserProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    currency: Optional[str] = None
    timezone: Optional[str] = None

class UserResponse(UserBase):
    id: uuid.UUID
    is_active: bool
    avatar_data_url: Optional[str] = None
    totp_enabled: bool = False
    created_at: UtcDateTime
    updated_at: UtcDateTime

    class Config:
        from_attributes = True

class CurrencyChangeRequest(BaseModel):
    currency: str = Field(min_length=3, max_length=3)
    # Amounts are converted at the live rate unless `rate` is supplied, which is
    # kept so a caller can pin a specific rate if it ever needs to.
    convert: bool = True
    rate: Optional[float] = Field(default=None, gt=0, le=100000)

class CurrencyChangeResponse(BaseModel):
    currency: str
    converted: bool
    rate: Optional[float] = None
    rate_as_of: Optional[str] = None
    rows_updated: int


# ----------------- AVATAR SCHEMAS -----------------
# Avatars arrive as data URLs the client has already downscaled to 256x256 JPEG.
MAX_AVATAR_CHARS = 700_000  # ~500 KB of base64, generous for a 256px JPEG

class AvatarUpdate(BaseModel):
    avatar_data_url: str = Field(min_length=32, max_length=MAX_AVATAR_CHARS)

    @field_validator("avatar_data_url")
    @classmethod
    def must_be_image_data_url(cls, v: str) -> str:
        if not v.startswith("data:image/"):
            raise ValueError("avatar_data_url must be a data:image/* URL")
        if ";base64," not in v:
            raise ValueError("avatar_data_url must be base64 encoded")
        return v


# ----------------- TWO-FACTOR (TOTP) SCHEMAS -----------------
class TotpSetupResponse(BaseModel):
    secret: str
    otpauth_uri: str
    qr_svg: str

class TotpCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=10)

class TotpEnableResponse(BaseModel):
    totp_enabled: bool
    recovery_codes: List[str]

class TotpDisableRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=6, max_length=10)

class TwoFactorChallengeResponse(BaseModel):
    requires_2fa: bool = True
    challenge_token: str

class TotpVerifyRequest(BaseModel):
    challenge_token: str
    code: str = Field(min_length=6, max_length=10)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(pattern=r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')


class ForgotPasswordResponse(BaseModel):
    """
    Deliberately says nothing about whether the address has an account.

    `delivery_configured` is about the SERVER, not the address - it tells the
    app whether email is switched on at all, so it can say "check the server
    log" during development instead of "check your inbox" for a mail that was
    never sent.
    """
    message: str
    delivery_configured: bool


class ResetPasswordRequest(BaseModel):
    email: str = Field(pattern=r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$')
    # Either the six-digit code from the email, or an unused 2FA recovery code
    # - which is longer, so the range covers both.
    code: str = Field(min_length=6, max_length=32)
    new_password: str = Field(min_length=6, max_length=128)


class PasswordChangeRequest(BaseModel):
    # Optional: the app sets a new password directly for an already-authenticated
    # session. When supplied it is still verified.
    current_password: Optional[str] = None
    # Length is enforced in the route (8 chars) so the user gets one clear message
    # instead of a schema error that contradicts it.
    new_password: str = Field(min_length=1, max_length=128)


# ----------------- ACCOUNT SCHEMAS -----------------
class AccountBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    account_type: str  # asset or liability
    currency: Optional[str] = "INR"
    opening_balance_minor: Optional[int] = Field(default=0, ge=-100_000_000_000, le=100_000_000_000)

class AccountCreate(AccountBase):
    pass

class AccountUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    account_type: Optional[str] = None
    currency: Optional[str] = None
    is_active: Optional[bool] = None
    expected_version: Optional[int] = None

class AccountResponse(AccountBase):
    id: uuid.UUID
    user_id: uuid.UUID
    is_active: bool
    balance_paise: Optional[int] = 0  # Dynamic/calculated balance
    created_at: UtcDateTime
    updated_at: UtcDateTime

    class Config:
        from_attributes = True


# ----------------- CATEGORY SCHEMAS -----------------
class CategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: str  # income or expense
    icon: Optional[str] = None
    color: Optional[str] = None
    is_default: Optional[bool] = False

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    type: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None

class CategoryResponse(CategoryBase):
    id: uuid.UUID
    user_id: Optional[uuid.UUID] = None
    created_at: UtcDateTime
    updated_at: UtcDateTime

    class Config:
        from_attributes = True


# ----------------- TRANSACTION SCHEMAS -----------------
class TransactionBase(BaseModel):
    account_id: uuid.UUID
    to_account_id: Optional[uuid.UUID] = None  # for transfers
    category_id: Optional[uuid.UUID] = None
    savings_goal_id: Optional[uuid.UUID] = None
    transaction_type: str  # income, expense, transfer
    amount_minor: int = Field(ge=1, le=100_000_000_000)
    currency: str = "INR"
    description: Optional[str] = Field(default=None, max_length=500)
    transaction_date: UtcDateTime
    client_mutation_id: uuid.UUID
    device_id: str
    sync_status: Optional[str] = "synced"

class TransactionCreate(TransactionBase):
    pass

class TransactionUpdate(BaseModel):
    account_id: Optional[uuid.UUID] = None
    to_account_id: Optional[uuid.UUID] = None
    category_id: Optional[uuid.UUID] = None
    savings_goal_id: Optional[uuid.UUID] = None
    amount_minor: Optional[int] = Field(default=None, ge=1, le=100_000_000_000)
    description: Optional[str] = Field(default=None, max_length=500)
    transaction_date: Optional[UtcDateTime] = None
    expected_version: Optional[int] = None

class TransactionResponse(TransactionBase):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: UtcDateTime
    updated_at: UtcDateTime
    version: int

    class Config:
        from_attributes = True


# ----------------- RECURRING INCOME SCHEMAS -----------------
class RecurringIncomeBase(BaseModel):
    source: str = Field(min_length=1, max_length=100)
    amount_minor: int = Field(ge=1, le=100_000_000_000)
    frequency: str
    next_occurrence: UtcDateTime
    active: Optional[bool] = True
    #: Day of the month the stream is anchored to, so a month-end salary does
    #: not drift down to the 28th after one February.
    anchor_day: Optional[int] = Field(default=None, ge=1, le=31)

class RecurringIncomeCreate(RecurringIncomeBase):
    pass

class RecurringIncomeUpdate(BaseModel):
    source: Optional[str] = Field(default=None, min_length=1, max_length=100)
    amount_minor: Optional[int] = Field(default=None, ge=1, le=100_000_000_000)
    frequency: Optional[str] = None
    next_occurrence: Optional[UtcDateTime] = None
    active: Optional[bool] = None
    anchor_day: Optional[int] = Field(default=None, ge=1, le=31)

class RecurringIncomeResponse(RecurringIncomeBase):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: UtcDateTime
    updated_at: UtcDateTime

    class Config:
        from_attributes = True


class DueIncomeResponse(BaseModel):
    """A stream whose date has come round without the money being recorded."""
    id: uuid.UUID
    source: str
    frequency: str
    #: The oldest occurrence still unrecorded - the one being asked about.
    due_on: UtcDateTime
    #: What the stream says to expect; the user can change it when confirming.
    expected_amount_minor: int
    #: How many occurrences have gone by unrecorded, this one included.
    missed_count: int


class SkipIncomePayload(BaseModel):
    """Moves past due occurrences without recording any money."""
    #: Clear the whole backlog in one go. A stream months behind otherwise
    #: needs one tap per month, and the card barely changes between them, so
    #: the button reads as dead.
    all_missed: Optional[bool] = False


class ConfirmIncomePayload(BaseModel):
    """Records one occurrence of a stream as money that actually arrived."""
    account_id: uuid.UUID
    #: Defaults to the stream's amount when the payslip matched.
    amount_minor: Optional[int] = Field(default=None, ge=1, le=100_000_000_000)
    category_id: Optional[uuid.UUID] = None
    #: Defaults to the due date; set it when the money landed on another day.
    received_on: Optional[UtcDateTime] = None
    device_id: Optional[str] = None


# ----------------- BILL SCHEMAS -----------------
class BillBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    amount_minor: int = Field(ge=1, le=100_000_000_000)
    currency: Optional[str] = "INR"
    due_date: UtcDateTime
    recurrence: Optional[str] = None
    category_id: Optional[uuid.UUID] = None
    status: Optional[str] = "upcoming"
    reminder_enabled: Optional[bool] = True

class BillCreate(BillBase):
    pass

class BillUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    amount_minor: Optional[int] = Field(default=None, ge=1, le=100_000_000_000)
    due_date: Optional[UtcDateTime] = None
    recurrence: Optional[str] = None
    category_id: Optional[uuid.UUID] = None
    status: Optional[str] = None
    reminder_enabled: Optional[bool] = None
    expected_version: Optional[int] = None

class BillPayPayload(BaseModel):
    account_id: uuid.UUID
    client_mutation_id: uuid.UUID
    device_id: str
    payment_date: Optional[UtcDateTime] = None

class BillResponse(BillBase):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: UtcDateTime
    updated_at: UtcDateTime

    class Config:
        from_attributes = True


# ----------------- BUDGET SCHEMAS -----------------
class BudgetBase(BaseModel):
    category_id: uuid.UUID
    limit_amount_minor: int = Field(ge=1, le=100_000_000_000)
    period: Optional[str] = "monthly"
    start_date: UtcDateTime
    end_date: UtcDateTime

class BudgetCreate(BudgetBase):
    pass

class BudgetUpdate(BaseModel):
    limit_amount_minor: Optional[int] = Field(default=None, ge=1, le=100_000_000_000)
    period: Optional[str] = None
    start_date: Optional[UtcDateTime] = None
    end_date: Optional[UtcDateTime] = None
    expected_version: Optional[int] = None

class BudgetResponse(BudgetBase):
    id: uuid.UUID
    user_id: uuid.UUID
    # Without this the UI had nothing to label a budget with and fell back to
    # the literal word "Category", so every budget card looked identical.
    category_name: Optional[str] = None
    spent_amount_minor: Optional[int] = 0
    remaining_amount_minor: Optional[int] = 0
    created_at: UtcDateTime
    updated_at: UtcDateTime

    class Config:
        from_attributes = True


# ----------------- SAVINGS GOAL SCHEMAS -----------------
class SavingsGoalBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    target_amount_minor: int = Field(ge=1, le=100_000_000_000)
    target_date: Optional[UtcDateTime] = None
    status: Optional[str] = "active"

class SavingsGoalCreate(SavingsGoalBase):
    pass

class SavingsGoalUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    target_amount_minor: Optional[int] = Field(default=None, ge=1, le=100_000_000_000)
    target_date: Optional[UtcDateTime] = None
    status: Optional[str] = None
    expected_version: Optional[int] = None

class SavingsGoalResponse(SavingsGoalBase):
    id: uuid.UUID
    user_id: uuid.UUID
    current_saved_minor: Optional[int] = 0
    progress_percentage: Optional[float] = 0.0
    created_at: UtcDateTime
    updated_at: UtcDateTime

    class Config:
        from_attributes = True


# ----------------- NOTIFICATION SCHEMAS -----------------
class NotificationResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    message: str
    notification_type: str
    is_read: bool
    created_at: UtcDateTime

    class Config:
        from_attributes = True

class NotificationPreferencesUpdate(BaseModel):
    notif_bills: Optional[bool] = None
    notif_budgets: Optional[bool] = None
    notif_goals: Optional[bool] = None
    notif_salary: Optional[bool] = None

class NotificationPreferencesResponse(BaseModel):
    notif_bills: bool
    notif_budgets: bool
    notif_goals: bool
    notif_salary: bool


# ----------------- SUMMARY & READ SCHEMAS -----------------
class FinancialSummaryResponse(BaseModel):
    net_worth_minor: int
    income_minor: int
    expense_minor: int
    net_cash_flow_minor: int
    currency: str = "INR"

class SalaryUsageResponse(BaseModel):
    """This month's salary versus what has been spent against it."""
    period_start: UtcDateTime
    period_end: UtcDateTime
    salary_received_minor: int      # salary/recurring income actually credited
    other_income_minor: int         # any other income this month
    total_income_minor: int
    spent_minor: int                # every expense recorded this month
    remaining_minor: int            # total income - spent (may go negative)
    used_percent: float             # 0-100+, clamped at 0 lower bound
    has_salary_configured: bool
    currency: str = "INR"


class CashFlowResponse(BaseModel):
    income_minor: int
    expense_minor: int
    net_cash_flow_minor: int

class AccountBalanceResponse(BaseModel):
    account_id: uuid.UUID
    account_name: str
    account_type: str
    balance_minor: int
    currency: str

# ----------------- AI ASSISTANT SCHEMAS -----------------
class AIQueryRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=1000)
    conversation_id: Optional[str] = None



class ReconcileRequest(BaseModel):
    """What the account really holds, according to the person looking at it."""

    #: Signed: a credit card or overdraft is legitimately negative, and a
    #: current account can be too, so this cannot be constrained to positive.
    actual_balance_minor: int = Field(ge=-100_000_000_000, le=100_000_000_000)
    #: Optional note - "missed some cash spends", "opening balance was wrong".
    note: Optional[str] = Field(default=None, max_length=140)


class ReconcileResponse(BaseModel):
    """What the correction did, in the terms the screen needs to explain it."""

    account_id: uuid.UUID
    previous_balance_minor: int
    actual_balance_minor: int
    #: Signed. Positive means the app was UNDER-counting and money was added.
    difference_minor: int
    #: None when the balance already matched and nothing was written.
    adjustment_transaction_id: Optional[uuid.UUID] = None
    message: str
