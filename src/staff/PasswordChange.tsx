import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '../../shared/registration';
import { ApiError, request } from './api';
export default function PasswordChange({
  session,
  onDirty,
  onPending,
  onSessionError,
  onChanged,
}: {
  session: Session;
  onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void;
  onSessionError: (error: unknown) => void;
  onChanged: (message: string) => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    onDirty(Boolean(current || next || confirm));
  }, [current, next, confirm, onDirty]);
  useEffect(() => {
    onPending(busy);
  }, [busy, onPending]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (next !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await request('/api/auth/password', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!alive.current) return;
      onChanged(
        'Password changed. Sign in with your new password. All previous sessions have ended.',
      );
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.status === 401) onSessionError(error);
      else {
        setError(
          error instanceof Error ? error.message : 'Password change could not be confirmed.',
        );
        setUncertain(!(error instanceof ApiError) || error.status === 0 || error.status >= 500);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="staff-password">
      <div className="page-heading">
        <div>
          <h1>Change password</h1>
          <p>
            {session.passwordChangeRequired
              ? 'Replace your temporary password before accessing the workspace.'
              : 'Choose a private password for your staff account.'}
          </p>
        </div>
      </div>
      <form className="panel" onSubmit={submit}>
        <p>Use at least 12 characters. Changing your password signs out all your sessions.</p>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {uncertain && (
          <p role="status" className="notice warning">
            The response was lost. Retry with the same details, or sign out and try your new
            password. If it was saved, the previous session has already ended.
          </p>
        )}
        <label htmlFor="change-current">Current password</label>
        <input
          id="change-current"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          disabled={busy || uncertain}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <label htmlFor="change-new">New password</label>
        <input
          id="change-new"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={256}
          disabled={busy || uncertain}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <label htmlFor="change-confirm">Confirm new password</label>
        <input
          id="change-confirm"
          type="password"
          autoComplete="new-password"
          required
          maxLength={256}
          disabled={busy || uncertain}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button className="primary" disabled={busy}>
          {busy
            ? 'Changing password…'
            : uncertain
              ? 'Retry password change'
              : 'Change password and sign out'}
        </button>
      </form>
    </section>
  );
}
