import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import styles from './Groups.module.css';
import { t } from '../i18n/index.ts';

const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
const isLocal = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);

/** Those who may reset the link (ADR 0040): the group, and what to do with its new code. */
interface ResetLink {
  groupId: string;
  onReset: (code: string) => void;
}

interface InviteDialogProps {
  code: string;
  groupName: string;
  open: boolean;
  onClose: () => void;
  reset?: ResetLink;
}

/**
 * The invitation in a modal window: a QR code, the code, the link, and ways to copy, share or save
 * it. Everything is made in the browser, so the code never reaches another service.
 */
export function InviteDialog({ code, groupName, open, onClose, reset }: InviteDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={t.inviteFriends}>
      <InviteContent code={code} groupName={groupName} reset={reset} />
    </Dialog>
  );
}

/** «Новая ссылка»: asks once, since the old link and QR code stop working. */
function NewLink({ groupId, onReset }: ResetLink) {
  const [asking, setAsking] = useState(false);
  const { run, busy, error } = useAsyncAction();
  return (
    <div className={styles.newLink}>
      {asking ? (
        <>
          <p className={styles.hint}>{t.theOldLinkAndQRCode}</p>
          <span className={styles.confirm}>
            <button
              type="button"
              className={styles.dangerButton}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  onReset((await api.resetInvite(groupId)).invite_code);
                  setAsking(false);
                })
              }
            >
              {t.yesCreate}
            </button>
            <SecondaryButton type="button" className={styles.smallSecondary} onClick={() => setAsking(false)}>
              {t.cancel}
            </SecondaryButton>
          </span>
        </>
      ) : (
        <button type="button" className={styles.linkButton} onClick={() => setAsking(true)}>
          {t.newLink}
        </button>
      )}
      {error && (
        <p className={styles.problem} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function InviteContent({ code, groupName, reset }: { code: string; groupName: string; reset?: ResetLink }) {
  const link = `${location.origin}/join/${code}`;
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void QRCode.toDataURL(link, { margin: 1, width: 480, color: { dark: '#262626', light: '#ffffff' } }).then(setQr);
  }, [link]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <p className={styles.hint}>{t.haveFriendsOpenTheLinkOr}</p>
      {qr && <img className={styles.qr} src={qr} alt={t.qrCodeToJoinTheGroup(groupName)} />}
      <p className={styles.code}>
        {t.code} <strong>{code.replace(/(.{4})/, '$1 ')}</strong>
      </p>
      <div className={styles.linkRow}>
        <input className={styles.linkInput} readOnly value={link} aria-label={t.inviteLink} />
        <button type="button" className={styles.smallButton} onClick={() => void copy()}>
          {copied ? (
            <>
              <CheckIcon aria-hidden="true" /> {t.copied}
            </>
          ) : (
            t.copy
          )}
        </button>
      </div>
      <div className={styles.inviteActions}>
        {canShare && (
          <button
            type="button"
            className={styles.smallButton}
            onClick={() =>
              void navigator
                .share({ title: groupName, text: t.letSLearnEnglishTogether, url: link })
                .catch(() => undefined)
            }
          >
            {t.share}
          </button>
        )}
        {qr && (
          <a className={styles.smallButton} href={qr} download={`priglashenie-${code}.png`}>
            {t.downloadTheQRCode}
          </a>
        )}
      </div>
      {reset && <NewLink {...reset} />}
      {isLocal && <p className={styles.note}>{t.theAppOnlyRunsOnThis}</p>}
    </>
  );
}
