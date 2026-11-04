# How many words make "80% of English"?

Checked 26 October 2026 for the course goal shown to learners (M5).

## Result

From the NGSL 1.2 frequency data ([NGSL_12_stats.csv](https://www.newgeneralservicelist.com/s/NGSL_12_stats.csv)),
computed with `content/tools/ngsl_coverage.py`:

| Most frequent words | Share of running words they cover |
|---|---|
| 100 | 55.4% |
| 500 | 70.9% |
| 1,000 | 77.5% |
| **1,300** | **79.8%** |
| 1,500 | 81.0% |
| 2,000 | 83.2% |
| 2,809 (whole NGSL) | 85.4% |

80.0% is reached at word 1,329. **The course goal is therefore "about 1,300 words ≈ about 80% of the
words in everyday text"**, stored in `content/starter-deck/deck.yaml` (`course_goal`).

## Method and caveats

- "Adjusted Frequency per Million (U)" counts every inflected form of a lemma (*go, goes, went…*), so
  the running total ÷ 1,000,000 is the share of tokens in the NGSL corpus (Cambridge English Corpus,
  general English) covered by the top N lemmas.
- Coverage means *word tokens recognised*, not *meaning understood*. 80% coverage still leaves
  about one unknown word in five; comfortable reading needs far more (research usually cites 95–98%).
  The learner copy promises "80% of the words you meet", never "understand 80% of English".
- The NGSL developers cite about 92% coverage for the whole list; this data gives 85.4%. Their figure
  likely counts differently (for example excluding proper nouns and numbers). Our claim uses the
  lower, reproducible number.
- Source and licence: New General Service List 1.2 (Browne, Culligan & Phillips), CC BY-SA 4.0.
  The CSV is not committed; the script documents how to fetch it.

## Consequence for content

The starter deck was chosen by hand before this goal existed. Of its 30 words, 26 are in the NGSL's
top 1,300. *tired* and *hungry* are not in the NGSL; *empty* (rank 1,592) and *quiet* (1,313) are just
outside. They should be swapped, or kept deliberately as everyday extras, at the Russian content review,
and later decks should follow NGSL order so the promise and the content match.
