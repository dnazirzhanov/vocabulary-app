/**
 * Answers in a test save in the background (ADR 0069), so moving between words never waits for the
 * network: one save at a time, in the order given, each retried until it lands. A newer answer to a
 * word replaces one still waiting for it. `idle()` resolves once everything is saved, which handing
 * in waits for.
 */
export interface Save {
  key: string;
  /** null leaves the word empty (skipped). */
  answer: string | null;
}

/** Thrown by `save` when retrying is pointless (the attempt is gone): the queue stops. */
export class StopSaving extends Error {}

const BACKOFF_MS = [1000, 2000, 4000, 8000];

export class SaveQueue {
  private items: Save[] = [];
  private running = false;
  private stopped = false;
  private waiting: (() => void)[] = [];
  private readonly save: (item: Save) => Promise<void>;
  /** True while a save keeps failing (no connection): the screen says so quietly. */
  private readonly onTrouble: (trouble: boolean) => void;
  private readonly wait: (ms: number) => Promise<void>;

  constructor(
    save: (item: Save) => Promise<void>,
    onTrouble: (trouble: boolean) => void,
    wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
  ) {
    this.save = save;
    this.onTrouble = onTrouble;
    this.wait = wait;
  }

  get pending(): number {
    return this.items.length;
  }

  push(item: Save) {
    if (this.stopped) return;
    // The one being sent (first, while running) stays; a waiting one for the same word is replaced.
    const from = this.running ? 1 : 0;
    this.items = [...this.items.slice(0, from), ...this.items.slice(from).filter((x) => x.key !== item.key), item];
    void this.run();
  }

  /** Resolves when nothing is left to save (or saving has stopped). */
  idle(): Promise<void> {
    if (this.items.length === 0 || this.stopped) return Promise.resolve();
    return new Promise((done) => this.waiting.push(done));
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    let failures = 0;
    while (this.items.length > 0 && !this.stopped) {
      try {
        await this.save(this.items[0]);
        this.items.shift();
        if (failures > 0) this.onTrouble(false);
        failures = 0;
      } catch (error) {
        if (error instanceof StopSaving) {
          this.stopped = true;
          this.items = [];
          break;
        }
        if (failures === 0) this.onTrouble(true);
        await this.wait(BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]);
        failures += 1;
      }
    }
    this.running = false;
    const waiting = this.waiting;
    this.waiting = [];
    waiting.forEach((done) => done());
  }
}
