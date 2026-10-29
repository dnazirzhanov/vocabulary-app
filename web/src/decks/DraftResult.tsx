import { wordsLabel } from '../lib/pace.ts';
import type { GenerateResult } from '../lib/types.ts';
import styles from './DeckEditor.module.css';

const SKIPPED: Record<GenerateResult['skipped'][number]['reason'], string> = {
  duplicate: 'уже есть',
  invalid: 'не слово',
  too_long: 'слишком длинное',
  full: 'нет места',
};

/** What a draft added, what it couldn't, and a word when the cards are demo placeholders. */
export function DraftResult({ result, forGroup }: { result: GenerateResult; forGroup: boolean }) {
  const review = forGroup
    ? 'Проверьте их в списке — ученики увидят слова, только когда вы зададите набор.'
    : 'Проверьте их в списке.';
  return (
    <>
      <p className={styles.done}>
        {result.added > 0
          ? `Добавлено: ${wordsLabel(result.added)}. ${review}`
          : 'Новых слов не добавлено: всё уже есть в колоде.'}
      </p>
      {result.skipped.length > 0 && (
        <p className={styles.note}>
          Не добавлены: {result.skipped.map((item) => `${item.headword} (${SKIPPED[item.reason]})`).join(', ')}.
        </p>
      )}
      {result.provider === 'demo' && (
        <p className={styles.demo}>
          Демо-режим: переводы ненастоящие. Чтобы карточки составлял DeepSeek, добавьте DEEPSEEK_API_KEY в .env сервера.
        </p>
      )}
    </>
  );
}
