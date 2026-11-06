import { CheckIcon, ShareIcon } from '../ui/icons.tsx';
import styles from './GiveButton.module.css';
import { t } from '../i18n/index.ts';

/**
 * «Дать группе» as a small labelled button (ADR 0036), the same on the deck editor's «Новые
 * карточки» card and on a deck's own page: once the deck is given it says where, with a check.
 */
export function GiveButton({ groups, onClick }: { groups: { name: string }[]; onClick: () => void }) {
  return (
    <button type="button" className={styles.button} onClick={onClick} aria-haspopup="dialog">
      {groups.length === 0 ? (
        <>
          <ShareIcon aria-hidden="true" /> {t.giveToAGroup}
        </>
      ) : (
        <>
          <CheckIcon aria-hidden="true" />
          <span className={styles.name}>
            {groups.length === 1 ? t.inTheGroup(groups[0].name) : t.inGroups(groups.length)}
          </span>
        </>
      )}
    </button>
  );
}
