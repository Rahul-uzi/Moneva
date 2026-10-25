"""The assistant's request must fit Groq's free-plan ceiling.

Groq allows 8,000 tokens a minute per model and refuses a single larger
request outright (HTTP 413) - seen on the admin page with 8,742 requested, from
sixty full transactions plus ten turns of history.
"""
from app.services import ai_llm
from app.services.ai_service import _compact_transactions


def _tx(i: int) -> dict:
    return {
        "id": f"00000000-0000-4000-8000-{i:012d}",
        "transaction_type": "expense",
        "amount_minor": 12345 + i,
        "description": f"Google Pay - Corner Shop {i} - weekly groceries and household things",
        "category_name": "Groceries",
        "account_name": "City Bank Savings",
        "transaction_date": f"2026-10-{(i % 28) + 1:02d}T10:15:30.123456",
    }


def _heavy_snapshot() -> dict:
    return {
        "currency": "INR",
        "summary": {"net_worth_minor": 12345600, "income_minor": 9000000, "expense_minor": 4500000},
        "accounts": [{"name": "City Bank Savings", "balance_minor": 9421200}],
        # Newest first, as get_recent_transactions_tool returns them.
        "recent_transactions": _compact_transactions([_tx(i) for i in range(60)]),
    }


LONG_HISTORY = [
    {"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i} " + "x" * 590}
    for i in range(10)
]


def _tokens(payload: str) -> int:
    return ai_llm._estimate_tokens(ai_llm.SYSTEM_PROMPT) + ai_llm._estimate_tokens(payload)


def test_snapshot_transactions_drop_the_id_and_the_microseconds():
    row = _compact_transactions([_tx(1)])[0]
    assert "id" not in row
    assert row["transaction_date"] == "2026-10-02 10:15"
    assert row["description"].startswith("Google Pay - Corner Shop 1")


def test_a_heavy_request_is_cut_to_fit():
    payload = ai_llm._fit_payload("How much did I spend on groceries?", _heavy_snapshot(), LONG_HISTORY)
    assert _tokens(payload) <= ai_llm.REQUEST_TOKEN_BUDGET
    # Request plus the longest reply stays under Groq's 8,000 a minute.
    assert ai_llm.REQUEST_TOKEN_BUDGET + ai_llm.MAX_COMPLETION_TOKENS <= 8000


def test_what_is_cut_is_what_the_answer_needs_least():
    payload = ai_llm._fit_payload("How much did I spend on groceries?", _heavy_snapshot(), LONG_HISTORY)
    # The question and the balances always survive.
    assert "How much did I spend on groceries?" in payload
    assert "City Bank Savings" in payload
    # The newest transactions stay; the oldest go.
    assert "Corner Shop 0 " in payload
    assert "Corner Shop 59 " not in payload
    # The latest turn of the conversation stays; the oldest goes.
    assert "turn 9 " in payload
    assert "turn 0 " not in payload


def test_a_small_request_is_left_alone():
    snap = {"currency": "INR", "recent_transactions": _compact_transactions([_tx(i) for i in range(5)])}
    history = [{"role": "user", "content": "hello"}, {"role": "assistant", "content": "hi"}]
    payload = ai_llm._fit_payload("And last month?", snap, history)
    assert payload == ai_llm._render_payload("And last month?", snap, history)
    assert all(f"Corner Shop {i} " in payload for i in range(5))
