import { ConflictError } from '../api/core';

export interface RunMutationOptions<T> {
  /** The API call to execute. Throws on failure. */
  call: () => Promise<T>;

  /** Called on success with the result. */
  onSuccess: (result: T) => void | Promise<void>;

  /**
   * Called when the API throws ConflictError. Responsible for surfacing the
   * conflict to the user (e.g. set a toast message) and for refreshing any
   * stale cached data before retrying. If omitted, the conflict is forwarded
   * to `onError` with `conflictMessage` (or the default message).
   */
  onConflict?: (message: string) => void | Promise<void>;

  /** Called when the API throws a non-conflict error. Receives the error message. */
  onError: (message: string) => void;

  /** Called before the call (typically setBusy(true) and clearing status). */
  onStart?: () => void;

  /** Called in finally (typically setBusy(false)). Runs even on error. */
  onFinally?: () => void;

  /** Message passed to `onConflict` (or `onError` when `onConflict` is omitted). */
  conflictMessage?: string;
}

const DEFAULT_CONFLICT_MESSAGE = 'Data was changed elsewhere — please retry.';

export async function runMutation<T>(opts: RunMutationOptions<T>): Promise<void> {
  opts.onStart?.();
  try {
    const result = await opts.call();
    await opts.onSuccess(result);
  } catch (err) {
    if (err instanceof ConflictError) {
      const msg = opts.conflictMessage ?? DEFAULT_CONFLICT_MESSAGE;
      if (opts.onConflict) {
        await opts.onConflict(msg);
      } else {
        opts.onError(msg);
      }
    } else {
      opts.onError((err as Error).message);
    }
  } finally {
    opts.onFinally?.();
  }
}
