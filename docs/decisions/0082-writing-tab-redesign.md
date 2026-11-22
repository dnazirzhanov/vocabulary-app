# 0082 — The Writing tab, redesigned

**Status:** Accepted (the owner, 21 November 2026: «simple and easy to navigate, I like that. But still the UX is
disgusting… learn from the best 10 options»).

## Ten references
Grammarly (inline marks and side cards), Cambridge Write & Improve (sentence shading, a level), British Council Road to
IELTS (the exam framed plainly), IELTS Liz / IELTS Simon (band and criterion first, then specifics), Duolingo English
Test (one task, one clear result), LanguageTool (numbered issues), Hemingway (the text stays readable while marked),
Google Docs suggestion mode (struck and inserted text in place), iA Writer (a quiet writing surface), Notion (calm
layout, few boxes).

What they agree on: say what the task is; let the text read normally while it is marked; give the overall result
first and the specifics beside the text; make one next step obvious; never a wall of advice.

## Decision
The flow stays: topics → questions → write → feedback.
- **Home:** «IELTS Writing · Task 2», what it is in one line, the learner's last and best band and how many essays,
  the eight topics as a grid (two columns on phones, four on desktop), recent essays with an «IELTS 6.5» tag.
- **Questions:** the exam's instruction once at the top; each card has its type (Мнение, Обсуждение, Проблема и
  решение, Плюсы и минусы, Два вопроса) and the learner's best band on it, if any.
- **Writing:** the type above the question; «Как на IELTS: не меньше 250 слов, около 40 минут»; the word count fills a
  bar toward 250 (a guide, never a limit); the draft is kept on the device (as before).
- **Feedback:** the overall band large, the four criteria as chips (TR · CC · LR · GRA) that open their tab, a
  two-sentence summary, words and time, and «на экзамене нужно от 250 слов» when shorter. Then the essay with its
  fixes marked and numbered beside the criteria; each criterion shows its full name, band, why (quoting the essay),
  «Чтобы получить N:» and its fixes. It opens on the lowest criterion. «Что делать дальше» is gone.
- Answers marked on the earlier 1–5 scale still open as they were.

Also fixed: the archive's `.essay` style leaked into the feedback page's essay text (each marked mistake on its own
line, a pink background); the archive now has its own class.
