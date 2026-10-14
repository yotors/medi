import { interfaceMessage } from '../i18n';
import { QRCodeSVG } from 'qrcode.react';
import { t } from '../i18n';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '../../shared/registration';
import { ApiError, request } from './api';
type Result = {
  sessionFamily?: string;
  userId?: string;
  session?: Session;
  secret?: string | null;
  setupExpiresAt?: string | null;
  recoveryCodes?: string[];
};
export default function MfaChallenge({
  session,
  codes,
  onSession,
  onContinue,
  onError,
  onDirty,
  onPending,
}: {
  session: Session;
  codes: string[];
  onSession: (session: Session, codes?: string[]) => void;
  onContinue: () => void;
  onError: (error: unknown) => void;
  onDirty: (dirty: boolean) => void;
  onPending: (pending: boolean) => void;
}) {
  const [secret, setSecret] = useState('');
  const [grant, setGrant] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState('');
  const [error, setError] = useState('');
  const [setupExpiresAt, setSetupExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(session.authState !== 'challenge' && !codes.length);
  const [loadFailed, setLoadFailed] = useState(false);
  const [resume, setResume] = useState(false);
  const generation = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const title = codes.length
    ? t('auth:save_your_recovery_codes')
    : secret
      ? t('auth:set_up_your_authenticator')
      : session.authState === 'complete'
        ? t('auth:authenticator_security')
        : session.authState === 'challenge'
          ? recovery
            ? t('auth:recover_your_authenticator')
            : t('auth:enter_authenticator_code')
          : t('auth:set_up_staff_sign_in');
  useEffect(() => {
    heading.current?.focus();
  }, [title]);
  function failure(e: unknown) {
    if (e instanceof ApiError && e.status === 401) onError(e);
    else setError(e instanceof Error ? e.message : t('auth:authentication_could_not_be_completed'));
  }
  useEffect(() => {
    onDirty(Boolean(password || code || grant || secret || codes.length));
  }, [password, code, grant, secret, codes.length, onDirty]);
  useEffect(() => {
    onPending(busy);
  }, [busy, onPending]);
  useEffect(
    () => () => {
      generation.current++;
      onPending(false);
      onDirty(false);
    },
    [onPending, onDirty],
  );
  function applySetup(result: Result) {
    setSecret(result.secret ?? '');
    setSetupExpiresAt(result.setupExpiresAt ?? null);
  }
  async function hydrate() {
    const id = ++generation.current;
    setLoading(true);
    setLoadFailed(false);
    setError('');
    try {
      const result = await request<Result>('/api/auth/mfa/status');
      if (alive.current && id === generation.current) applySetup(result);
    } catch (e) {
      if (alive.current && id === generation.current) {
        setLoadFailed(true);
        failure(e);
      }
    } finally {
      if (alive.current && id === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (session.authState !== 'challenge' && !codes.length) void hydrate();
    return () => {
      generation.current++;
    };
  }, [session.csrfToken, session.authState]);
  useEffect(() => {
    if (!secret || !setupExpiresAt) return;
    const expire = () => {
      if (Date.now() >= Date.parse(setupExpiresAt)) {
        setSecret('');
        setCode('');
        setSetupExpiresAt(null);
        setError(
          session.authState === 'complete'
            ? t(
                'auth:setup_expired_restart_replacement_with_your_password_and_a_fresh_code_from_your_current_authent',
              )
            : t(
                'auth:setup_expired_sign_out_and_request_a_fresh_enrollment_grant_or_sign_in_with_another_unused_reco',
              ),
        );
      }
    };
    const timer = setTimeout(expire, Math.max(0, Date.parse(setupExpiresAt) - Date.now()));
    document.addEventListener('visibilitychange', expire);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', expire);
    };
  }, [secret, setupExpiresAt, session.authState]);
  async function reconcile() {
    const id = ++generation.current;
    setLoading(true);
    setResume(true);
    setError('');
    try {
      const current = await request<Session>('/api/auth/session');
      if (!alive.current || id !== generation.current) return;
      if (
        current.user.id !== session.user.id ||
        current.user.hospital.id !== session.user.hospital.id ||
        current.sessionFamily !== session.sessionFamily
      )
        throw new Error(t('common:signin_changed'));
      const result: Result =
        current.authState === 'challenge' ? {} : await request<Result>('/api/auth/mfa/status');
      if (!alive.current || id !== generation.current) return;
      if (
        current.authState !== 'challenge' &&
        (result.sessionFamily !== session.sessionFamily || result.userId !== session.user.id)
      )
        throw new Error();
      applySetup(result);
      setResume(false);
      setLoadFailed(false);
      if (current.authState !== session.authState || current.csrfToken !== session.csrfToken)
        onSession(current);
    } catch {
      if (alive.current && id === generation.current)
        setError(
          t(
            'auth:the_result_could_not_be_confirmed_resume_setup_to_check_this_sign_in_before_trying_another_proo',
          ),
        );
    } finally {
      if (alive.current && id === generation.current) setLoading(false);
    }
  }
  async function submit(operation: string, body: object) {
    if (busy || loading || loadFailed) return;
    ++generation.current;
    setOperation(operation);
    setBusy(true);
    onPending(true);
    setError('');
    try {
      const result = await request<Result>(`/api/auth/mfa/${operation}`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken },
        body: JSON.stringify(body),
      });
      if (!alive.current) return;
      setCode('');
      setPassword('');
      setGrant('');
      if ('secret' in result) applySetup(result);
      if (result.session) onSession(result.session, result.recoveryCodes);
    } catch (e) {
      if (alive.current) {
        setCode('');
        setPassword('');
        setGrant('');
        failure(e);
        if (
          (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) &&
          ['confirm', 'regenerate'].includes(operation)
        ) {
          setSecret('');
          setError(
            t(
              'auth:the_result_could_not_be_confirmed_sign_out_and_sign_in_with_your_new_authenticator_if_you_confi',
            ),
          );
        } else if (
          (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) &&
          ['recover', 'replace', 'start'].includes(operation)
        ) {
          await reconcile();
        }
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function verify(e: FormEvent) {
    e.preventDefault();
    void submit(secret ? 'confirm' : recovery ? 'recover' : 'verify', { code });
  }
  return (
    <section className="panel staff-mfa">
      <h1 tabIndex={-1} ref={heading}>
        {title}
      </h1>
      {error && (
        <p role="alert" className="notice error">
          {interfaceMessage(error)}
        </p>
      )}
      {loading ? (
        <p role="status">{t('auth:loading_authenticator_setup')}</p>
      ) : resume ? (
        <button disabled={busy} onClick={() => void reconcile()}>
          {' '}
          {t('auth:resume_authenticator_setup')}{' '}
        </button>
      ) : loadFailed ? (
        <button onClick={() => void hydrate()}>{t('auth:retry_loading_setup')}</button>
      ) : codes.length ? (
        <>
          <p>
            {' '}
            {t(
              'auth:keep_these_ten_one_use_codes_somewhere_private_separate_from_this_device_they_are_shown_only_no',
            )}{' '}
          </p>
          <ul className="mfa-codes" data-private>
            {codes.map((value) => (
              <li key={value}>
                <code>{value}</code>
              </li>
            ))}
          </ul>
          <p>
            {' '}
            {t(
              'auth:if_this_response_is_lost_sign_in_with_your_authenticator_and_generate_new_recovery_codes_under_',
            )}{' '}
          </p>
          <button className="primary" onClick={onContinue}>
            {' '}
            {t('auth:continue_to_workspace')}{' '}
          </button>
        </>
      ) : secret ? (
        <>
          <p>
            {' '}
            {t(
              'auth:add_an_account_in_your_authenticator_app_using_this_setup_key_choose_time_based_codes_six_digit',
            )}{' '}
          </p>
          <p>
            <strong>
              {session.user.hospital.name} · {session.user.displayName}
            </strong>
          </p>
          <div className="mfa-qr" data-private>
            <p>{t('mfa:scan')}</p>
            <QRCodeSVG
              value={`otpauth://totp/${encodeURIComponent(session.user.hospital.code + ':' + session.user.id)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(session.user.hospital.name)}&algorithm=SHA1&digits=6&period=30`}
              size={224}
              marginSize={4}
              level="M"
              title={t('mfa:qr')}
            />
            <p className="mfa-secret">
              <code>{secret}</code>
            </p>
          </div>
          <form onSubmit={verify}>
            <label htmlFor="mfa-code">{t('auth:authenticator_code')}</label>
            <input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              disabled={busy}
            />
            <button className="primary" disabled={busy}>
              {busy ? t('auth:confirming') : t('auth:confirm_authenticator')}
            </button>
          </form>
          <p className="staff-help">
            {' '}
            {t(
              'auth:setup_lasts_up_to_ten_minutes_and_ends_sooner_if_your_session_expires_if_your_session_expires_a',
            )}{' '}
          </p>
        </>
      ) : session.authState === 'complete' ? (
        <>
          <p>
            {' '}
            {t(
              'auth:use_your_password_and_a_fresh_authenticator_code_to_replace_your_authenticator_or_generate_a_ne',
            )}{' '}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit('regenerate', { password, code });
            }}
          >
            <label htmlFor="mfa-password">{t('auth:current_password')}</label>
            <input
              id="mfa-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={256}
              disabled={busy}
            />
            <label htmlFor="mfa-code">{t('auth:authenticator_code')}</label>
            <input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              disabled={busy}
            />
            <div className="button-row">
              <button className="primary" disabled={busy}>
                {' '}
                {t('auth:generate_new_recovery_codes')}{' '}
              </button>
              <button
                type="button"
                disabled={busy || !password || code.length !== 6}
                onClick={() => void submit('replace', { password, code })}
              >
                {' '}
                {t('auth:replace_authenticator')}{' '}
              </button>
            </div>
            {busy && (
              <p role="status" className="staff-help">
                {operation === 'regenerate'
                  ? t('auth:generating_new_recovery_codes')
                  : t('auth:preparing_replacement_authenticator')}
              </p>
            )}
          </form>
        </>
      ) : session.authState === 'challenge' ? (
        <>
          <p>
            {recovery
              ? t(
                  'auth:enter_one_unused_recovery_code_your_old_authenticator_will_stop_working_and_you_will_set_up_a_r',
                )
              : t('auth:open_your_authenticator_app_and_enter_its_current_six_digit_code')}
          </p>
          <form onSubmit={verify}>
            <label htmlFor="mfa-code">
              {recovery ? t('auth:recovery_code') : t('auth:authenticator_code')}
            </label>
            <input
              id="mfa-code"
              type={recovery ? 'password' : 'text'}
              inputMode={recovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              maxLength={recovery ? 32 : 6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              disabled={busy}
            />
            <button className="primary" disabled={busy}>
              {busy
                ? t('auth:checking')
                : recovery
                  ? t('auth:recover_and_replace_authenticator')
                  : t('auth:verify_code')}
            </button>
          </form>
          <button
            disabled={busy}
            onClick={() => {
              setRecovery(!recovery);
              setCode('');
              setError('');
            }}
          >
            {recovery ? t('auth:use_authenticator_instead') : t('auth:use_a_recovery_code')}
          </button>
        </>
      ) : (
        <>
          <p>
            {' '}
            {t(
              'auth:your_hospital_must_verify_your_identity_separately_and_give_you_a_one_use_enrollment_grant_a_pa',
            )}{' '}
          </p>
          {session.authState === 'recovery_enrollment' ? (
            <p>
              {' '}
              {t(
                'auth:replacement_setup_could_not_be_loaded_sign_out_sign_in_again_and_use_another_unused_recovery_co',
              )}{' '}
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit('start', { grant });
              }}
            >
              <label htmlFor="mfa-grant">{t('common:enrollment_grant')}</label>
              <input
                id="mfa-grant"
                type="password"
                autoComplete="off"
                value={grant}
                onChange={(e) => setGrant(e.target.value)}
                required
                maxLength={256}
                disabled={busy}
              />
              <button className="primary" disabled={busy}>
                {busy ? t('auth:preparing') : t('auth:set_up_authenticator')}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
