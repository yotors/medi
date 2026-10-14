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
    ? 'Save your recovery codes'
    : secret
      ? 'Set up your authenticator'
      : session.authState === 'complete'
        ? 'Authenticator security'
        : session.authState === 'challenge'
          ? recovery
            ? 'Recover your authenticator'
            : 'Enter authenticator code'
          : 'Set up staff sign-in';
  useEffect(() => {
    heading.current?.focus();
  }, [title]);
  function failure(e: unknown) {
    if (e instanceof ApiError && e.status === 401) onError(e);
    else setError(e instanceof Error ? e.message : 'Authentication could not be completed.');
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
            ? 'Setup expired. Restart replacement with your password and a fresh code from your current authenticator.'
            : 'Setup expired. Sign out and request a fresh enrollment grant, or sign in with another unused recovery code.',
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
        throw new Error('This sign-in changed. Sign out and sign in again to continue.');
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
          'The result could not be confirmed. Resume setup to check this sign-in before trying another proof.',
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
            'The result could not be confirmed. Sign out and sign in with your new authenticator if you confirmed replacement, then generate new recovery codes using your password and a fresh authenticator code.',
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
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading authenticator setup…</p>
      ) : resume ? (
        <button disabled={busy} onClick={() => void reconcile()}>
          Resume authenticator setup
        </button>
      ) : loadFailed ? (
        <button onClick={() => void hydrate()}>Retry loading setup</button>
      ) : codes.length ? (
        <>
          <p>
            Keep these ten one-use codes somewhere private, separate from this device. They are
            shown only now.
          </p>
          <ul className="mfa-codes" data-private>
            {codes.map((value) => (
              <li key={value}>
                <code>{value}</code>
              </li>
            ))}
          </ul>
          <p>
            If this response is lost, sign in with your authenticator and generate new recovery
            codes under Authenticator security.
          </p>
          <button className="primary" onClick={onContinue}>
            Continue to workspace
          </button>
        </>
      ) : secret ? (
        <>
          <p>
            Add an account in your authenticator app using this setup key. Choose time-based codes,
            six digits, and a 30-second period.
          </p>
          <p>
            <strong>
              {session.user.hospital.name} · {session.user.displayName}
            </strong>
          </p>
          <p className="mfa-secret" data-private>
            <code>{secret}</code>
          </p>
          <form onSubmit={verify}>
            <label htmlFor="mfa-code">Authenticator code</label>
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
              {busy ? 'Confirming…' : 'Confirm authenticator'}
            </button>
          </form>
          <p className="staff-help">
            Setup lasts up to ten minutes and ends sooner if your session expires. If your session
            expires, ask for a new enrollment grant or sign in and use an unused recovery code. If
            confirmation was interrupted, try signing in with this authenticator.
          </p>
        </>
      ) : session.authState === 'complete' ? (
        <>
          <p>
            Use your password and a fresh authenticator code to replace your authenticator or
            generate a new set of recovery codes. Other sessions end when recovery codes change.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit('regenerate', { password, code });
            }}
          >
            <label htmlFor="mfa-password">Current password</label>
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
            <label htmlFor="mfa-code">Authenticator code</label>
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
                Generate new recovery codes
              </button>
              <button
                type="button"
                disabled={busy || !password || code.length !== 6}
                onClick={() => void submit('replace', { password, code })}
              >
                Replace authenticator
              </button>
            </div>
            {busy && (
              <p role="status" className="staff-help">
                {operation === 'regenerate'
                  ? 'Generating new recovery codes…'
                  : 'Preparing replacement authenticator…'}
              </p>
            )}
          </form>
        </>
      ) : session.authState === 'challenge' ? (
        <>
          <p>
            {recovery
              ? 'Enter one unused recovery code. Your old authenticator will stop working and you will set up a replacement before opening records.'
              : 'Open your authenticator app and enter its current six-digit code.'}
          </p>
          <form onSubmit={verify}>
            <label htmlFor="mfa-code">{recovery ? 'Recovery code' : 'Authenticator code'}</label>
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
              {busy ? 'Checking…' : recovery ? 'Recover and replace authenticator' : 'Verify code'}
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
            {recovery ? 'Use authenticator instead' : 'Use a recovery code'}
          </button>
        </>
      ) : (
        <>
          <p>
            Your hospital must verify your identity separately and give you a one-use enrollment
            grant. A password alone cannot open records.
          </p>
          {session.authState === 'recovery_enrollment' ? (
            <p>
              Replacement setup could not be loaded. Sign out, sign in again, and use another unused
              recovery code, or contact your account manager.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit('start', { grant });
              }}
            >
              <label htmlFor="mfa-grant">Enrollment grant</label>
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
                {busy ? 'Preparing…' : 'Set up authenticator'}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
