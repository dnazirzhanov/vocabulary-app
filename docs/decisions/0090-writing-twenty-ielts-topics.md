# 0090 — Writing: only IELTS, on the 20 topics the exam asks most; a roomier editor; one card design

**Status:** Accepted (the owner, 25 November 2026: «delete all the non ielts questions … put top 20 common ielts topics
in 2026 … 5 questions inside each category … make the input box … larger … the way all of my essays are shown is so
cringe, inconsistent sizes and design»). Amends 0081 and 0082.

## Decision
- **The old general questions are gone, with their essays, for good** (asked: delete permanently, not hide).
  - A migration deletes every essay not answered to an IELTS question (`question_id` not `ielts-…`).
  - On production that is 6 essays of 7, all one learner's (counted read-only before the release).
  - Nothing refers to an essay, so nothing else changes; there is no way back.
- **20 topics, 5 questions each (100).** The topics are those that preparation sources (IDP, Cathoven, ECE and
  others) agree come up most in Task 2, with 2026's lean towards AI, mental health and sustainability:
  - Education; Technology & AI; Environment & Climate; Health; Work & Careers; Government & Society;
  - Crime & Punishment; Globalisation; Culture & Arts; Media & Advertising; Family & Children;
  - Cities & Housing; Transport; Travel & Tourism; Sport & Leisure; Science & Space; Language; Food & Diet;
  - Money & Consumerism; Population & Ageing.

  No official list of 2026 prompts exists; the questions are written for the app in the exam's five types, never
  copied. The forty earlier IELTS questions keep their ids under the new topics, so their essays keep their
  question.
- **The editor uses a computer's room:** from 1024 px the writing column is 60rem wide (was 44rem) and the sheet at
  least 62% of the screen's height. Phones are as before.
- **«Все мои эссе», one card design.** Topic, question and attempt are the same card:
  - a top line (what and how many on the left; the band as a pill on the right, or «Не проверено»);
  - then the title, or the essay's start in two lines.

  Topic cards fill an even grid and share one height, as do the topic cards on Writing's home.

## Consequences
- An essay answered to a question since removed would show its id as its title; none remain.
