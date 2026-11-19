export class AppError extends Error {
  readonly title: string;
  readonly detail?: string;

  constructor(title: string, detail?: string) {
    super(detail ?? title);
    this.name = 'AppError';
    this.title = title;
    this.detail = detail;
  }
}

export class UserCancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'UserCancelledError';
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof UserCancelledError) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

export function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Conversion cancelled', 'AbortError');
  }
}
