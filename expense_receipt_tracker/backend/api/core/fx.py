"""Currency conversion for the dashboard totals.

Expenses can be recorded in any currency. The dashboard's Total tracked /
Pending / Reimbursed figures are shown in a single base currency (an org
setting), so each expense's amount is converted into that base using the
exchange rate for the expense's own date — "the standard exchange values of
that day".

Rates come from the free, key-less Frankfurter API (ECB reference rates,
https://www.frankfurter.app), which serves historical daily rates. Results are
cached in-process per (date, base) so a dashboard render fetches at most once
per distinct expense date. When the network is unavailable (offline dev, the
sandboxed test runner, an API hiccup) we fall back to a small static table of
approximate USD cross-rates so totals still convert instead of failing — the
conversion is marked approximate via the returned `unconverted` set only when
even the fallback can't help.

Conversion is skipped entirely when an expense is already in the base currency,
so a single-currency install (and the test suite, which is all USD) never
touches the network.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone

logger = logging.getLogger(__name__)

_FRANKFURTER_URL = "https://api.frankfurter.app"
_TIMEOUT_SECONDS = 6.0

# Approximate units of each currency per 1 USD. Only used when live rates can't
# be fetched, purely so mixed-currency totals still produce a sensible figure
# offline. Not meant to be authoritative — live rates are always preferred.
_STATIC_USD_RATES: dict[str, float] = {
    "USD": 1.0,
    "EUR": 0.92,
    "GBP": 0.79,
    "JPY": 155.0,
    "KRW": 1350.0,
    "INR": 83.0,
    "CNY": 7.2,
    "AUD": 1.52,
    "CAD": 1.37,
    "SGD": 1.35,
    "HKD": 7.8,
    "AED": 3.67,
    "CHF": 0.88,
}

# Cache of {base -> {currency -> units per 1 base}} keyed by ISO date string.
# A None value marks a date whose live fetch failed, so we don't retry it on
# every summary render within the process's lifetime.
_rate_cache: dict[tuple[str, str], dict[str, float] | None] = {}


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _fetch_live_rates(on_date: date, base: str) -> dict[str, float] | None:
    """Frankfurter rates for `base` on `on_date`, or None if unavailable.

    Frankfurter returns rates relative to `from` (units of each listed currency
    per 1 unit of base), automatically rolling weekends/holidays back to the
    prior published business day. Future dates aren't published, so we clamp to
    the latest available rates.
    """
    try:
        import httpx
    except ImportError:  # httpx should always be present, but never hard-fail
        return None

    day = min(on_date, _today())
    url = f"{_FRANKFURTER_URL}/{day.isoformat()}"
    try:
        resp = httpx.get(url, params={"from": base}, timeout=_TIMEOUT_SECONDS)
    except Exception as exc:  # noqa: BLE001 — network/DNS/timeout all fall back
        logger.info("FX: live rate fetch failed for %s (%s); using fallback.", day, exc)
        return None
    if resp.status_code >= 400:
        logger.info("FX: rate API returned HTTP %s for %s; using fallback.", resp.status_code, day)
        return None
    try:
        rates = resp.json().get("rates")
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(rates, dict) or not rates:
        return None
    out = {base.upper(): 1.0}
    for code, value in rates.items():
        try:
            out[str(code).upper()] = float(value)
        except (TypeError, ValueError):
            continue
    return out


def _rates_for(on_date: date, base: str) -> dict[str, float] | None:
    key = (on_date.isoformat(), base.upper())
    if key not in _rate_cache:
        _rate_cache[key] = _fetch_live_rates(on_date, base)
    return _rate_cache[key]


def _static_rate(currency: str, base: str) -> float | None:
    """Units of `currency` per 1 `base` from the static USD cross-table."""
    per_usd = _STATIC_USD_RATES.get(currency.upper())
    base_per_usd = _STATIC_USD_RATES.get(base.upper())
    if per_usd is None or base_per_usd is None or base_per_usd == 0:
        return None
    return per_usd / base_per_usd


def convert(amount: float, currency: str, base: str, on_date: date) -> tuple[float, bool]:
    """Convert `amount` (in `currency`) into `base` using `on_date`'s rate.

    Returns `(converted_amount, ok)`. `ok` is False when no rate — live or
    static — could be found for the pair; the caller then knows the returned
    value is the raw amount (best effort) and can flag it. Same-currency
    conversions short-circuit with no network access.
    """
    currency = (currency or base).upper()
    base = base.upper()
    if currency == base:
        return amount, True

    rates = _rates_for(on_date, base)
    rate = rates.get(currency) if rates else None
    if rate is None:
        rate = _static_rate(currency, base)
    if not rate or rate <= 0:
        # Unknown currency with no fallback — return the raw amount and let the
        # caller mark the total approximate rather than dropping the expense.
        return amount, False
    return amount / rate, True
