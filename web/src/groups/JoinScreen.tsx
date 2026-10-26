import { useEffect, useRef, useState } from 'react';
import { plural } from '../i18n/plural.ts';
import { api, ApiError, describeError } from '../lib/api.ts';
import { suggestNicknames } from '../lib/nickname.ts';
import type { GroupPreview } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { BackIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { NicknamePicker, nicknameReady } from './NicknamePicker.tsx';
import styles from './Groups.module.css';

const members = (n: number) => `${n}\u00a0${plural(n, { one: 'участник', few: 'участника', many: 'участников' })}`;

interface JoinScreenProps {
  code: string;
  onJoined: (groupId: string) => void;
  onCancel: () => void;
}

/** Arriving from an invite link, QR code or typed code: see the group, pick a nickname, join. */
export function JoinScreen({ code, onJoined, onCancel }: JoinScreenProps) {
  const [preview, setPreview] = useState<GroupPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [nickname, setNickname] = useState(() => suggestNicknames(1)[0]);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void api
      .previewInvite(code)
      .then(setPreview, (caught: unknown) =>
        setProblem(
          caught instanceof ApiError && caught.status === 404
            ? 'Такой группы нет. Проверьте код или попросите новую ссылку.'
            : caught instanceof ApiError && caught.status === 429
              ? 'Слишком много попыток. Подождите минуту.'
              : describeError(caught),
        ),
      );
  }, [code]);
  useEffect(() => headingRef.current?.focus(), [preview, problem]);

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onCancel}>
          <BackIcon aria-hidden="true" /> Не сейчас
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          {problem && (
            <>
              <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
                Приглашение не найдено
              </h1>
              <p className={styles.lead}>{problem}</p>
            </>
          )}
          {!problem && !preview && <p aria-busy="true">Загружаем…</p>}
          {preview && (
            <>
              <p className={styles.eyebrow}>Вас пригласили в группу</p>
              <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
                {preview.name}
              </h1>
              <p className={styles.meta}>{members(preview.member_count)}</p>
              <p className={styles.lead}>
                В группе видно только ваше имя здесь и сколько дней вы занимались на этой неделе. E-mail никто не
                увидит, переписки нет.
              </p>
              {preview.already_member ? (
                <p className={styles.lead}>Вы уже в этой группе.</p>
              ) : (
                <div className={styles.card}>
                  <NicknamePicker value={nickname} onChange={setNickname} />
                  {error && (
                    <p className={styles.problem} role="alert">
                      {error}
                    </p>
                  )}
                </div>
              )}
              <PrimaryButton
                type="button"
                className={styles.wide}
                disabled={busy || (!preview.already_member && !nicknameReady(nickname))}
                aria-busy={busy}
                onClick={() => run(async () => onJoined((await api.joinGroup(code, nickname)).id))}
              >
                {preview.already_member ? 'Открыть группу' : busy ? 'Вступаем…' : 'Вступить'}
              </PrimaryButton>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
