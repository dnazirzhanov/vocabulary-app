# Reading Mode: adding translation languages

Reading Mode starts with **Russian** meanings only. This page is the checklist for adding the other
card languages the app already supports (`ky`, `kk`, `uz`, `tg`; see ADR 0055 and
`web/src/i18n/languages.ts`) without restructuring anything.

## How a meaning is stored
Each glossary entry keeps one field **per language**, named by its language code:
```yaml
hive: {pos: noun, ru: улей, ky: уюк, def: a home that bees live in}
```
- `def` is the simple-English explanation, shared by every language.
- `lemma` and `pos` are shared too.
- Only the translation is per language.

The same shape is used by `content/glossary.yaml`, so a language added there also fills the
common words of every article.

## Steps to add a language (example: Kyrgyz, `ky`)
1. **Write and review the meanings:** add `ky:` to the entries of each article's `glossary:`, and to
   `content/glossary.yaml` for the common words. A fluent speaker reviews them, as with the course.
2. **Allow the language in the validator** (`backend/tests/test_reading_content.py`): an article
   lists the languages it is complete in (`languages: [ru, ky]`). The test fails if any word of a
   listed language lacks its meaning. An article may stay Russian-only while others gain Kyrgyz.
3. **Rebuild:** `content/tools/build_reading.py` copies every language field into the JSON. No
   code change is needed.
4. **The reader** chooses the learner's card language (`me.language`):
   - if the article has it, the sheet shows that language;
   - if not, it shows Russian with a small «перевод на русском» note, or the English definition
     alone if the learner prefers (a setting for later);
   - saved cards take the language shown (`addCard({..., language})`), so a Kyrgyz learner's deck
     is in Kyrgyz.
5. **The library** marks articles complete in the learner's language and can filter by it (a chip,
   added only when at least one article has a second language).
6. **Interface text:** any new words in the reader UI get all six app languages, as every UI string
   must (`web/src/i18n/*.ts`; the unit test fails on a missing or untranslated key).

## What not to do
- **No AI on tap** for other languages. Meanings are prepared and reviewed in advance, and the
  experiment depends on taps being instant and offline.
- **No machine-translating whole articles.** Learners read English; only word meanings (and, later,
  optional sentence translations) are translated.
- **No separate file per language.** One file per article with a field per language keeps a word's
  meanings together and the build simple.

## Effort estimate
For an 1,000-word article, about 250–350 distinct forms need a meaning. The common ones come from
`glossary.yaml`, so about 100–200 per article are new. A draft is fast; the native-speaker review
is the real cost, and it is the same review the course needs.
