# 0081 — Writing becomes IELTS Task 2

**Status:** Accepted; replaces the question bank and the rubric of ADR 0068 for new answers (the owner,
21 November 2026: «change all the writing questions to the IELTS writing questions… the feedback should also be like
IELTS feedback… find the best prompt»). Owner's choices: Task 2 essays only; IELTS marking with flexible length.

## Questions
40 original Task 2 questions, 5 on each of the tab's 8 topics, in the exam's five types (opinion, discussion,
problem–solution, advantages–disadvantages, two-part), with the exam's instruction and a 40-minute guide. None is
copied from published IELTS material. The 24 earlier questions move to `RETIRED`: still named on old answers, no
longer offered. New ids (`ielts-<topic>-<n>`); old ids are never reused.

## Marking
Four criteria, a whole band 0–9 each: Task Response, Coherence and Cohesion, Lexical Resource, Grammatical Range and
Accuracy. Each has one sentence of *why* that quotes the essay and one concrete step to the next band. The **overall
band is the backend's**: the mean, rounded as IELTS does (.25 up to .5, .75 up to the next band). Corrections and
vocabulary upgrades must quote the essay word for word or they are dropped. No list of generic «what to do next».
Length: the model is told not to lower any band for under 250 words; the backend records the word count and the
screen says a real exam would mark a short essay down. Old answers keep their 1–5 feedback (`rubric: "general"`).

## Choosing the prompt (`backend/evals/writing_bench.py`)
Ten candidates, all returning the same JSON: holistic, descriptor best-fit, evidence-first, error-first, two-pass
with ceilings, feature checklist, few-shot anchors, strict examiner, next-band coach, hybrid. Ten original essays
written for it (aimed at bands 4, 5, 5.5 with Russian-L1 errors, 6.5, 7.5, 8.5; off-topic; a memorised template; 120
words; 14 words), with 23 planted errors and 9 traps (British spellings, contractions). DeepSeek, temperature 0,
feedback in Russian, 3 runs each; run on the production machine, no database writes.

| Prompt | Valid | Planted found | Traps flagged | Bands in order | MAE | Spread | Refuses 14 words |
|---|---|---|---|---|---|---|---|
| holistic | 27/30 | 62/63 | 5 | no | 0.50 | 1.0 | no |
| descriptors | 30/30 | 77/81 | 10 | yes | 0.64 | 0.5 | yes |
| evidence-first | 29/30 | 73/76 | 3 | yes | 0.54 | 0.5 | yes |
| error-first | 30/30 | 78/81 | 6 | yes | 0.53 | 0.5 | yes |
| two-pass | 30/30 | 78/81 | 5 | yes | 0.44 | 1.0 | 2/3 |
| checklist | 28/30 | 70/72 | 5 | yes | 0.67 | 0.0 | yes |
| anchors | 29/30 | 78/81 | 4 | yes | 0.56 | 1.0 | yes |
| strict | 30/30 | 78/81 | 4 | no | 0.53 | 0.5 | yes |
| coach | 28/30 | 72/76 | 3 | yes | 0.61 | 0.5 | yes |
| hybrid | 30/30 | 78/81 | 6 | yes | 0.47 | 1.0 | yes |

All quoted the essay correctly every time; none marked the 120-word essay down. An eleventh candidate combined the
two steadiest methods (error-first proofreading + bands backed by quotes, no ceilings). Over **5 runs**: 50/50 valid,
130/135 planted errors found, 6 traps flagged (error-first: 9), bands in order, MAE 0.48, no essay moving more than
half a band between runs, ~730 output tokens, ~4.5 s. **Chosen.** `prompt.py` holds it; the benchmark builds every
candidate from the same pieces and asserts the chosen one is the production text.

## Limits (not hidden)
- The intended bands are the author's estimates, not an examiner's. The benchmark shows order and steadiness, not
  that a 6.5 is a 6.5: have an IELTS teacher check a sample before relying on the numbers.
- Every prompt rated the weakest essay 5 where 4 was intended; the scale may be generous at the bottom.
- The off-topic essay gets 5.5–6 overall: Task Response falls to 3–4 but the language is good. That follows the
  criteria, and the feedback says plainly that the question was not answered.
- Feedback in Uzbek, Kazakh, Kyrgyz and Tajik was not checked.
