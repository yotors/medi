import { uiMessage } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
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
      setError(uiMessage('auth:the_new_passwords_do_not_match'));
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
      onChanged(t('common:password_changed'));
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.status === 401) onSessionError(error);
      else {
        setError(
          error instanceof Error ? error.message : t('auth:password_change_could_not_be_confirmed'),
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
          <h1>{t('auth:change_password')}</h1>
          <p>
            {session.passwordChangeRequired
              ? t('auth:replace_your_temporary_password_before_accessing_the_workspace')
              : t('auth:choose_a_private_password_for_your_staff_account')}
          </p>
        </div>
      </div>
      <form className="panel" onSubmit={submit}>
        <p>
          {t('auth:use_at_least_12_characters_changing_your_password_signs_out_all_your_sessions')}
        </p>
        {error && (
          <p role="alert" className="notice error">
            {interfaceMessage(error)}
          </p>
        )}
        {uncertain && (
          <p role="status" className="notice warning">
            {' '}
            {t(
              'auth:the_response_was_lost_retry_with_the_same_details_or_sign_out_and_try_your_new_password_if_it_w',
            )}{' '}
          </p>
        )}
        <label htmlFor="change-current">{t('auth:current_password')}</label>
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
        <label htmlFor="change-new">{t('auth:new_password')}</label>
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
        <label htmlFor="change-confirm">{t('auth:confirm_new_password')}</label>
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
            ? t('auth:changing_password')
            : uncertain
              ? t('auth:retry_password_change')
              : t('auth:change_password_and_sign_out')}
        </button>
      </form>
    </section>
  );
}
