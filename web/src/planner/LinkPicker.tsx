/**
 * Choosing a group task's material (ADR 0096): a deck, a reading, an essay question, a speaking
 * question or a shadowing exercise, kind by kind, with a search. Opens inside the quick add, as
 * the date picker does.
 */
import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n/index.ts';
import type { LinkKind } from './api.ts';
import { LINK_KINDS, pickable, type Pickable } from './links.ts';
import styles from './Planner.module.css';

export const kindName = (kind: LinkKind): string =>
  ({
    deck: t.decks,
    reading: t.reading,
    writing: t.writing,
    speaking: t.speaking,
    shadowing: t.shadowingTitle,
  })[kind];

export function LinkPicker({
  chosen,
  onPick,
}: {
  chosen: string | null;
  onPick: (link: { kind: LinkKind; ref: string; title: string }) => void;
}) {
  const [kind, setKind] = useState<LinkKind>('deck');
  const [lists, setLists] = useState<Partial<Record<LinkKind, Pickable[] | 'failed'>>>({});
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (lists[kind]) return;
    let live = true;
    pickable(kind).then(
      (items) => live && setLists((now) => ({ ...now, [kind]: items })),
      () => live && setLists((now) => ({ ...now, [kind]: 'failed' })),
    );
    return () => {
      live = false;
    };
  }, [kind, lists]);

  const list = lists[kind];
  const shown = useMemo(() => {
    if (!Array.isArray(list)) return [];
    const q = query.trim().toLowerCase();
    return q ? list.filter((i) => `${i.title} ${i.note ?? ''}`.toLowerCase().includes(q)) : list;
  }, [list, query]);

  return (
    <div className={styles.linkPicker}>
      <div className={styles.linkTabs} role="tablist" aria-label={t.linkMaterial}>
        {LINK_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === kind}
            className={styles.linkTab}
            onClick={() => {
              setKind(k);
              setQuery('');
            }}
          >
            {kindName(k)}
          </button>
        ))}
      </div>
      <input
        className={styles.linkSearch}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.linkSearch}
        aria-label={t.linkSearch}
      />
      {list === 'failed' ? (
        <p className={styles.problem} role="alert">
          {t.linkLoadError}
        </p>
      ) : !list ? (
        <p className={styles.linkNote}>{t.loading}</p>
      ) : shown.length === 0 ? (
        <p className={styles.linkNote}>{t.linkEmpty}</p>
      ) : (
        <ul className={styles.linkList} role="list">
          {shown.map((item) => (
            <li key={item.ref}>
              <button
                type="button"
                className={styles.linkItem}
                aria-pressed={chosen === `${kind}:${item.ref}`}
                onClick={() => onPick({ kind, ref: item.ref, title: item.title })}
              >
                <span className={styles.linkItemTitle} lang={kind === 'deck' ? undefined : 'en'}>
                  {item.title}
                </span>
                {item.note && <span className={styles.linkItemNote}>{item.note}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
