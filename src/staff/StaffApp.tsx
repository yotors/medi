import { isPlainLinkClick } from './navigation';
import { uiMessage } from '../i18n';
import { presentationLabel } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t, formatNumber } from '../i18n';
import { useTranslation } from 'react-i18next';
import { LanguageControl } from '../i18n';
import { destinations, routeSurface, surfacePath, type Surface } from './navigation';
import WorkspaceHome from './WorkspaceHome';
import AccountMenu from './AccountMenu';
import { configureHospitalDates, defaultAppearance } from './date';
import type { HospitalAppearance } from '../../shared/hospital-format';
import { CareWorkspace } from './CareWorkspace';
import DepartmentWorkspace from './DepartmentWorkspace';
import HospitalWorkspace from './HospitalWorkspace';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { HeartPulse, Plus, Search, ShieldCheck, ArrowLeft, RefreshCw } from 'lucide-react';
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
import type { RegisteredPatient } from '../../shared/registration';

const emptyPage: PatientPage = { patients: [], page: 1, pageSize: 25, total: 0 };
export default function StaffApp() {
  const { t } = useTranslation();
  const shellRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const header = shell.querySelector('.staff-header');
    const environment = shell.querySelector('.staff-environment');
    const measure = () => {
      const bottom =
        environment?.getBoundingClientRect().bottom ?? header?.getBoundingClientRect().bottom ?? 0;
      shell.style.setProperty('--shell-header-height', `${Math.max(0, bottom)}px`);
    };
    const observer = new ResizeObserver(measure);
    if (header) observer.observe(header);
    if (environment) observer.observe(environment);
    measure();
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', measure);
    };
  }, []);

  const [route, setRoute] = useState<Surface | null>(() => routeSurface(window.location.pathname));
  const [workspaceSection, setWorkspaceSection] = useState(
    () => new URLSearchParams(window.location.search).get('section') ?? '',
  );
  const rememberedSections = useRef<Partial<Record<Surface, string>>>({
    ...(route ? { [route]: workspaceSection } : {}),
  });
  const historyIndex = useRef<number>(window.history.state?.mediIndex ?? 0);
  const mfaReturn = useRef<Surface>(routeSurface(window.location.pathname) ?? 'home');
  const restoringHistory = useRef(false);
  useEffect(() => {
    window.history.replaceState(
      { ...window.history.state, mediIndex: historyIndex.current },
      '',
      window.location.href,
    );
  }, []);
  const initialSurface = routeSurface(window.location.pathname);

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
  const [visitsOpen, setVisitsOpen] = useState(initialSurface === 'visits');
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
  >(
    initialSurface && !['home', 'patients', 'visits'].includes(initialSurface)
      ? (initialSurface as Exclude<Surface, 'home' | 'patients' | 'visits'>)
      : null,
  );
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
    // Preserve the requested URL through authentication and session expiry.
    const requested = routeSurface(window.location.pathname);
    setAccountSurface(
      requested && !['home', 'patients', 'visits'].includes(requested)
        ? (requested as Exclude<Surface, 'home' | 'patients' | 'visits'>)
        : null,
    );
    setAccountDirty(false);
    setAccountPending(false);
    setVisitsOpen(routeSurface(window.location.pathname) === 'visits');
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
      clearIdentity(t('errors:SESSION_ENDED'));
      channel.current?.postMessage('expired');
    } else setError(e instanceof Error ? e.message : t('common:something_went_wrong_please_retry'));
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
        setSessionError(e instanceof Error ? e.message : t('common:the_server_is_unavailable'));
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
      clearIdentity(t('errors:SESSION_CHANGED'));
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
      accountSurface ||
      route !== 'patients'
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
    route,
  ]);
  useEffect(() => {
    if (
      !pending &&
      !visitPending &&
      !visitDirty &&
      !accountPending &&
      !accountDirty &&
      !(registering && (name || age || contact))
    )
      return;
    departureApproved.current = false;
    const warn = (event: BeforeUnloadEvent) => {
      if (departureApproved.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [
    pending,
    visitPending,
    visitDirty,
    accountPending,
    accountDirty,
    registering,
    name,
    age,
    contact,
  ]);
  useEffect(() => {
    if (!session) return;
    const current = generation.current;
    let cancelled = false;
    const expire = () => {
      if (cancelled || current !== generation.current) return;
      clearIdentity(t('errors:SESSION_ENDED'));
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
  useLayoutEffect(() => {
    if (!session) return;
    const title = document.querySelector<HTMLElement>('#staff-main h1');
    if (title) {
      title.tabIndex = -1;
      title.focus();
    }
  }, [
    route,
    workspaceSection,
    registering,
    session?.user.id,
    session?.authState,
    session?.passwordChangeRequired,
  ]);
  function mayDiscardVisit() {
    return (
      (!visitDirty && !accountDirty && !(registering && (name || age || contact))) ||
      window.confirm(
        t('common:discard_unsaved_drafts_and_clear_any_temporary_password_before_leaving'),
      )
    );
  }
  function changeSection(section: string, replace = false) {
    if (!replace && (pending || visitPending || accountPending || !mayDiscardVisit())) return false;
    const url = new URL(window.location.href);
    url.searchParams.set('section', section);
    if (!replace) historyIndex.current++;
    window.history[replace ? 'replaceState' : 'pushState'](
      { mediIndex: historyIndex.current },
      '',
      url,
    );
    if (route) rememberedSections.current[route] = section;
    setWorkspaceSection(section);
    return true;
  }
  function goTo(id: Surface, historyMode: 'push' | 'pop' | 'replace' = 'push') {
    if (historyMode === 'push' && id === route) return true;
    if (historyMode === 'push' && (pending || visitPending || accountPending || !mayDiscardVisit()))
      return false;
    if (id === 'mfa' && route && route !== 'mfa') mfaReturn.current = route;
    const selectedSection = rememberedSections.current[id] ?? '';
    const destination =
      surfacePath(id) + (selectedSection ? `?section=${encodeURIComponent(selectedSection)}` : '');
    setCheckInPatient(null);
    setAccountDirty(false);
    setVisitDirty(false);
    clearForm();
    setRegistering(false);
    setError('');
    if (historyMode !== 'pop') setWorkspaceSection(selectedSection);
    setRoute(id);
    setAccountSurface(
      !['home', 'patients', 'visits'].includes(id)
        ? (id as Exclude<Surface, 'home' | 'patients' | 'visits'>)
        : null,
    );
    setVisitsOpen(id === 'visits');
    if (historyMode === 'push') {
      historyIndex.current++;
      window.history.pushState({ mediIndex: historyIndex.current }, '', destination);
    }
    if (historyMode === 'replace')
      window.history.replaceState({ mediIndex: historyIndex.current }, '', destination);
    return true;
  }
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      if (restoringHistory.current) {
        restoringHistory.current = false;
        return;
      }
      const target = typeof event.state?.mediIndex === 'number' ? event.state.mediIndex : 0;
      if (pending || visitPending || accountPending || !mayDiscardVisit()) {
        restoringHistory.current = true;
        window.history.go(historyIndex.current - target);
        return;
      }
      historyIndex.current = target;
      const section = new URLSearchParams(window.location.search).get('section') ?? '';
      setWorkspaceSection(section);
      const desired = routeSurface(window.location.pathname);
      if (desired) rememberedSections.current[desired] = section;
      if (desired) goTo(desired, 'pop');
      else {
        setRoute(null);
        setAccountSurface(null);
        setVisitsOpen(false);
      }
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [
    pending,
    visitPending,
    accountPending,
    visitDirty,
    accountDirty,
    registering,
    name,
    age,
    contact,
  ]);
  function guardNavigation(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!isPlainLinkClick(event)) return;
    if (pending || visitPending || accountPending) {
      event.preventDefault();
      setError(
        pending
          ? t('common:finish_retrying_the_pending_registration_before_leaving_this_workspace')
          : t('common:finish_retrying_the_pending_visit_save_before_leaving_this_workspace'),
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
      setError(e instanceof Error ? e.message : t('common:sign_in_failed_please_retry'));
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
          ? t('common:you_have_signed_out')
          : t(
              'common:the_workspace_has_been_cleared_but_the_server_has_not_confirmed_sign_out_retry_sign_out_when_th',
            ),
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
      setNotice(uiMessage('dynamic:patient_registered', { number: result.patient.recordNumber }));
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
    <div
      ref={shellRef}
      className={
        session?.authState === 'complete' &&
        !session.passwordChangeRequired &&
        !recoveryCodes.length
          ? 'staff-shell staff-routed'
          : 'staff-shell'
      }
    >
      <a className="skip-link" href="#staff-main">
        {' '}
        {t('common:skip_to_workspace')}{' '}
      </a>
      <header className="staff-header">
        <a className="staff-brand" href="/staff" onClick={guardNavigation}>
          <HeartPulse size={26} />
          <span>Medi</span>
        </a>
        <LanguageControl />
        <a href="/" onClick={guardNavigation}>
          {t('public:preview')}
        </a>
        {session && (
          <AccountMenu
            session={session}
            route={route}
            settingsAvailable={
              session.authState === 'complete' &&
              !session.passwordChangeRequired &&
              !recoveryCodes.length
            }
            blocked={busy || Boolean(pending) || visitPending || accountPending}
            onNavigate={goTo}
            onSignOut={() => void logout()}
          />
        )}
      </header>
      <aside className="staff-environment" aria-label={t('common:workspace_environment')}>
        {import.meta.env.DEV
          ? t('common:development_workspace_use_fictional_patient_details_only')
          : t('common:hospital_workspace_authorized_staff_access')}
      </aside>
      <main
        id="staff-main"
        tabIndex={-1}
        className={session ? 'staff-main' : 'staff-main staff-login'}
      >
        {initializing ? (
          <p role="status">{t('common:checking_your_session')}</p>
        ) : sessionError ? (
          <section className="panel">
            <h1>{t('common:workspace_unavailable')}</h1>
            <p role="alert">{interfaceMessage(sessionError)}</p>
            <button onClick={() => void restore()}>
              <RefreshCw size={16} /> {t('common:retry_connection')}{' '}
            </button>
          </section>
        ) : !session ? (
          <section className="panel">
            <ShieldCheck className="staff-login-icon" size={30} />
            <h1>{t('common:staff_sign_in')}</h1>
            <p className="muted">{t('common:use_the_staff_account_assigned_to_your_hospital')}</p>
            {notice && (
              <p role="status" className="notice success">
                {interfaceMessage(notice)}
              </p>
            )}
            {error && (
              <p role="alert" className="notice error">
                {interfaceMessage(error)}
              </p>
            )}
            {logoutToken && (
              <button onClick={() => void logout()} disabled={busy}>
                {' '}
                {t('common:retry_sign_out')}{' '}
              </button>
            )}
            <form onSubmit={login}>
              <label htmlFor="hospital-code">{t('common:hospital_code')}</label>
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
              <label htmlFor="staff-username">{t('common:username_2')}</label>
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
              <label htmlFor="staff-password">{t('common:password')}</label>
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
                {busy ? t('common:signing_in') : t('common:sign_in')}
              </button>
            </form>
            <p className="staff-help">
              {' '}
              {t(
                'common:need_access_ask_the_person_who_manages_your_hospital_s_staff_accounts',
              )}{' '}
            </p>
          </section>
        ) : (
          <>
            <div className="staff-identity">
              <div>
                <strong>{session.user.hospital.name}</strong>
                <span>
                  {session.user.displayName} ·{' '}
                  {session.user.role === 'auditor'
                    ? t('common:read_only_access')
                    : presentationLabel(session.user.role)}
                </span>
              </div>
            </div>
            {session.authState === 'complete' &&
              !recoveryCodes.length &&
              !session.passwordChangeRequired && (
                <nav
                  className="staff-navigation staff-primary-navigation"
                  aria-label={t('navigation:label')}
                >
                  {(['work', 'management'] as const).map((group) => (
                    <div className="navigation-group" key={group}>
                      <h2>{t(`navigation:${group}`)}</h2>
                      {destinations(session.user.role)
                        .filter((d) => d.group === group)
                        .map((d) => (
                          <a
                            key={d.id}
                            href={surfacePath(d.id)}
                            aria-current={route === d.id ? 'page' : undefined}
                            aria-disabled={Boolean(pending) || visitPending || accountPending}
                            onClick={(e) => {
                              if (!isPlainLinkClick(e)) return;
                              e.preventDefault();
                              goTo(d.id);
                            }}
                          >
                            {t(d.label)}
                          </a>
                        ))}
                    </div>
                  ))}
                </nav>
              )}
            {session.authState === 'complete' &&
              !session.passwordChangeRequired &&
              !recoveryCodes.length && (
                <p className="staff-breadcrumb">
                  <a
                    href="/staff"
                    onClick={(e) => {
                      if (!isPlainLinkClick(e)) return;
                      e.preventDefault();
                      goTo('home');
                    }}
                  >
                    {t('navigation:home')}
                  </a>
                  {route && route !== 'home' ? (
                    <>
                      {' '}
                      /{' '}
                      {t(
                        destinations(session.user.role).find((d) => d.id === route)?.label ??
                          'navigation:unavailable',
                      )}
                    </>
                  ) : null}
                </p>
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
                  goTo(route === 'mfa' ? mfaReturn.current : (route ?? 'home'), 'replace');
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
            ) : !route || !destinations(session.user.role).some((d) => d.id === route) ? (
              <section className="panel">
                <h1>{t('navigation:unavailable')}</h1>
                <a
                  href="/staff"
                  onClick={(e) => {
                    if (!isPlainLinkClick(e)) return;
                    e.preventDefault();
                    goTo('home');
                  }}
                >
                  {t('navigation:recover')}
                </a>
              </section>
            ) : route === 'home' ? (
              <WorkspaceHome
                session={session}
                onNavigate={(id) => {
                  goTo(id);
                }}
                onSessionError={handleError}
              />
            ) : accountSurface === 'care' ? (
              <CareWorkspace
                section={workspaceSection}
                onSectionChange={changeSection}
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
                section={workspaceSection}
                onSectionChange={changeSection}
              />
            ) : accountSurface === 'hospital' ? (
              <HospitalWorkspace
                section={workspaceSection}
                onSectionChange={changeSection}
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
                section={workspaceSection}
                onSectionChange={changeSection}
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
                    {interfaceMessage(error)}
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
                          {registering
                            ? t('common:register_patient')
                            : t('common:patient_directory')}
                        </h1>
                        <p>
                          {registering
                            ? t('common:start_with_the_details_needed_to_identify_the_patient')
                            : t('common:find_registered_patients_in_your_hospital')}
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
                          <Plus size={18} /> {t('common:register_patient')}{' '}
                        </button>
                      )}
                    </div>
                    {notice && (
                      <p role="status" className="notice success">
                        {interfaceMessage(notice)}
                      </p>
                    )}
                    {error && (
                      <p role="alert" className="notice error">
                        {interfaceMessage(error)}
                      </p>
                    )}
                    {registering ? (
                      <section className="panel registration">
                        <form onSubmit={register}>
                          <label htmlFor="staff-patient-name">
                            {' '}
                            {t('common:full_name')}{' '}
                            <span className="muted">{t('common:required')}</span>
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
                                {' '}
                                {t('common:age')}{' '}
                                <span className="muted">{t('common:optional_2')}</span>
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
                                {' '}
                                {t('common:contact')}{' '}
                                <span className="muted">{t('common:optional_2')}</span>
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
                                {' '}
                                {t(
                                  'common:a_patient_with_this_name_already_exists_check_the_directory_before_creating_a_separate_record',
                                )}{' '}
                              </p>
                              <label className="checkbox">
                                <input
                                  type="checkbox"
                                  checked={confirmed}
                                  onChange={(e) => setConfirmed(e.target.checked)}
                                  disabled={busy || Boolean(pending)}
                                />{' '}
                                {t('common:this_is_a_different_person_with_the_same_name')}{' '}
                              </label>
                            </div>
                          )}
                          {pending && !busy && (
                            <p className="notice warning">
                              {' '}
                              {t(
                                'common:the_save_has_not_been_confirmed_retry_the_same_registration_to_find_or_finish_the_original_save',
                              )}{' '}
                            </p>
                          )}
                          <div className="button-row">
                            <button
                              className="primary"
                              disabled={busy || !name.trim() || (duplicate && !confirmed)}
                            >
                              {busy
                                ? t('common:saving')
                                : pending
                                  ? t('common:retry_registration')
                                  : t('common:save_patient')}
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
                              <ArrowLeft size={16} /> {t('common:back_to_directory')}{' '}
                            </button>
                          </div>
                        </form>
                      </section>
                    ) : (
                      <section className="panel staff-directory">
                        <form className="staff-search" onSubmit={submitSearch}>
                          <div>
                            <label htmlFor="staff-search">
                              {t('common:search_name_or_record_number')}
                            </label>
                            <input
                              id="staff-search"
                              type="search"
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                              maxLength={100}
                            />
                          </div>
                          <button disabled={loading}>
                            <Search size={16} /> {t('common:search')}{' '}
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
                              {' '}
                              {t('common:clear')}{' '}
                            </button>
                          )}
                        </form>
                        {loading ? (
                          <p role="status" className="empty">
                            {' '}
                            {t('common:loading_patients')}{' '}
                          </p>
                        ) : error ? (
                          <div className="empty">
                            <p>{t('common:patient_records_could_not_be_loaded')}</p>
                            <button onClick={() => setRefresh((n) => n + 1)}>
                              {t('common:retry_loading')}
                            </button>
                          </div>
                        ) : records.patients.length ? (
                          <>
                            <div
                              role="region"
                              aria-label={t('common:registered_patients')}
                              tabIndex={0}
                              className="table-region"
                            >
                              <table>
                                <thead>
                                  <tr>
                                    <th>{t('common:patient')}</th>
                                    <th>{t('common:record_number')}</th>
                                    <th>{t('common:age')}</th>
                                    <th>{t('common:contact')}</th>
                                    {!readOnly && <th>{t('common:visit')}</th>}
                                  </tr>
                                </thead>
                                <tbody>
                                  {records.patients.map((patient) => (
                                    <tr key={patient.id}>
                                      <td>
                                        <strong>{patient.name}</strong>
                                      </td>
                                      <td className="numeric">{patient.recordNumber}</td>
                                      <td>{patient.age ?? t('common:not_provided')}</td>
                                      <td>{patient.contact || t('common:not_provided')}</td>
                                      {!readOnly && (
                                        <td>
                                          {patient.canonicalId ? (
                                            <span>
                                              {t('common:linked_to')}{' '}
                                              {patient.canonicalRecordNumber}
                                            </span>
                                          ) : (
                                            <button
                                              onClick={() => {
                                                if (!goTo('visits')) return;
                                                setCheckInPatient(patient);
                                                setError('');
                                              }}
                                            >
                                              {' '}
                                              {t('common:check_in')}{' '}
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
                                {t('common:patient_page', {
                                  count: records.total,
                                  total: formatNumber(records.total),
                                  page: formatNumber(records.page),
                                  pages: formatNumber(
                                    Math.max(1, Math.ceil(records.total / records.pageSize)),
                                  ),
                                })}
                              </p>
                              <div className="button-row">
                                <button
                                  disabled={page === 1 || loading}
                                  onClick={() => setPage((p) => p - 1)}
                                >
                                  {' '}
                                  {t('common:previous')}{' '}
                                </button>
                                <button
                                  disabled={
                                    records.page * records.pageSize >= records.total || loading
                                  }
                                  onClick={() => setPage((p) => p + 1)}
                                >
                                  {' '}
                                  {t('common:next')}{' '}
                                </button>
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="empty">
                            <Search size={28} />
                            <h2>
                              {query
                                ? t('common:no_matching_patients')
                                : t('common:no_patients_registered_yet')}
                            </h2>
                            <p>
                              {query
                                ? t('common:try_a_different_name_or_record_number')
                                : readOnly
                                  ? t('common:registered_patients_will_appear_here')
                                  : t('common:register_the_first_patient_to_begin')}
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
        {appearance.calendar === 'ethiopic'
          ? t('common:ethiopian_calendar')
          : t('common:gregorian_calendar')}
      </footer>
    </div>
  );
}
