"""Rude and sexual words kept out of names that others see (people's and groups' names). Learners
may be minors (ADR 0011).

A short list, not a filter of everything: the words children actually type, in the app's
languages. Each is checked in two spellings of the name, folded to Cyrillic and to Latin, so
look-alike letters (Latin «с» for Cyrillic), digits for letters (s3x), stretched letters (fuuuck)
and spaced or dotted letters (s.e.x) are caught.
"""

import re

# Found anywhere, also across spaces: never part of an ordinary word or name.
_ANYWHERE = (
    # Russian
    "хуй",
    "хуё",
    "хуя",
    "пизд",
    "бляд",
    "блят",
    "ебан",
    "ебат",
    "ебну",
    "пидор",
    "пидар",
    "шлюх",
    "залуп",
    "гандон",
    "мудак",
    "мудил",
    # English
    "fuck",
    "motherf",
    "fagot",
    "retard",
    "whore",
    "dildo",
    "porn",
    "pusy",
    "cunt",
    "bitch",
    "slut",
    "penis",
    "vagin",
    "boob",
    # Transliterated Russian
    "xuy",
    "xuj",
    "pizd",
    "blyad",
    "blyat",
    "pidor",
    "pidar",
    # Kyrgyz, Kazakh, Uzbek, Tajik
    "сигейин",
    "сігейін",
    "сикейин",
    "сикайин",
    "сиктим",
    "қотақ",
    "жалап",
    "amjalab",
    "jalab",
    "qotoq",
    "sikay",
    "sikaman",
    "sikdim",
    "кусмо",
    "kusmo",
    "порн",
)
# At the start of a word: inside one these letters are often innocent (Essex, Шебалин).
_STARTS = ("sex", "секс", "хуе", "ебал", "сиськ", "tits")
# A whole word only: these letters also begin or sit inside ordinary words and names.
_WORDS = (
    "сука",
    "суки",
    "суке",
    "сучка",
    "дебил",
    "дебилы",
    "идиот",
    "даун",
    "урод",
    "мразь",
    "педик",
    "котак",
    "debil",
    "idiot",
    "ass",
    "cock",
    "anal",
    "анал",
    "shit",
    "suka",
    "nigger",
    "nigga",
    "fuk",
    "fck",
)

_TO_CYRILLIC = str.maketrans(
    {
        "a": "а",
        "b": "в",
        "c": "с",
        "e": "е",
        "h": "н",
        "k": "к",
        "m": "м",
        "o": "о",
        "p": "р",
        "t": "т",
        "x": "х",
        "y": "у",
        "3": "з",
        "0": "о",
        "6": "б",
        "ё": "е",
    }
)
_TO_LATIN = str.maketrans(
    {
        "а": "a",
        "в": "b",
        "с": "c",
        "е": "e",
        "ё": "e",
        "к": "k",
        "м": "m",
        "н": "h",
        "о": "o",
        "р": "p",
        "т": "t",
        "х": "x",
        "у": "y",
        "і": "i",
        "ı": "i",
        "0": "o",
        "1": "i",
        "3": "e",
        "4": "a",
        "5": "s",
        "7": "t",
        "$": "s",
        "@": "a",
    }
)
_SEPARATORS = re.compile(r"[\s'‘’.\-_*]+")
_REPEATS = re.compile(r"(.)\1+")


def _collapse(text: str) -> str:
    return _REPEATS.sub(r"\1", text)


_ANYWHERE_FOLDED = {_collapse(stem) for stem in _ANYWHERE}
_STARTS_FOLDED = tuple({_collapse(stem) for stem in _STARTS})
_WORDS_FOLDED = {_collapse(word) for word in _WORDS}


def _spellings(name: str) -> list[str]:
    lower = name.lower()
    return [lower.translate(_TO_CYRILLIC), lower.translate(_TO_LATIN)]


def is_rude(name: str) -> bool:
    """True if a rude or sexual word is in the name, however it is spelled."""
    for spelled in _spellings(name):
        joined = _collapse(_SEPARATORS.sub("", spelled))
        if any(stem in joined for stem in _ANYWHERE_FOLDED):
            return True
        words = [_collapse(word) for word in _SEPARATORS.split(spelled) if word] + [joined]
        if any(word in _WORDS_FOLDED or word.startswith(_STARTS_FOLDED) for word in words):
            return True
    return False
