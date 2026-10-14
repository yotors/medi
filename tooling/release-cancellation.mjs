// A single interruption state spans subprocesses and file pipelines.
const controller = new AbortController();
export const interruption = controller.signal;
export function interrupt() {
  controller.abort(Error('Release operation interrupted.'));
}
export function operationSignal({ signal, timeoutMs = 240000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 240000)
    throw Error('Invalid operation deadline.');
  return AbortSignal.any([
    interruption,
    AbortSignal.timeout(timeoutMs),
    ...(signal ? [signal] : []),
  ]);
}
