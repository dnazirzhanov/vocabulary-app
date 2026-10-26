import { useEffect, useState } from 'react';
import { plural } from '../i18n/plural.ts';
import { api } from '../lib/api.ts';
import { placeOrdinal } from '../lib/board.ts';
import type { Board } from '../lib/types.ts';
import styles from './HomeScreen.module.css';

type State = { kind: 'loading' } | { kind: 'none' } | { kind: 'board'; board: Board; groups: number };

/** Friends on home: your place in your group this week, or an invitation to start one. */
export function FriendsCard({ onOpen }: { onOpen: (groupId: string | null) => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    void api
      .groups()
      .then(async (groups) =>
        groups.length === 0
          ? setState({ kind: 'none' })
          : setState({ kind: 'board', board: await api.board(groups[0].id), groups: groups.length }),
      )
      .catch(() => setState({ kind: 'none' })); // secondary on home: never blocks learning
  }, []);

  if (state.kind === 'loading') return null;
  if (state.kind === 'none') {
    return (
      <button type="button" className={styles.friends} onClick={() => onOpen(null)}>
        <strong>Учитесь с друзьями</strong>
        <span>Создайте группу и позовите друзей или класс по ссылке или QR-коду.</span>
      </button>
    );
  }
  const { board } = state;
  const me = board.rows.find((row) => row.is_me);
  const others = board.group.member_count - 1;
  const where = me?.rank
    ? `вы на ${placeOrdinal(me.rank)} месте из ${board.group.member_count}`
    : others > 0
      ? 'сделайте урок — и попадёте в таблицу недели'
      : 'пригласите друзей по ссылке или QR-коду';
  return (
    <button type="button" className={styles.friends} onClick={() => onOpen(state.groups > 1 ? null : board.group.id)}>
      <strong>{board.group.name}</strong>
      <span>
        {where}
        {me &&
          me.days_practised > 0 &&
          ` · ${me.days_practised}\u00a0${plural(me.days_practised, { one: 'день', few: 'дня', many: 'дней' })} на этой неделе`}
      </span>
    </button>
  );
}
