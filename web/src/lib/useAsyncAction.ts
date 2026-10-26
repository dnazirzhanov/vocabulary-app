import { useCallback, useRef, useState } from 'react';
import { describeError } from './api.ts';

/** Runs one async action at a time; repeated triggers while busy are ignored. */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  return { run, busy, error };
}
