import { configureHospitalDates, defaultAppearance } from './date';
import type { HospitalAppearance } from '../../shared/hospital-format';
import { careKinds, canReadCare } from '../../shared/care';
import { CareWorkspace } from './CareWorkspace';
import DepartmentWorkspace from './DepartmentWorkspace';
import HospitalWorkspace from './HospitalWorkspace';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { HeartPulse, LogOut, Plus, Search, ShieldCheck, ArrowLeft, RefreshCw } from 'lucide-react';
import type { PatientPage, Registration, Session } from '../../shared/registration';
import './staff.css';
import { ApiError, request } from './api';
import StaffAdministration from './StaffAdministration';
import HospitalConfiguration from './HospitalConfiguration';
import MfaChallenge from './MfaChallenge';
import PasswordChange from './PasswordChange';
import VisitWorkspace from './VisitWorkspace';
import InventoryWorkspace from './InventoryWorkspace';
import OperationalReports from './OperationalReports';
import { reportSections } from '../../shared/reports';
import type { RegisteredPatient } from '../../shared/registration';

const emptyPage: PatientPage = { patients: [], page: 1, pageSize: 25, total: 0 };
export default function StaffApp() {
  const [appearance, setAppearance] = useState<HospitalAppearance>(defaultAppearance);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [logoutToken, setLogoutToken] = useState<{ csrf: string; family: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hospitalCode, setHospitalCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [records, setRecords] = useState<PatientPage>(emptyPage);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [contact, setContact] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<{ key: string; body: Registration } | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);
  const [visitsOpen, setVisitsOpen] = useState(false);
  const [accountSurface, setAccountSurface] = useState<
    | 'staff'
    | 'password'
    | 'configuration'
    | 'inventory'
    | 'reports'
    | 'mfa'
    | 'care'
    | 'departments'
    | 'hospital'
    | null
  >(null);
  const [accountDirty, setAccountDirty] = useState(false);
  const [accountPending, setAccountPending] = useState(false);
  const [checkInPatient, setCheckInPatient] = useState<RegisteredPatient | null>(null);
  const [visitPending, setVisitPending] = useState(false);
  const [visitDirty, setVisitDirty] = useState(false);
  const departureApproved = useRef(false);
  function clearIdentity(message = '') {
    configureHospitalDates(defaultAppearance);
    setAppearance(defaultAppearance);
    generation.current++;
    setRecoveryCodes([]);
    setAccountSurface(null);
    setAccountDirty(false);
    setAccountPending(false);
    setVisitsOpen(false);
    setCheckInPatient(null);
    setVisitPending(false);
    setVisitDirty(false);
    departureApproved.current = false;
    setInitializing(false);
    setSessionError('');
    setSession(null);
    setRecords(emptyPage);
    setPassword('');
    setName('');
    setAge('');
    setContact('');
    setPending(null);
    setRegistering(false);
    setDuplicate(false);
    setConfirmed(false);
    setSearch('');
    setQuery('');
    setPage(1);
    setError('');
    setNotice(message);
    setBusy(false);
  }
  function handleError(e: unknown) {
    if (e instanceof ApiError && e.status === 401) {
      clearIdentity('Your session ended. Sign in to continue.');
      channel.current?.postMessage('expired');
    } else setError(e instanceof Error ? e.message : 'Something went wrong. Please retry.');
  }
  async function restore() {
    const current = generation.current;
    setInitializing(true);
    setSessionError('');
    try {
      const result = await request<Session>('/api/auth/session');
      if (current === generation.current) setSession(result);
    } catch (e) {
      if (current === generation.current && !(e instanceof ApiError && e.status === 401))
        setSessionError(e instanceof Error ? e.message : 'The server is unavailable.');
    } finally {
      if (current === generation.current) setInitializing(false);
    }
  }
  useEffect(() => {
    void restore();
  }, []);
  useEffect(() => {
    if (!session || session.authState !== 'complete' || session.passwordChangeRequired) return;
    let cancelled = false;
    const load = async () => {
      try {
        const settings = await request<HospitalAppearance>('/api/hospital/appearance');
        if (!cancelled) {
          configureHospitalDates(settings);
          setAppearance(settings);
        }
      } catch (e) {
        if (!cancelled && e instanceof ApiError && e.status === 401) handleError(e);
      }
    };
    void load();
    window.addEventListener('hospital-appearance-changed', load);
    return () => {
      cancelled = true;
      window.removeEventListener('hospital-appearance-changed', load);
    };
  }, [session?.csrfToken, session?.authState, session?.passwordChangeRequired]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const c = new BroadcastChannel('hospital-staff-session');
    channel.current = c;
    c.onmessage = () => {
      clearIdentity('The staff session changed in another tab. Sign in again.');
    };
    return () => {
      c.close();
      channel.current = null;
    };
  }, []);
  useEffect(() => {
    if (
      !session ||
      session.authState !== 'complete' ||
      recoveryCodes.length ||
      session.passwordChangeRequired ||
      accountSurface
    )
      return;
    let cancelled = false;
    const current = generation.current;
    setLoading(true);
    setRecords(emptyPage);
    setError('');
    void request<PatientPage>('/api/patients/search', {
      method: 'POST',
      headers: { 'X-CSRF-Token': session.csrfToken },
      body: JSON.stringify({ q: query, page }),
    })
      .then((result) => {
        if (!cancelled && current === generation.current) setRecords(result);
      })
      .catch((e) => {
        if (!cancelled && current === generation.current) handleError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    session?.csrfToken,
    session?.authState,
    session?.passwordChangeRequired,
    recoveryCodes.length,
    query,
    page,
    refresh,
    accountSurface,
  ]);
  useEffect(() => {
    if (session) heading.current?.focus();
  }, [registering, session]);
  useEffect(() => {
    if (!pending && !visitPending && !visitDirty && !accountPending && !accountDirty) return;
    departureApproved.current = false;
    const warn = (event: BeforeUnloadEvent) => {
      if (departureApproved.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending, visitPending, visitDirty, accountPending, accountDirty]);
  useEffect(() => {
    if (!session) return;
    const current = generation.current;
    let cancelled = false;
    const expire = () => {
      if (cancelled || current !== generation.current) return;
      clearIdentity('Your session ended. Sign in to continue.');
      channel.current?.postMessage('expired');
    };
    const validate = async () => {
      try {
        const latest = await request<Session>('/api/auth/session');
        if (cancelled || current !== generation.current) return;
        if (
          latest.user.id !== session.user.id ||
          latest.csrfToken !== session.csrfToken ||
          latest.user.role !== session.user.role ||
          latest.authState !== session.authState
        )
          expire();
        else if (latest.expiresAt !== session.expiresAt) setSession(latest);
      } catch (e) {
        if (
          !cancelled &&
          current === generation.current &&
          e instanceof ApiError &&
          e.status === 401
        )
          expire();
      }
    };
    const expiry = window.setTimeout(
      expire,
      Math.max(0, Date.parse(session.expiresAt) - Date.now()),
    );
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void validate();
    }, 60000);
    const focus = () => {
      void validate();
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') void validate();
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelled = true;
      clearTimeout(expiry);
      clearInterval(timer);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [session]);
  useEffect(() => {
    const update = (event: Event) => {
      const expiry = (event as CustomEvent<string>).detail;
      setSession((previous) =>
        previous && Date.parse(expiry) > Date.parse(previous.expiresAt)
          ? { ...previous, expiresAt: expiry }
          : previous,
      );
    };
    window.addEventListener('staff-session-activity', update);
    return () => window.removeEventListener('staff-session-activity', update);
  }, []);
  function mayDiscardVisit() {
    return (
      (!visitDirty && !accountDirty) ||
      window.confirm('Discard unsaved drafts and clear any temporary password before leaving?')
    );
  }
  function navigateAccount(
    surface:
      | 'staff'
      | 'password'
      | 'configuration'
      | 'inventory'
      | 'reports'
      | 'mfa'
      | 'care'
      | 'departments'
      | 'hospital'
      | null,
    visits = false,
  ) {
    if (accountSurface === surface && visitsOpen === visits) return;
    if (pending || visitPending || accountPending || !mayDiscardVisit()) return;
    setCheckInPatient(null);
    setAccountDirty(false);
    setVisitDirty(false);
    setAccountSurface(surface);
    setVisitsOpen(visits);
    setRegistering(false);
    setError('');
  }
  function guardNavigation(event: React.MouseEvent<HTMLAnchorElement>) {
    if (pending || visitPending || accountPending) {
      event.preventDefault();
      setError(
        pending
          ? 'Finish retrying the pending registration before leaving this workspace.'
          : 'Finish retrying the pending visit save before leaving this workspace.',
      );
      return;
    }
    if (!mayDiscardVisit()) event.preventDefault();
    else departureApproved.current = true;
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    const current = generation.current;
    try {
      const result = await request<Session>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ hospitalCode, username, password }),
      });
      if (current !== generation.current) return;
      setSession(result);
      setPassword('');
      channel.current?.postMessage('login');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please retry.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    const csrf = session?.csrfToken ?? logoutToken?.csrf;
    const family = session?.sessionFamily ?? logoutToken?.family;
    if (!csrf || !family || busy || pending || visitPending || accountPending || !mayDiscardVisit())
      return;
    setBusy(true);
    setError('');
    let confirmedLogout = false;
    try {
      try {
        await request('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 403) throw error;
        // An interrupted elevation can deliver its cookie before its body/CSRF.
        const latest = await request<Session>('/api/auth/session');
        if (latest.sessionFamily !== family) throw error;
        await request('/api/auth/logout', {
          method: 'POST',
          headers: { 'X-CSRF-Token': latest.csrfToken },
        });
      }
      confirmedLogout = true;
    } catch (e) {
      confirmedLogout = e instanceof ApiError && e.status === 401;
    } finally {
      clearIdentity(
        confirmedLogout
          ? 'You have signed out.'
          : 'The workspace has been cleared, but the server has not confirmed sign-out. Retry sign-out when the connection returns.',
      );
      setLogoutToken(confirmedLogout ? null : { csrf, family });
      channel.current?.postMessage('logout');
      setBusy(false);
    }
  }
  function clearForm() {
    setName('');
    setAge('');
    setContact('');
    setDuplicate(false);
    setConfirmed(false);
    setPending(null);
  }
  async function register(e: FormEvent) {
    e.preventDefault();
    if (!session || busy) return;
    const submission = pending ?? {
      key: crypto.randomUUID(),
      body: {
        name: name.trim(),
        ...(age ? { age: Number(age) } : {}),
        contact: contact.trim(),
        ...(confirmed ? { confirmDuplicate: true } : {}),
      },
    };
    const current = generation.current;
    setPending(submission);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request<{ patient: PatientPage['patients'][number] }>('/api/patients', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': submission.key },
        body: JSON.stringify(submission.body),
      });
      if (current !== generation.current) return;
      clearForm();
      setRegistering(false);
      setSearch('');
      setQuery('');
      setPage(1);
      setRefresh((n) => n + 1);
      setNotice(`Patient registered. Record number ${result.patient.recordNumber}.`);
    } catch (e) {
      if (current !== generation.current) return;
      if (e instanceof ApiError && e.status > 0 && e.status < 500) setPending(null);
      if (e instanceof ApiError && e.code === 'DUPLICATE_PATIENT') {
        setDuplicate(true);
        setConfirmed(false);
      }
      handleError(e);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setQuery(search.trim());
    setPage(1);
    setRefresh((n) => n + 1);
  }
  const readOnly = session?.user.role !== 'admin' && session?.user.role !== 'receptionist';
  return (
    <div className="staff-shell">
      <a className="skip-link" href="#staff-main">
        Skip to workspace
      </a>
      <header className="staff-header">
        <a className="staff-brand" href="/staff" onClick={guardNavigation}>
          <HeartPulse size={26} />
          <span>Medi</span>
        </a>
        <a href="/" onClick={guardNavigation}>
          Workspace home
        </a>
      </header>
      <aside className="staff-environment" aria-label="Workspace environment">
        {import.meta.env.DEV
          ? 'Development workspace · Use fictional patient details only.'
          : 'Hospital workspace · Authorized staff access'}
      </aside>
      <main
        id="staff-main"
        tabIndex={-1}
        className={session ? 'staff-main' : 'staff-main staff-login'}
      >
        {initializing ? (
          <p role="status">Checking your session…</p>
        ) : sessionError ? (
          <section className="panel">
            <h1>Workspace unavailable</h1>
            <p role="alert">{sessionError}</p>
            <button onClick={() => void restore()}>
              <RefreshCw size={16} />
              Retry connection
            </button>
          </section>
        ) : !session ? (
          <section className="panel">
            <ShieldCheck className="staff-login-icon" size={30} />
            <h1>Staff sign-in</h1>
            <p className="muted">Use the staff account assigned to your hospital.</p>
            {notice && (
              <p role="status" className="notice success">
                {notice}
              </p>
            )}
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            {logoutToken && (
              <button onClick={() => void logout()} disabled={busy}>
                Retry sign-out
              </button>
            )}
            <form onSubmit={login}>
              <label htmlFor="hospital-code">Hospital code</label>
              <input
                id="hospital-code"
                required
                maxLength={60}
                value={hospitalCode}
                onChange={(e) => setHospitalCode(e.target.value)}
                autoComplete="organization"
                autoCapitalize="none"
                disabled={busy}
              />
              <label htmlFor="staff-username">Username</label>
              <input
                id="staff-username"
                required
                maxLength={100}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                disabled={busy}
              />
              <label htmlFor="staff-password">Password</label>
              <input
                id="staff-password"
                type="password"
                required
                maxLength={256}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
              />
              <button className="primary" disabled={busy || Boolean(logoutToken)}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <p className="staff-help">
              Need access? Ask the person who manages your hospital’s staff accounts.
            </p>
          </section>
        ) : (
          <>
            <div className="staff-identity">
              <div>
                <strong>{session.user.hospital.name}</strong>
                <span>
                  {session.user.displayName} ·{' '}
                  {session.user.role === 'auditor' ? 'Read-only access' : session.user.role}
                </span>
              </div>
              <button
                onClick={() => void logout()}
                disabled={busy || Boolean(pending) || visitPending || accountPending}
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
            {session.authState === 'complete' &&
              !recoveryCodes.length &&
              !session.passwordChangeRequired && (
                <nav className="staff-navigation" aria-label="Staff workspace">
                  <button
                    aria-pressed={!visitsOpen && !accountSurface}
                    disabled={Boolean(pending) || visitPending || accountPending}
                    onClick={() => navigateAccount(null)}
                  >
                    Patient directory
                  </button>
                  <button
                    aria-pressed={visitsOpen && !accountSurface}
                    disabled={Boolean(pending) || visitPending || accountPending}
                    onClick={() => navigateAccount(null, true)}
                  >
                    Outpatient visits
                  </button>
                  {session.user.role === 'admin' && (
                    <button
                      aria-pressed={accountSurface === 'staff'}
                      disabled={Boolean(pending) || visitPending || accountPending}
                      onClick={() => navigateAccount('staff')}
                    >
                      Staff administration
                    </button>
                  )}
                  <button
                    aria-pressed={accountSurface === 'configuration'}
                    disabled={Boolean(pending) || visitPending || accountPending}
                    onClick={() => navigateAccount('configuration')}
                  >
                    {session.user.role === 'admin' ? 'Hospital configuration' : 'Service catalog'}
                  </button>
                  {['admin', 'pharmacist', 'auditor'].includes(session.user.role) && (
                    <button
                      aria-pressed={accountSurface === 'inventory'}
                      disabled={Boolean(pending) || visitPending || accountPending}
                      onClick={() => navigateAccount('inventory')}
                    >
                      Pharmacy inventory
                    </button>
                  )}
                  {reportSections[session.user.role].length > 0 && (
                    <button
                      aria-pressed={accountSurface === 'reports'}
                      disabled={Boolean(pending) || visitPending || accountPending}
                      onClick={() => navigateAccount('reports')}
                    >
                      Operational reports
                    </button>
                  )}
                  {careKinds.some((kind) => canReadCare(session.user.role, kind)) && (
                    <button
                      aria-pressed={accountSurface === 'care'}
                      disabled={Boolean(pending) || visitPending || accountPending}
                      onClick={() => navigateAccount('care')}
                    >
                      Patient care
                    </button>
                  )}
                  {['admin', 'lab', 'clinician', 'pharmacist', 'cashier', 'auditor'].includes(
                    session.user.role,
                  ) && (
                    <button
                      aria-pressed={accountSurface === 'departments'}
                      disabled={Boolean(pending) || visitPending || accountPending}
                      onClick={() => navigateAccount('departments')}
                    >
                      Department operations
                    </button>
                  )}
                  {['admin', 'auditor'].includes(session.user.role) && (
                    <button
                      aria-pressed={accountSurface === 'hospital'}
                      disabled={Boolean(pending) || visitPending || accountPending}
                      onClick={() => navigateAccount('hospital')}
                    >
                      Hospital management
                    </button>
                  )}
                  <button
                    aria-pressed={accountSurface === 'mfa'}
                    onClick={() => navigateAccount('mfa')}
                  >
                    Authenticator security
                  </button>
                  <button
                    aria-pressed={accountSurface === 'password'}
                    disabled={Boolean(pending) || visitPending || accountPending}
                    onClick={() => navigateAccount('password')}
                  >
                    Change password
                  </button>
                </nav>
              )}
            {(session.authState !== 'complete' &&
              !(session.authState === 'enrollment' && session.passwordChangeRequired)) ||
            recoveryCodes.length > 0 ||
            accountSurface === 'mfa' ? (
              <MfaChallenge
                key={session.csrfToken + session.authState}
                session={session}
                codes={recoveryCodes}
                onDirty={setAccountDirty}
                onPending={setAccountPending}
                onSession={(next, codes = []) => {
                  generation.current++;
                  setSession(next);
                  setRecoveryCodes(codes);
                  channel.current?.postMessage('mfa');
                }}
                onContinue={() => {
                  setRecoveryCodes([]);
                  setAccountSurface(null);
                }}
                onError={handleError}
              />
            ) : session.passwordChangeRequired || accountSurface === 'password' ? (
              <PasswordChange
                key={session.csrfToken}
                session={session}
                onDirty={setAccountDirty}
                onPending={setAccountPending}
                onSessionError={handleError}
                onChanged={(message) => {
                  clearIdentity(message);
                  channel.current?.postMessage('password');
                }}
              />
            ) : accountSurface === 'care' ? (
              <CareWorkspace
                key={session.csrfToken}
                session={session}
                onDirty={setAccountDirty}
                onPending={setAccountPending}
                onSessionError={handleError}
              />
            ) : accountSurface === 'departments' ? (
              <DepartmentWorkspace
                key={session.csrfToken}
                session={session}
                onDirty={setAccountDirty}
                onPending={setAccountPending}
                onSessionError={handleError}
              />
            ) : accountSurface === 'hospital' ? (
              <HospitalWorkspace
                key={session.csrfToken}
                session={session}
                onDirty={setAccountDirty}
                onPending={setAccountPending}
                onSessionError={handleError}
              />
            ) : accountSurface === 'reports' ? (
              <OperationalReports
                key={session.csrfToken}
                session={session}
                onSessionError={handleError}
              />
            ) : accountSurface === 'inventory' ? (
              <InventoryWorkspace
                key={session.csrfToken}
                session={session}
                onDirty={setAccountDirty}
                onPending={setAccountPending}
                onSessionError={handleError}
              />
            ) : accountSurface === 'configuration' ? (
              <HospitalConfiguration
                key={session.csrfToken}
                session={session}
                onDirty={setAccountDirty}
                onPending={setAccountPending}
                onSessionError={handleError}
              />
            ) : accountSurface === 'staff' ? (
              <StaffAdministration
                key={session.csrfToken}
                session={session}
                onDirty={setAccountDirty}
                onPending={setAccountPending}
                onSessionError={handleError}
              />
            ) : (
              <>
                {visitsOpen && error && (
                  <p role="alert" className="notice error">
                    {error}
                  </p>
                )}
                {visitsOpen ? (
                  <VisitWorkspace
                    key={session.csrfToken}
                    session={session}
                    checkInPatient={checkInPatient}
                    onPending={setVisitPending}
                    onDirty={setVisitDirty}
                    onSessionError={handleError}
                  />
                ) : (
                  <>
                    <div className="page-heading">
                      <div>
                        <h1 ref={heading} tabIndex={-1}>
                          {registering ? 'Register patient' : 'Patient directory'}
                        </h1>
                        <p>
                          {registering
                            ? 'Start with the details needed to identify the patient.'
                            : 'Find registered patients in your hospital.'}
                        </p>
                      </div>
                      {!registering && !readOnly && (
                        <button
                          className="primary"
                          onClick={() => {
                            setRegistering(true);
                            setError('');
                            setNotice('');
                          }}
                        >
                          <Plus size={18} />
                          Register patient
                        </button>
                      )}
                    </div>
                    {notice && (
                      <p role="status" className="notice success">
                        {notice}
                      </p>
                    )}
                    {error && (
                      <p role="alert" className="notice error">
                        {error}
                      </p>
                    )}
                    {registering ? (
                      <section className="panel registration">
                        <form onSubmit={register}>
                          <label htmlFor="staff-patient-name">
                            Full name <span className="muted">(required)</span>
                          </label>
                          <input
                            id="staff-patient-name"
                            required
                            maxLength={100}
                            value={name}
                            disabled={busy || Boolean(pending)}
                            onChange={(e) => {
                              setName(e.target.value);
                              setDuplicate(false);
                              setConfirmed(false);
                            }}
                            autoComplete="off"
                          />
                          <div className="form-grid">
                            <div>
                              <label htmlFor="staff-age">
                                Age <span className="muted">(optional)</span>
                              </label>
                              <input
                                id="staff-age"
                                type="number"
                                min="0"
                                max="120"
                                step="1"
                                value={age}
                                onChange={(e) => setAge(e.target.value)}
                                disabled={busy || Boolean(pending)}
                              />
                            </div>
                            <div>
                              <label htmlFor="staff-contact">
                                Contact <span className="muted">(optional)</span>
                              </label>
                              <input
                                id="staff-contact"
                                maxLength={100}
                                value={contact}
                                onChange={(e) => setContact(e.target.value)}
                                disabled={busy || Boolean(pending)}
                                autoComplete="off"
                              />
                            </div>
                          </div>
                          {duplicate && (
                            <div className="notice warning">
                              <p>
                                A patient with this name already exists. Check the directory before
                                creating a separate record.
                              </p>
                              <label className="checkbox">
                                <input
                                  type="checkbox"
                                  checked={confirmed}
                                  onChange={(e) => setConfirmed(e.target.checked)}
                                  disabled={busy || Boolean(pending)}
                                />
                                This is a different person with the same name.
                              </label>
                            </div>
                          )}
                          {pending && !busy && (
                            <p className="notice warning">
                              The save has not been confirmed. Retry the same registration to find
                              or finish the original save without creating another record.
                            </p>
                          )}
                          <div className="button-row">
                            <button
                              className="primary"
                              disabled={busy || !name.trim() || (duplicate && !confirmed)}
                            >
                              {busy ? 'Saving…' : pending ? 'Retry registration' : 'Save patient'}
                            </button>
                            <button
                              type="button"
                              disabled={busy || Boolean(pending)}
                              onClick={() => {
                                clearForm();
                                setRegistering(false);
                                setError('');
                              }}
                            >
                              <ArrowLeft size={16} />
                              Back to directory
                            </button>
                          </div>
                        </form>
                      </section>
                    ) : (
                      <section className="panel staff-directory">
                        <form className="staff-search" onSubmit={submitSearch}>
                          <div>
                            <label htmlFor="staff-search">Search name or record number</label>
                            <input
                              id="staff-search"
                              type="search"
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                              maxLength={100}
                            />
                          </div>
                          <button disabled={loading}>
                            <Search size={16} />
                            Search
                          </button>
                          {query && (
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => {
                                setSearch('');
                                setQuery('');
                                setPage(1);
                              }}
                            >
                              Clear
                            </button>
                          )}
                        </form>
                        {loading ? (
                          <p role="status" className="empty">
                            Loading patients…
                          </p>
                        ) : error ? (
                          <div className="empty">
                            <p>Patient records could not be loaded.</p>
                            <button onClick={() => setRefresh((n) => n + 1)}>Retry loading</button>
                          </div>
                        ) : records.patients.length ? (
                          <>
                            <div
                              role="region"
                              aria-label="Registered patients"
                              tabIndex={0}
                              className="table-region"
                            >
                              <table>
                                <thead>
                                  <tr>
                                    <th>Patient</th>
                                    <th>Record number</th>
                                    <th>Age</th>
                                    <th>Contact</th>
                                    {!readOnly && <th>Visit</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {records.patients.map((patient) => (
                                    <tr key={patient.id}>
                                      <td>
                                        <strong>{patient.name}</strong>
                                      </td>
                                      <td className="numeric">{patient.recordNumber}</td>
                                      <td>{patient.age ?? 'Not provided'}</td>
                                      <td>{patient.contact || 'Not provided'}</td>
                                      {!readOnly && (
                                        <td>
                                          {patient.canonicalId ? (
                                            <span>Linked to {patient.canonicalRecordNumber}</span>
                                          ) : (
                                            <button
                                              onClick={() => {
                                                setCheckInPatient(patient);
                                                setVisitsOpen(true);
                                                setError('');
                                              }}
                                            >
                                              Check in
                                              <span className="sr-only"> {patient.name}</span>
                                            </button>
                                          )}
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="staff-pagination">
                              <p role="status">
                                {records.total} {records.total === 1 ? 'patient' : 'patients'} ·
                                Page {records.page} of{' '}
                                {Math.max(1, Math.ceil(records.total / records.pageSize))}
                              </p>
                              <div className="button-row">
                                <button
                                  disabled={page === 1 || loading}
                                  onClick={() => setPage((p) => p - 1)}
                                >
                                  Previous
                                </button>
                                <button
                                  disabled={
                                    records.page * records.pageSize >= records.total || loading
                                  }
                                  onClick={() => setPage((p) => p + 1)}
                                >
                                  Next
                                </button>
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="empty">
                            <Search size={28} />
                            <h2>{query ? 'No matching patients' : 'No patients registered yet'}</h2>
                            <p>
                              {query
                                ? 'Try a different name or record number.'
                                : readOnly
                                  ? 'Registered patients will appear here.'
                                  : 'Register the first patient to begin.'}
                            </p>
                          </div>
                        )}
                      </section>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </main>
      <footer className="staff-footer">
        Medi · Africa/Addis_Ababa ·{' '}
        {appearance.calendar === 'ethiopic' ? 'Ethiopian calendar' : 'Gregorian calendar'}
      </footer>
    </div>
  );
}
