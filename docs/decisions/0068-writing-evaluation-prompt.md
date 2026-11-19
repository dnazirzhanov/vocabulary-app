# 0068. Writing: how answers are evaluated

## Decision
The Writing tab (topics → questions → write → feedback) sends each answer to DeepSeek from the
backend, **synchronously in one request**, with **one production prompt**
(`backend/app/services/writing/prompt.py`). The model returns JSON; the backend parses it against
`schema.py`, drops anything that cannot be true of the answer, and computes the overall score
itself. The answer is saved before the model is asked, so a failure never loses it.

- Open to every learner (no tester list). Limit: `WRITING_SUBMISSIONS_PER_DAY` (30).
- One table, `writing_submissions`, unique on `(user_id, client_id)`. The browser makes `client_id`
  once per attempt, so a double tap or a retry is the same attempt: no second model call.
- Not Speaking's job queue: a text check takes ~5–15 s, so no worker is needed.
- Feedback is written in the learner's app language; quotes, corrections and the improved
  version stay in English.
- Score: five criteria (task, organization, vocabulary, grammar, mechanics), each 1–5
  (1 beginning, 2 developing, 3 adequate, 4 good, 5 excellent). The overall score is their mean,
  rounded half up, **by the backend** so the same marks always give the same score.

## Choosing the prompt
Ten candidates, genuinely different in method, all returning the same JSON so they could be compared
automatically: holistic baseline; five-criterion rubric; CEFR-first; task-first; error-first
(proofread, then score); supportive coach; error-density scoring; evidence-gated (every claim
quoted); terse; and a hybrid of these. Run on 6 learner answers (weak A2, intermediate B1, strong
C1, a one-line answer, an off-topic answer, a clean formal email) with `deepseek-flash`, temperature 0.
Planted errors and "traps" (British `maths`, `organise`, `can't`, `young people's`) measured
accuracy; a clean text measured false positives.

| Result (all 10, 1 run each) | Range |
|---|---|
| Valid JSON | 59 of 60 (one list too long) |
| Corrections quoting words really in the answer | 100% for 9 of 10 |
| Planted errors found | 12/13 to 13/13 (terse prompt: 9/13) |
| False corrections on the clean C1 text | 0 (terse prompt: 1) |
| Trap phrases wrongly flagged | 0 for 4 prompts, 1–2 for rubric, CEFR, coach, evidence-gated |
| Tokens per answer | 474 (terse) to 728 |

A 3-run repeat of the four best (error-first, evidence-gated, hybrid, density) showed hybrid
wobbling by a point on weak and intermediate answers (3,3,2 / 3,3,4), error-first and
evidence-gated steadier. Also: 3 of 60 outputs failed validation only because a list had one item
too many, so the schema now cuts lists instead of rejecting.

**Chosen:** the hybrid, plus error-first working order, the evidence rule from the gated prompt,
explicit item limits, and "off-topic or too short → `enough_evidence: false`". Final check, 3 runs
× 6 answers: 18/18 valid; every correction quoted real text (100%); every planted error found
(6/6, 7/7); 0 traps flagged; 0 false corrections on the C1 text and the email; marks identical across
runs (3/3/5/—/—/5); the short and off-topic answers were each declined with a clear message. A
Russian-language run produced correct Russian explanations.

## Limits of this comparison (not hidden)
- Six answers and one model; with the 3-run check this shows reliability, not a statistically
  sound benchmark. "Accuracy" is measured against errors I planted and judged by substring match.
- "Consistency across similar answers" was tested as repeated runs of the same answer, not as
  paraphrases.
- Whether the *scores* are right (is this B1 essay really a 3?) was not validated against human
  markers. Do that with a teacher before relying on the numbers.
- Whether explanations in Uzbek, Kazakh, Kyrgyz and Tajik are good was not checked.
- Re-run the benchmark before changing `prompt.py`.

## Consequences
Each submission is one paid call (~700–1,200 tokens out). Reading `deepseek_model` from settings
means a model change applies to Writing too. Old rows keep the evaluation they were given.
