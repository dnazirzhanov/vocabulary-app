import { wordsLabel } from '../lib/pace.ts';
import type { GenerateResult } from '../lib/types.ts';
import styles from './DeckEditor.module.css';
import { t } from '../i18n/index.ts';

const SKIPPED: Record<GenerateResult['skipped'][number]['reason'], string> = {
  duplicate: t.alreadyThere,
  invalid: t.notAWord,
  too_long: t.tooLong,
  full: t.noRoom,
};

/** What a draft added, what it couldn't, and a word when the cards are demo placeholders. */
export function DraftResult({ result }: { result: GenerateResult }) {
  const review = t.checkThemInTheList;
  return (
    <>
      <p className={styles.done}>
        {result.added > 0 ? t.added(wordsLabel(result.added), review) : t.noNewWordsAddedEverythingIs}
      </p>
      {result.skipped.length > 0 && (
        <p className={styles.note}>
          {t.notAdded} {result.skipped.map((item) => `${item.headword} (${SKIPPED[item.reason]})`).join(', ')}.
        </p>
      )}
      {result.provider === 'demo' && <p className={styles.demo}>{t.demoModeTheTranslationsArenT}</p>}
    </>
  );
}
