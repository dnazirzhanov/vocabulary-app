"""What the server itself says, in the app's languages (ADR 0055): today, notifications. Each
sentence is whole, so each language orders it and applies its own grammar, and a language with a
line missing can't be constructed."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date

DEFAULT = "ru"


@dataclass(frozen=True)
class Texts:
    words: Callable[[int], str]
    day: Callable[[date], str]
    quoted: Callable[[str], str]
    left_in_deck: Callable[[str, str], str]
    today_for_deadline: Callable[[str, str, str], str]
    today_in_decks: Callable[[str, str], str]
    report_yesterday: Callable[[str, int, int], str]
    report_on: Callable[[str, str, int, int], str]
    deadline_today: Callable[[str], str]
    deadline_ready: Callable[[str], str]
    deadline_left: Callable[[str, str], str]
    study_day: str
    lesson_waits: str
    deadline_title: str
    words_title: str
    report_title: str
    not_yet_title: str
    still_time: str


def _russian_words(n: int) -> str:
    last, tens = n % 10, n % 100
    if last == 1 and tens != 11:
        return f"{n} слово"
    if 2 <= last <= 4 and not 12 <= tens <= 14:
        return f"{n} слова"
    return f"{n} слов"


_RU_MONTHS = "января февраля марта апреля мая июня июля августа сентября октября ноября декабря"
_EN_MONTHS = "January February March April May June July August September October November December"
_UZ_MONTHS = "yanvar fevral mart aprel may iyun iyul avgust sentabr oktabr noyabr dekabr"
_KK_MONTHS = "қаңтар ақпан наурыз сәуір мамыр маусым шілде тамыз қыркүйек қазан қараша желтоқсан"
_KY_MONTHS = "январь февраль март апрель май июнь июль август сентябрь октябрь ноябрь декабрь"
_TG_MONTHS = "январ феврал март апрел май июн июл август сентябр октябр ноябр декабр"


def _month(names: str, day: date) -> str:
    return names.split()[day.month - 1]


TEXTS: dict[str, Texts] = {
    "ru": Texts(
        words=_russian_words,
        day=lambda d: f"{d.day} {_month(_RU_MONTHS, d)}",
        quoted=lambda t: f"«{t}»",
        left_in_deck=lambda w, t: f"Осталось {w} в «{t}».",
        today_for_deadline=lambda w, t, d: f"Сегодня {w} по «{t}», чтобы успеть к {d}.",
        today_in_decks=lambda w, ts: f"Сегодня {w}: {ts}.",
        report_yesterday=lambda g, a, b: f"Вчера в «{g}»: {a} из {b} сдержали обещание.",
        report_on=lambda d, g, a, b: f"{d} в «{g}»: {a} из {b} сдержали обещание.",
        deadline_today=lambda t: f"Сегодня срок «{t}».",
        deadline_ready=lambda t: f"Сегодня срок «{t}»: вы готовы.",
        deadline_left=lambda t, w: f"Сегодня срок «{t}»: осталось {w}.",
        study_day="Сегодня день занятий",
        lesson_waits="Вас ждёт урок.",
        deadline_title="Срок — сегодня",
        words_title="Слова к уроку",
        report_title="Отчёт группы",
        not_yet_title="Сегодня ещё не занимались",
        still_time="Ещё есть время сдержать обещание.",
    ),
    "en": Texts(
        words=lambda n: f"{n} {'word' if n == 1 else 'words'}",
        day=lambda d: f"{_month(_EN_MONTHS, d)} {d.day}",
        quoted=lambda t: f"“{t}”",
        left_in_deck=lambda w, t: f"{w} left in “{t}”.",
        today_for_deadline=lambda w, t, d: f"Today: {w} from “{t}”, to be ready by {d}.",
        today_in_decks=lambda w, ts: f"Today: {w}: {ts}.",
        report_yesterday=lambda g, a, b: f"Yesterday in “{g}”: {a} of {b} kept their promise.",
        report_on=lambda d, g, a, b: f"{d} in “{g}”: {a} of {b} kept their promise.",
        deadline_today=lambda t: f"“{t}” is due today.",
        deadline_ready=lambda t: f"“{t}” is due today: you're ready.",
        deadline_left=lambda t, w: f"“{t}” is due today: {w} left.",
        study_day="Today is a study day",
        lesson_waits="A lesson is waiting for you.",
        deadline_title="Due today",
        words_title="Words for the lesson",
        report_title="Group report",
        not_yet_title="You haven't studied today",
        still_time="There's still time to keep your promise.",
    ),
    "uz": Texts(
        words=lambda n: f"{n} ta so‘z",
        day=lambda d: f"{d.day}-{_month(_UZ_MONTHS, d)}",
        quoted=lambda t: f"«{t}»",
        left_in_deck=lambda w, t: f"«{t}»da {w} qoldi.",
        today_for_deadline=lambda w, t, d: f"Bugun «{t}»dan {w}, {d} gacha ulgurish uchun.",
        today_in_decks=lambda w, ts: f"Bugun {w}: {ts}.",
        report_yesterday=lambda g, a, b: f"Kecha «{g}»da: {b} tadan {a} tasi va’dasida turdi.",
        report_on=lambda d, g, a, b: f"{d}, «{g}»da: {b} tadan {a} tasi va’dasida turdi.",
        deadline_today=lambda t: f"Bugun «{t}» muddati.",
        deadline_ready=lambda t: f"Bugun «{t}» muddati: siz tayyorsiz.",
        deadline_left=lambda t, w: f"Bugun «{t}» muddati: {w} qoldi.",
        study_day="Bugun shug‘ullanish kuni",
        lesson_waits="Sizni dars kutmoqda.",
        deadline_title="Muddat bugun",
        words_title="Dars uchun so‘zlar",
        report_title="Guruh hisoboti",
        not_yet_title="Bugun hali shug‘ullanmadingiz",
        still_time="Va’dada turishga hali vaqt bor.",
    ),
    "kk": Texts(
        words=lambda n: f"{n} сөз",
        day=lambda d: f"{d.day} {_month(_KK_MONTHS, d)}",
        quoted=lambda t: f"«{t}»",
        left_in_deck=lambda w, t: f"«{t}» жинағында {w} қалды.",
        today_for_deadline=lambda w, t, d: f"Бүгін «{t}» бойынша {w}, {d} дейін үлгеру үшін.",
        today_in_decks=lambda w, ts: f"Бүгін {w}: {ts}.",
        report_yesterday=lambda g, a, b: f"Кеше «{g}» тобында: {b} ішінен {a} уәдесінде тұрды.",
        report_on=lambda d, g, a, b: f"{d}, «{g}» тобында: {b} ішінен {a} уәдесінде тұрды.",
        deadline_today=lambda t: f"Бүгін «{t}» мерзімі.",
        deadline_ready=lambda t: f"Бүгін «{t}» мерзімі: сіз дайынсыз.",
        deadline_left=lambda t, w: f"Бүгін «{t}» мерзімі: {w} қалды.",
        study_day="Бүгін оқу күні",
        lesson_waits="Сізді сабақ күтіп тұр.",
        deadline_title="Мерзім бүгін",
        words_title="Сабаққа сөздер",
        report_title="Топ есебі",
        not_yet_title="Бүгін әлі оқымадыңыз",
        still_time="Уәдеңізде тұруға әлі уақыт бар.",
    ),
    "ky": Texts(
        words=lambda n: f"{n} сөз",
        day=lambda d: f"{d.day}-{_month(_KY_MONTHS, d)}",
        quoted=lambda t: f"«{t}»",
        left_in_deck=lambda w, t: f"«{t}» топтомунда {w} калды.",
        today_for_deadline=lambda w, t, d: f"Бүгүн «{t}» боюнча {w}, {d} чейин үлгүрүү үчүн.",
        today_in_decks=lambda w, ts: f"Бүгүн {w}: {ts}.",
        report_yesterday=lambda g, a, b: f"Кечээ «{g}» тобунда: {b} ичинен {a} убадасын аткарды.",
        report_on=lambda d, g, a, b: f"{d}, «{g}» тобунда: {b} ичинен {a} убадасын аткарды.",
        deadline_today=lambda t: f"Бүгүн «{t}» мөөнөтү.",
        deadline_ready=lambda t: f"Бүгүн «{t}» мөөнөтү: сиз даярсыз.",
        deadline_left=lambda t, w: f"Бүгүн «{t}» мөөнөтү: {w} калды.",
        study_day="Бүгүн окуу күнү",
        lesson_waits="Сизди сабак күтүп турат.",
        deadline_title="Мөөнөт бүгүн",
        words_title="Сабакка сөздөр",
        report_title="Топтун отчету",
        not_yet_title="Бүгүн али окуй элексиз",
        still_time="Убадаңызды аткарууга дагы убакыт бар.",
    ),
    "tg": Texts(
        words=lambda n: f"{n} калима",
        day=lambda d: f"{d.day} {_month(_TG_MONTHS, d)}",
        quoted=lambda t: f"«{t}»",
        left_in_deck=lambda w, t: f"Дар «{t}» {w} монд.",
        today_for_deadline=lambda w, t, d: f"Имрӯз {w} аз «{t}», то {d} расидан.",
        today_in_decks=lambda w, ts: f"Имрӯз {w}: {ts}.",
        report_yesterday=lambda g, a, b: f"Дирӯз дар «{g}»: {a} аз {b} ба ваъда вафо карданд.",
        report_on=lambda d, g, a, b: f"{d} дар «{g}»: {a} аз {b} ба ваъда вафо карданд.",
        deadline_today=lambda t: f"Имрӯз мӯҳлати «{t}».",
        deadline_ready=lambda t: f"Имрӯз мӯҳлати «{t}»: шумо омодаед.",
        deadline_left=lambda t, w: f"Имрӯз мӯҳлати «{t}»: {w} монд.",
        study_day="Имрӯз рӯзи машғулият аст",
        lesson_waits="Шуморо дарс интизор аст.",
        deadline_title="Мӯҳлат имрӯз",
        words_title="Калимаҳо барои дарс",
        report_title="Ҳисоботи гурӯҳ",
        not_yet_title="Имрӯз ҳанӯз машғул нашудед",
        still_time="Барои вафо ба ваъда ҳанӯз вақт ҳаст.",
    ),
}


def texts_for(language: str | None) -> Texts:
    """An account with no language yet reads Russian, as everyone did before it had a choice."""
    return TEXTS.get(language or DEFAULT, TEXTS[DEFAULT])
