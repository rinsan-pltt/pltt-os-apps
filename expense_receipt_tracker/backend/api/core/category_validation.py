"""Reject category names that aren't real categories.

Anyone can type anything into the Categories editor, and a junk name is not a
harmless typo: the slug derived from it goes onto expense rows, the AI
classifier is asked to sort receipts into it, and every filter and report
carries it from then on. So a name is checked when it is **created or renamed**,
before anything is written.

Two layers, in this order:

1. `structural_problem` — cheap, deterministic, always runs. Catches the things
   that are wrong regardless of language or intent: no letters at all, one
   character, one character repeated, a keyboard run, a consonant mash.
2. `llm_implausible` — asks the model which of the remaining names are not
   plausible expense categories. This is the layer that actually answers
   "meaningful", and it is the only one that can read intent.

Layer 2 is skipped when no OPENAI_KEY is configured, exactly like receipt
extraction and classification: the app must stay usable without a key, so
without one only the structural rules apply.

The bias throughout is **permissive**. A false rejection blocks a user from
naming their own category, which is worse than letting an odd one through, so
both layers only fire on names that are clearly not words: acronyms (HR, R&D,
IT), proper nouns, project codenames and non-English names all pass.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata

from .llm import call_openai

logger = logging.getLogger(__name__)

# Sequences that mean "I ran my fingers along the keyboard", checked as
# substrings of the letters-only form of the name.
_KEYBOARD_RUNS = (
    "qwerty", "qwert", "werty", "asdf", "sdfg", "dfgh", "fghj", "ghjk", "hjkl",
    "zxcv", "xcvb", "cvbn", "vbnm", "abcd", "bcde", "1234",
)

# Placeholder names people type when they are poking at a form.
_PLACEHOLDERS = {
    "test", "testing", "test1", "test123", "temp", "tmp", "foo", "bar", "baz",
    "abc", "xyz", "aaa", "asd", "asdf", "qwe", "qwerty", "sample", "example",
    "dummy", "new category", "untitled", "none", "n/a", "na", "null",
}

_VOWELS = set("aeiouy")


def _letters(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalpha())


def _is_latin(value: str) -> bool:
    """True when the name is written in the Latin alphabet.

    The vowel rule below is a fact about Latin spelling and nothing else —
    Korean, Japanese and Chinese names carry no a/e/i/o/u at all, so applying it
    to them would reject every single one.
    """
    letters = [ch for ch in value if ch.isalpha()]
    if not letters:
        return False
    return all("LATIN" in unicodedata.name(ch, "") for ch in letters)


def structural_problem(label: str) -> str | None:
    """A reason this name cannot be a category, or None if it might be.

    Deliberately narrow: everything here would be wrong in any language and for
    any business. Judging meaning is `llm_implausible`'s job.
    """
    name = label.strip()
    if not name:
        return "empty"
    letters = _letters(name)

    if not letters:
        # "123", "!!!", "---": a category has to be nameable out loud.
        return "no-letters"
    if len(letters) < 2:
        return "too-short"
    if len(set(letters)) == 1:
        # "aa", "xxxx"
        return "repeated-character"
    if name.strip().lower() in _PLACEHOLDERS:
        return "placeholder"
    if any(run in letters for run in _KEYBOARD_RUNS):
        return "keyboard-run"
    # A vowel-free Latin word of four letters or more is a mash ("dsds",
    # "sdfgh"). Shorter ones are left alone because that is where the real
    # acronyms live (HR, PR, R&D, SMS), and an all-caps word of any length is
    # treated as an acronym rather than a mash.
    if _is_latin(name) and len(letters) >= 4 and not (_VOWELS & set(letters)) and not name.isupper():
        return "no-vowels"
    return None


_LLM_SYSTEM = """You check proposed expense-category names for a business expense tracker.

A valid name refers to something real. Accept it when it names either:
  * a kind of business spending — "Meals", "Client Gifts", "Visa fees",
    "Dog treats", "Coffee beans", "Pet insurance", "Q3 Offsite"; or
  * a real, identifiable thing money is spent on or for — a vendor, client,
    team, project, event, place or asset: "Acme Retainer", "Project Atlas",
    "Berlin Office", "Sales Team", "Zephyr Licences".

Reject it only when the name refers to nothing at all:
  * random keystrokes or mashed letters — "dsds", "hjkl", "asdfgh", "wwww";
  * a placeholder someone typed while poking at the form — "test", "temp",
    "untitled", "lorem ipsum", "new category";
  * invented words that do not denote anything — "Blorp Zindle",
    "Frobnicator Widgets", "Glorptastic".

These are ALWAYS valid and must never be reported:
  * any language — "여행", "Reisekosten", "Frais de mission";
  * acronyms and initialisms — HR, R&D, IT, SaaS, COGS, T&E;
  * names with punctuation, numbers or ampersands — "Travel & Stay", "Q3 2026".

An unfamiliar word paired with a spend word ("Zephyr Licences", "Kobo
Subscriptions") is a real vendor or project and is valid. When you are
genuinely unsure whether a word refers to something, accept it — blocking
someone from naming their own category is worse than allowing an odd one.

Respond with strict JSON only:
{"invalid": [{"label": "<the name exactly as given>", "reason": "<max 12 words, plain, addressed to the user>"}]}
Return {"invalid": []} when every name is fine."""


def llm_implausible(labels: list[str], api_key: str | None) -> dict[str, str]:
    """Map label → reason for names the model judges to be gibberish.

    Returns `{}` with no key, and `{}` on any failure: this check exists to
    catch nonsense, so when it cannot run the save must still go through rather
    than fail on an unrelated outage.
    """
    if not labels or not api_key:
        return {}
    messages = [
        {"role": "system", "content": _LLM_SYSTEM},
        {"role": "user", "content": json.dumps({"names": labels}, ensure_ascii=False)},
    ]
    try:
        content, _model = call_openai(api_key, messages, json_mode=True)
        payload = json.loads(content)
    except Exception:  # noqa: BLE001 — see the docstring: never block a save
        logger.warning("category name check unavailable; structural rules only", exc_info=True)
        return {}

    entries = payload.get("invalid")
    if not isinstance(entries, list):
        return {}
    # Only trust verdicts about names we actually asked about, so a hallucinated
    # extra entry cannot block a save on a name the user never typed.
    asked = {label.strip().lower(): label for label in labels}
    out: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        said = str(entry.get("label") or "").strip().lower()
        original = asked.get(said)
        if original is None:
            continue
        reason = str(entry.get("reason") or "").strip()
        out[original] = reason[:120] or "doesn't read as a category name"
    return out


# Structural reasons in the user's words. The route sends these to the client,
# which shows them beside the field that has to change.
_REASON_TEXT = {
    "empty": "Give this category a name.",
    "no-letters": "A category name needs at least one letter.",
    "too-short": "That's too short to be a category name.",
    "repeated-character": "That looks like a stray keypress, not a name.",
    "placeholder": "That's a placeholder — give it a real name.",
    "keyboard-run": "That looks like random keystrokes, not a name.",
    "no-vowels": "That doesn't read as a word. Did you mean something else?",
}


def check_labels(labels: list[str], api_key: str | None) -> list[dict]:
    """Validate a list of new/renamed category names.

    Returns one `{"label", "reason"}` per rejected name, in the order given, so
    the UI can flag each offending field. An empty list means every name is
    acceptable.
    """
    problems: list[dict] = []
    survivors: list[str] = []
    for label in labels:
        reason = structural_problem(label)
        if reason is not None:
            problems.append({"label": label, "reason": _REASON_TEXT[reason]})
        else:
            survivors.append(label)

    for label, reason in llm_implausible(survivors, api_key).items():
        problems.append({"label": label, "reason": reason})

    order = {label: i for i, label in enumerate(labels)}
    problems.sort(key=lambda p: order.get(p["label"], 0))
    return problems
