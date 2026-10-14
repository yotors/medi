import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../shared/registration';
import type { InventoryCommand, InventoryResult, PharmacyCommand } from '../../shared/inventory';
import { ApiError, request } from './api';
type Submission = { path: string; key: string; command: InventoryCommand | PharmacyCommand };
export function useInventoryMutation(
  session: Session,
  onPending: (pending: boolean) => void,
  onSessionError: (error: unknown) => void,
  onSuccess: (result: InventoryResult) => void,
  onConflict: () => void,
) {
  const [pending, setPending] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const mounted = useRef(false);
  const inflight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    onPending(Boolean(pending));
  }, [pending, onPending]);
  async function run(submission: Submission) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setPending(submission);
    onPending(true);
    setError('');
    try {
      const result = await request<InventoryResult>(submission.path, {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': submission.key },
        body: JSON.stringify(submission.command),
      });
      if (!mounted.current) return;
      setPending(null);
      onPending(false);
      setConflict(false);
      onSuccess(result);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiError && error.status > 0 && error.status < 500) {
        setPending(null);
        onPending(false);
      }
      if (error instanceof ApiError && error.status === 401) onSessionError(error);
      else {
        setError(
          error instanceof Error
            ? error.message
            : 'The inventory save failed. Retry the same request.',
        );
        if (error instanceof ApiError && error.status === 409) {
          setConflict(true);
          onConflict();
        }
      }
    } finally {
      inflight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    pending,
    busy,
    error,
    conflict,
    clear: () => {
      setError('');
      setConflict(false);
    },
    retry: () => {
      if (pending) void run(pending);
    },
    save: (path: string, command: InventoryCommand | PharmacyCommand) => {
      if (!pending && !inflight.current) void run({ path, command, key: crypto.randomUUID() });
    },
  };
}
