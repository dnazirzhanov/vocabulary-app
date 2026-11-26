/** Work done one piece after another, in the order it was asked for: a tick, «Отменить» and a tick
 * again reach the server in that order. A failure doesn't stop the pieces after it. */
export class Serial {
  private last: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.last.then(work);
    this.last = next.catch(() => undefined);
    return next;
  }
}
