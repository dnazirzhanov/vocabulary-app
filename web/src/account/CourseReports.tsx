import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { withSnapshot } from '../local/session.ts';
import { ReportsDialog } from '../reports/ReportsDialog.tsx';
import styles from './AccountSection.module.css';
import { t } from '../i18n/index.ts';

/** For the content editors only: what learners said is wrong on the course's cards. */
export function CourseReports() {
  const [editor, setEditor] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void withSnapshot('me', () => api.me()).then(
      ({ value }) => setEditor(value.content_editor === true),
      () => undefined,
    );
  }, []);
  if (!editor) return null;
  return (
    <>
      <button type="button" className={styles.wordingLink} onClick={() => setOpen(true)}>
        {t.cardReports}
      </button>
      {open && <ReportsDialog load={api.courseReports} onClose={() => setOpen(false)} />}
    </>
  );
}
