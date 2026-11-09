/**
 * An API call that failed. No imports, so code that runs without a browser (the study engine and
 * its tests) can raise it too.
 *
 * `network`: no response at all (offline, timeout). `http`: the server answered with an error.
 */
export class ApiError extends Error {
  readonly kind: 'network' | 'http';
  readonly status: number;
  readonly code: string;

  constructor(kind: 'network' | 'http', status: number, code: string, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}
