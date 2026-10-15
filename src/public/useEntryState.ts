import { useEffect, useState } from 'react';
import type { Session } from '../../shared/registration';
export function useEntryState() {
  const [state, setState] = useState<'unknown' | 'anonymous' | 'complete' | 'gate'>('unknown');
  useEffect(() => {
    let controller: AbortController | undefined;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      controller?.abort();
      controller = new AbortController();
      setState('unknown');
      try {
        const response = await fetch('/api/auth/session', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (generation !== current) return;
        if (response.status === 401) {
          setState('anonymous');
          return;
        }
        if (!response.ok) return;
        const session: Session = await response.json();
        if (
          !session ||
          !['complete', 'challenge', 'enrollment', 'recovery_enrollment'].includes(
            session.authState,
          ) ||
          typeof session.passwordChangeRequired !== 'boolean'
        )
          return;
        if (generation === current)
          setState(
            session.authState === 'complete' && !session.passwordChangeRequired
              ? 'complete'
              : 'gate',
          );
      } catch {
        /* Neutral entry remains available after unavailable session reads. */
      }
    };
    void load();
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel('hospital-staff-session');
    if (channel) channel.onmessage = () => void load();
    const focus = () => void load();
    const visibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      generation++;
      controller?.abort();
      channel?.close();
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return state;
}
