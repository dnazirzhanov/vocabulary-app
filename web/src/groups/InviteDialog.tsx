import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import styles from './Groups.module.css';

const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
const isLocal = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);

interface InviteDialogProps {
  code: string;
  groupName: string;
  open: boolean;
  onClose: () => void;
}

/**
 * The invitation in a modal window: a QR code, the code, the link, and ways to copy, share or save
 * it. Everything is made in the browser, so the code never reaches another service.
 */
export function InviteDialog({ code, groupName, open, onClose }: InviteDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Пригласить друзей">
      <InviteContent code={code} groupName={groupName} />
    </Dialog>
  );
}

function InviteContent({ code, groupName }: { code: string; groupName: string }) {
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
      <p className={styles.hint}>Пусть друзья откроют ссылку или наведут камеру на QR-код.</p>
      {qr && <img className={styles.qr} src={qr} alt={`QR-код для вступления в группу «${groupName}»`} />}
      <p className={styles.code}>
        Код: <strong>{code.replace(/(.{4})/, '$1 ')}</strong>
      </p>
      <div className={styles.linkRow}>
        <input className={styles.linkInput} readOnly value={link} aria-label="Ссылка-приглашение" />
        <button type="button" className={styles.smallButton} onClick={() => void copy()}>
          {copied ? (
            <>
              <CheckIcon aria-hidden="true" /> Скопировано
            </>
          ) : (
            'Копировать'
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
                .share({ title: groupName, text: 'Учим английский вместе!', url: link })
                .catch(() => undefined)
            }
          >
            Поделиться
          </button>
        )}
        {qr && (
          <a className={styles.smallButton} href={qr} download={`priglashenie-${code}.png`}>
            Скачать QR-код
          </a>
        )}
      </div>
      {isLocal && (
        <p className={styles.note}>
          Сейчас приложение работает только на этом компьютере: ссылка заработает у друзей, когда его опубликуют.
        </p>
      )}
    </>
  );
}
