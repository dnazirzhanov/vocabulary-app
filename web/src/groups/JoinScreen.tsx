import { useEffect, useRef, useState } from 'react';
import { api, ApiError, describeError } from '../lib/api.ts';
import type { GroupPreview } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { BackIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './Groups.module.css';
import { t } from '../i18n/index.ts';

const members = (n: number) => t.membersCount(n);

interface JoinScreenProps {
  code: string;
  onJoined: (groupId: string) => void;
  onCancel: () => void;
}

/** Arriving from an invite link, QR code or typed code: see the group and join, under my name (ADR 0057). */
export function JoinScreen({ code, onJoined, onCancel }: JoinScreenProps) {
  const [preview, setPreview] = useState<GroupPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void api
      .previewInvite(code)
      .then(setPreview, (caught: unknown) =>
        setProblem(
          caught instanceof ApiError && caught.status === 404
            ? t.thereSNoSuchGroupCheck
            : caught instanceof ApiError && caught.status === 429
              ? t.tooManyAttemptsWaitAMinute
              : describeError(caught),
        ),
      );
  }, [code]);
  useEffect(() => headingRef.current?.focus(), [preview, problem]);

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onCancel}>
          <BackIcon aria-hidden="true" /> {t.notNow}
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          {problem && (
            <>
              <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
                {t.invitationNotFound}
              </h1>
              <p className={styles.lead}>{problem}</p>
            </>
          )}
          {!problem && !preview && <p aria-busy="true">{t.loading}</p>}
          {preview && (
            <>
              <p className={styles.eyebrow}>{t.invitedToGroup}</p>
              <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
                {preview.name}
              </h1>
              <p className={styles.meta}>{members(preview.member_count)}</p>
              <p className={styles.lead}>{t.theGroupOnlySeesYourName}</p>
              {preview.already_member && <p className={styles.lead}>{t.youReAlreadyInThisGroup}</p>}
              {error && (
                <p className={styles.problem} role="alert">
                  {error}
                </p>
              )}
              <PrimaryButton
                type="button"
                className={styles.wide}
                disabled={busy}
                aria-busy={busy}
                onClick={() => run(async () => onJoined((await api.joinGroup(code)).id))}
              >
                {preview.already_member ? t.openTheGroup : busy ? t.joining : t.join}
              </PrimaryButton>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
