/**
 * Runs `work` after every earlier call has finished, here and, where the browser has locks, in the
 * app's other tabs: two answers to one card (a double tap, a second tab) are then checked one
 * after the other, never both against the same state.
 */
export function serializer(name: string, locks: LockManager | undefined = globalThis.navigator?.locks) {
  let last: Promise<unknown> = Promise.resolve();
  return function serial<T>(work: () => Promise<T>): Promise<T> {
    const guarded = () => (locks ? locks.request(name, work) : work());
    const next = last.then(guarded, guarded);
    last = next.catch(() => undefined);
    return next;
  };
}
