"""Response-language resolution for CASPEL AI.

A visitor at the stand may type in English, Simplified Chinese or Azerbaijani,
and may explicitly ask for a different language than the one they typed in.
Getting this wrong is not cosmetic: answering a Chinese question in English at
a Beijing exhibition makes the assistant look broken, and answering in Chinese
when someone asked for English does the same in the other direction.

Everything here is pure and offline. No provider call, no network, no model is
needed to decide what language to answer in, which is what makes the rule
testable and keeps the decision out of the model's hands.

Deliberately NOT a general language detector. It recognises exactly the three
languages the exhibition committed to and falls back to English otherwise,
because a confident wrong guess is worse than a predictable default.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Literal, Optional

ResponseLanguage = Literal["en", "zh-CN", "az"]

DEFAULT_RESPONSE_LANGUAGE: ResponseLanguage = "en"

#: Locales the browser UI can hint with. Narrower than the answerable set:
#: the UI ships in two languages, but a visitor may still write Azerbaijani.
UiLocale = Literal["en", "zh-CN"]

# Below this, a message carries too little signal to classify on its own --
# "PMS", "ERP", "IRISSEA?" -- and the UI locale is the better guess.
_AMBIGUOUS_MAX_CHARS = 24

# ── Explicit requests ────────────────────────────────────────────────────────
#
# An explicit instruction beats whatever language it happens to be written in.
# "Answer in Chinese" typed in English must produce Chinese, and 请用英文回答
# typed in Chinese must produce English.

_EXPLICIT_ENGLISH = (
    r"(?:answer|reply|respond|write|explain|say\s+it)\b[^.?!]{0,40}?\bin\s+english"
    r"|in\s+english\s*,?\s*please"
    r"|please\s+(?:answer|reply|respond|use)\b[^.?!]{0,20}?\benglish"
    r"|用英[语文]"
    r"|英[语文]回[答复]"
    r"|ingilis(?:c[əe])?\s*dil"
)

_EXPLICIT_CHINESE = (
    r"(?:answer|reply|respond|write|explain|say\s+it)\b[^.?!]{0,40}?\bin\s+"
    r"(?:chinese|mandarin|simplified\s+chinese)"
    r"|in\s+chinese\s*,?\s*please"
    r"|please\s+(?:answer|reply|respond|use)\b[^.?!]{0,20}?\bchinese"
    r"|用中文"
    r"|中文回[答复]"
    r"|请用简体中文"
    r"|çin\s*c[əe]si"
)

_EXPLICIT_AZERBAIJANI = (
    r"(?:answer|reply|respond|write|explain|say\s+it)\b[^.?!]{0,40}?\bin\s+azerbaijani"
    r"|in\s+azerbaijani\s*,?\s*please"
    r"|please\s+(?:answer|reply|respond|use)\b[^.?!]{0,20}?\bazerbaijani"
    r"|az[əe]rbaycan\s*(?:dilind[əe]|dili)"
    r"|用阿塞拜疆语"
)

_EXPLICIT_PATTERNS: tuple[tuple[ResponseLanguage, re.Pattern[str]], ...] = (
    ("en", re.compile(_EXPLICIT_ENGLISH, re.IGNORECASE)),
    ("zh-CN", re.compile(_EXPLICIT_CHINESE, re.IGNORECASE)),
    ("az", re.compile(_EXPLICIT_AZERBAIJANI, re.IGNORECASE)),
)

# ── Script and vocabulary signals ────────────────────────────────────────────

#: Letters that exist in Azerbaijani and not in English.
#:
#: Plain capital "I" (U+0049) is deliberately absent. It is the Azerbaijani
#: dotless capital, but it is also the English pronoun and the first letter of
#: IRISSEA, so including it classified ordinary English as Azerbaijani. The
#: unambiguous pair is dotless ı (U+0131) and dotted İ (U+0130).
_AZ_SPECIFIC_CHARS = set("əğışöçüĞİŞÖÇÜƏ")

#: Common Azerbaijani function words. Latin script alone cannot separate
#: Azerbaijani from English, and a question may legitimately carry none of the
#: special letters ("Bu sistem nedir").
_AZ_WORDS = frozenset(
    {
        "nədir", "nedir", "necə", "nece", "haqqında", "haqqinda", "üçün", "ucun",
        "və", "ve", "ilə", "ile", "bir", "bu", "nə", "ne", "hansı", "hansi",
        "sistem", "modul", "modullar", "şirkət", "sirket", "məhsul", "mehsul",
        "danış", "danis", "mənə", "mene", "izah", "et", "edin", "var", "varmı",
        "layihə", "layihe", "qiymət", "qiymet", "müştəri", "musteri",
    }
)

_WORD_RE = re.compile(r"[\w’']+", re.UNICODE)


def _has_han(text: str) -> bool:
    """True if the text carries CJK ideographs.

    Han script is decisive on its own: Latin punctuation or an embedded product
    name like "Caspel ERP" does not make a Chinese sentence English.
    """
    for ch in text:
        if "CJK UNIFIED IDEOGRAPH" in unicodedata.name(ch, ""):
            return True
    return False


def _azerbaijani_score(text: str) -> int:
    """How much evidence there is that this is Azerbaijani, not English."""
    score = 0
    if any(ch in _AZ_SPECIFIC_CHARS for ch in text):
        score += 2
    words = {w.lower() for w in _WORD_RE.findall(text)}
    score += len(words & _AZ_WORDS)
    return score


def detect_message_language(message: str) -> Optional[ResponseLanguage]:
    """The language the message itself is written in, or None if unclear.

    None means "not enough signal", which is what lets the caller fall back to
    the UI locale rather than guessing.
    """
    text = (message or "").strip()
    if not text:
        return None

    if _has_han(text):
        return "zh-CN"

    if _azerbaijani_score(text) >= 2:
        return "az"

    # Latin letters and no Azerbaijani evidence. Treat a substantial message as
    # English; leave a short one unresolved for the UI locale to decide.
    if any(ch.isalpha() for ch in text) and len(text) > _AMBIGUOUS_MAX_CHARS:
        return "en"

    return None


def detect_explicit_language_request(message: str) -> Optional[ResponseLanguage]:
    """An explicit "answer in X" instruction, if one is present."""
    text = message or ""
    for language, pattern in _EXPLICIT_PATTERNS:
        if pattern.search(text):
            return language
    return None


def resolve_response_language(
    message: str,
    ui_locale: Optional[str] = None,
) -> ResponseLanguage:
    """Decide which language to answer in.

    Priority, highest first:

    1. An explicit request in this message. It overrides everything, including
       the language the request itself is written in, and including whatever
       the previous turn was in -- a visitor who switches must be obeyed
       immediately, not after the conversation "settles".
    2. The language the message is clearly written in.
    3. The browser UI locale, but only for input too short to classify.
    4. English.
    """
    explicit = detect_explicit_language_request(message)
    if explicit:
        return explicit

    detected = detect_message_language(message)
    if detected:
        return detected

    if ui_locale in ("en", "zh-CN"):
        return ui_locale  # type: ignore[return-value]

    return DEFAULT_RESPONSE_LANGUAGE


# ── No-context answers ───────────────────────────────────────────────────────
#
# Reviewed, deterministic sentences. When retrieval finds nothing there is no
# provider call at all, so these are never model output -- which also means a
# retrieval miss cannot be turned into an invented answer by a model that would
# rather say something than nothing.

NO_CONTEXT_ANSWERS: dict[ResponseLanguage, str] = {
    "en": (
        "I'm sorry, but that information is not available in our official exhibition "
        "materials. Please feel free to request a demo or speak with our "
        "representatives at the booth."
    ),
    "zh-CN": (
        "抱歉，我们的官方展会材料中没有相关信息。"
        "您可以预约演示，或到 CASPEL 展台与我们的团队交流。"
    ),
    "az": (
        "Təəssüf ki, bu məlumat rəsmi sərgi materiallarımızda yoxdur. "
        "Demo tələb edə və ya CASPEL stendindəki komandamızla danışa bilərsiniz."
    ),
}


def no_context_answer(language: ResponseLanguage) -> str:
    """The reviewed refusal for a language, falling back to English.

    English is the fallback rather than a machine translation: an unreviewed
    sentence in a language nobody on the team reads is a worse failure than a
    correct English one.
    """
    return NO_CONTEXT_ANSWERS.get(language, NO_CONTEXT_ANSWERS["en"])


#: Human-readable names used in the generation instruction.
LANGUAGE_NAMES: dict[ResponseLanguage, str] = {
    "en": "English",
    "zh-CN": "Simplified Chinese (简体中文)",
    "az": "Azerbaijani (Azərbaycan dili)",
}


def language_instruction(language: ResponseLanguage) -> str:
    """The sentence appended to the prompt telling the model what to answer in."""
    return (
        f"Write your entire answer in {LANGUAGE_NAMES.get(language, 'English')}. "
        "Keep official product names, document titles and page numbers exactly as "
        "they appear in the context; do not translate or transliterate them."
    )
