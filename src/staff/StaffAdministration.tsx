import { uiMessage } from '../i18n';
import { presentationLabel } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t, formatDate } from '../i18n';
import { hospitalDate } from './date';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  staffRoles,
  type AdministrationCommand,
  type StaffAccount,
  type StaffAccountResponse,
  type StaffDirectory,
  type StaffHistory,
} from '../../shared/administration';
import type { Session, StaffRole } from '../../shared/registration';
import { ApiError, request } from './api';
const temporaryPassword = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
};
export default function StaffAdministration({
  session,
  onDirty,
  onPending,
  onSessionError,
}: {
  session: Session;
  onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void;
  onSessionError: (error: unknown) => void;
}) {
  const [directory, setDirectory] = useState<StaffDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<StaffAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<StaffRole>('receptionist');
  const [active, setActive] = useState(true);
  const [grant, setGrant] = useState('');
  const [grantExpiresAt, setGrantExpiresAt] = useState<string | null>(null);
  useEffect(() => {
    if (!grant || !grantExpiresAt) return;
    const expire = () => {
      if (Date.now() >= Date.parse(grantExpiresAt)) {
        setGrant('');
        setGrantExpiresAt(null);
        setNotice(
          t(
            'common:enrollment_grant_expired_verify_the_staff_member_s_identity_and_issue_a_replacement_grant',
          ),
        );
      }
    };
    const timer = setTimeout(expire, Math.max(0, Date.parse(grantExpiresAt) - Date.now()));
    document.addEventListener('visibilitychange', expire);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', expire);
    };
  }, [grant, grantExpiresAt]);
  const [current, setCurrent] = useState('');
  const [reset, setReset] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<{
    key: string;
    command: AdministrationCommand;
    uncertain: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [credential, setCredential] = useState<{ username: string; password: string } | null>(null);
  const [history, setHistory] = useState<StaffHistory | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const dirty = Boolean(
    name ||
    username ||
    current ||
    reset ||
    (creating && role !== 'receptionist') ||
    (selected && (role !== selected.role || active !== selected.active)) ||
    credential ||
    grant,
  );
  useEffect(() => {
    heading.current?.focus();
  }, [creating, selected?.id]);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    onPending(Boolean(pending) || busy || reloading);
  }, [pending, busy, reloading, onPending]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    void request<StaffDirectory>(`/api/staff?q=${encodeURIComponent(query)}&page=${page}`)
      .then((value) => {
        if (!cancelled) setDirectory(value);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) onSessionError(error);
        else
          setLoadError(
            error instanceof Error ? error.message : t('common:staff_could_not_be_loaded'),
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, page, refresh]);
  useEffect(() => {
    setHistoryError('');
    if (!selected) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    void request<StaffHistory>(`/api/staff/${selected.id}/history?page=${historyPage}`)
      .then((value) => {
        if (!cancelled) setHistory(value);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) onSessionError(error);
        else
          setHistoryError(
            error instanceof Error ? error.message : t('common:history_could_not_be_loaded'),
          );
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, historyRefresh, historyPage]);
  function clearDraft() {
    setGrant('');
    setHistoryPage(1);
    setName('');
    setUsername('');
    setCurrent('');
    setReset(false);
    setConfirmed(false);
    setError('');
    setPending(null);
  }
  function close() {
    if (
      busy ||
      reloading ||
      pending ||
      (dirty &&
        !window.confirm(
          t('common:discard_unsaved_account_details_and_clear_any_temporary_credential'),
        ))
    )
      return;
    clearDraft();
    setCredential(null);
    setCreating(false);
    setSelected(null);
  }
  function open(row: StaffAccount) {
    clearDraft();
    setHistory(null);
    setCredential(null);
    setSelected(row);
    setRole(row.role);
    setActive(row.active);
    setCreating(false);
    setNotice('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || reloading || !confirmed) return;
    const command: AdministrationCommand =
      pending?.command ??
      (creating
        ? {
            type: 'create',
            displayName: name.trim(),
            username: username.trim().toLowerCase(),
            role,
            temporaryPassword: temporaryPassword(),
          }
        : reset
          ? {
              type: 'reset',
              accountId: selected!.id,
              expectedRevision: selected!.revision,
              temporaryPassword: temporaryPassword(),
            }
          : {
              type: 'update',
              accountId: selected!.id,
              expectedRevision: selected!.revision,
              role,
              active,
            });
    const submission = pending ?? { key: crypto.randomUUID(), command, uncertain: false };
    if (command.type === 'create' || command.type === 'reset') setCredential(null);
    setPending(submission);
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request<{ account: StaffAccount }>('/api/staff/commands', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': submission.key },
        body: JSON.stringify({ command: submission.command, currentPassword: current }),
      });
      if (!alive.current) return;
      clearDraft();
      setCreating(false);
      setSelected(result.account);
      setRole(result.account.role);
      setActive(result.account.active);
      setRefresh((value) => value + 1);
      if ('temporaryPassword' in submission.command)
        setCredential({
          username: result.account.username,
          password: submission.command.temporaryPassword,
        });
      setNotice(
        uiMessage('common:staff_account_saved_existing_sessions_were_revoked_for_account_changes'),
      );
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.status === 401) {
        onSessionError(error);
        return;
      }
      const uncertainResponse =
        !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
      const verificationRejected = error instanceof ApiError && [403, 429].includes(error.status);
      if (uncertainResponse || (submission.uncertain && verificationRejected))
        setPending({ ...submission, uncertain: true });
      else setPending(null);
      setError(
        error instanceof Error
          ? error.message
          : t('common:the_account_save_could_not_be_confirmed'),
      );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function grantEnrollment() {
    if (!selected || !selected.firstEnrollmentEligible || busy || pending || !current) return;
    setBusy(true);
    setError('');
    setGrant('');
    try {
      const result = await request<{ grant: string; expiresAt: string }>('/api/staff/mfa/grant', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken },
        body: JSON.stringify({ accountId: selected.id, password: current }),
      });
      if (alive.current) {
        setGrant(result.grant);
        setGrantExpiresAt(result.expiresAt);
        setCurrent('');
      }
    } catch (error) {
      if (alive.current) {
        setCurrent('');
        if (error instanceof ApiError && error.status === 401) onSessionError(error);
        else
          setError(
            error instanceof Error
              ? error.message
              : t('common:grant_could_not_be_issued_retry_after_verifying_the_account'),
          );
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function reloadAccount() {
    if (!selected || reloading || busy || pending) return;
    setReloading(true);
    try {
      const result = await request<StaffAccountResponse>(`/api/staff/${selected.id}`);
      if (!alive.current) return;
      setSelected(result.account);
      setConfirmed(false);
      setError(
        uiMessage('common:current_revision_loaded_review_your_retained_draft_before_saving'),
      );
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.status === 401) onSessionError(error);
      else
        setError(
          error instanceof Error
            ? error.message
            : t('common:current_account_details_could_not_be_loaded_retry_the_lookup'),
        );
    } finally {
      if (alive.current) setReloading(false);
    }
  }
  return (
    <section className="staff-administration">
      <div className="page-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {creating
              ? t('common:create_staff_account')
              : selected
                ? selected.displayName
                : t('common:staff_administration')}
          </h1>
          <p>
            {creating
              ? t('common:give_a_named_staff_member_access_to_this_hospital')
              : selected
                ? t('dynamic:account_revision', {
                    username: selected.username,
                    revision: selected.revision,
                  })
                : t('common:manage_your_hospital_s_named_accounts_and_access')}
          </p>
        </div>
        {!selected && !creating && (
          <button
            className="primary"
            onClick={() => {
              clearDraft();
              setCredential(null);
              setCreating(true);
              setRole('receptionist');
              setNotice('');
            }}
          >
            {' '}
            {t('common:create_staff_account')}{' '}
          </button>
        )}
      </div>
      {notice && (
        <p className="notice success" role="status">
          {interfaceMessage(notice)}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {interfaceMessage(error)}
        </p>
      )}
      {grant && (
        <section className="notice warning" aria-label={t('common:enrollment_grant')}>
          <h2>{t('common:deliver_this_enrollment_grant_privately')}</h2>
          <p>
            {' '}
            {t(
              'common:verify_the_staff_member_s_identity_through_an_independent_channel_this_grant_expires_at',
            )}{' '}
            {grantExpiresAt
              ? formatDate(new Date(grantExpiresAt), {
                  hour: 'numeric',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : t('common:the_stated_deadline')}{' '}
            {t('common:a_replacement_invalidates_previous_grants_and_pending_sign_ins')}{' '}
          </p>
          <p data-private className="mfa-secret">
            <code>{grant}</code>
          </p>
          <button onClick={() => setGrant('')}>{t('common:clear_enrollment_grant')}</button>
        </section>
      )}
      {credential && (
        <section
          className="notice warning staff-credential"
          aria-label={t('common:temporary_credential')}
        >
          <h2>{t('common:share_this_temporary_password_privately')}</h2>
          <p>
            {' '}
            {t('common:username')} <strong>{credential.username}</strong> {t('common:hospital')}{' '}
            <strong>{session.user.hospital.code}</strong>
          </p>
          <label htmlFor="temporary-password">{t('common:temporary_password')}</label>
          <input id="temporary-password" readOnly value={credential.password} autoComplete="off" />
          <p>
            {t(
              'common:this_is_held_only_in_this_page_the_staff_member_must_replace_it_at_first_sign_in',
            )}
          </p>
          <button onClick={() => setCredential(null)}>
            {t('common:i_have_shared_it_clear_password')}
          </button>
        </section>
      )}
      {creating || selected ? (
        <>
          <form className="panel staff-account-form" onSubmit={save}>
            {creating && (
              <>
                <label htmlFor="account-name">{t('common:staff_display_name')}</label>
                <input
                  id="account-name"
                  required
                  maxLength={100}
                  value={name}
                  disabled={busy || Boolean(pending)}
                  onChange={(e) => setName(e.target.value)}
                />
                <label htmlFor="account-username">{t('common:staff_username')}</label>
                <input
                  id="account-username"
                  required
                  maxLength={100}
                  autoCapitalize="none"
                  autoComplete="off"
                  value={username}
                  disabled={busy || Boolean(pending)}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </>
            )}
            <label htmlFor="account-role">{t('common:role')}</label>
            <select
              id="account-role"
              value={role}
              disabled={busy || Boolean(pending) || reset || selected?.id === session.user.id}
              onChange={(e) => {
                setRole(e.target.value as StaffRole);
                setConfirmed(false);
              }}
            >
              {staffRoles.map((value) => (
                <option key={value} value={value}>
                  {presentationLabel(value)}
                </option>
              ))}
            </select>
            {selected && (
              <>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={active}
                    disabled={busy || Boolean(pending) || reset || selected.id === session.user.id}
                    onChange={(e) => {
                      setActive(e.target.checked);
                      setConfirmed(false);
                    }}
                  />{' '}
                  {t('common:active_account')}{' '}
                </label>
                {selected.id !== session.user.id && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={reset}
                      disabled={busy || Boolean(pending)}
                      onChange={(e) => {
                        setReset(e.target.checked);
                        setConfirmed(false);
                      }}
                    />{' '}
                    {t('common:reset_password_with_a_new_temporary_credential')}{' '}
                  </label>
                )}
                <p className="muted">
                  {selected.passwordChangeRequired
                    ? t('common:password_replacement_is_required_before_workspace_access')
                    : t('common:password_replacement_completed')}{' '}
                  {t('common:account_history_is_retained_when_access_is_removed')}{' '}
                </p>
              </>
            )}
            <label htmlFor="admin-current">{t('common:your_current_password')}</label>
            <input
              id="admin-current"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={current}
              disabled={busy}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy || Boolean(pending)}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              {creating
                ? t('common:create_this_named_account_with_the_selected_role')
                : reset
                  ? t('common:reset_this_account_s_password_and_sign_out_its_sessions')
                  : t('common:apply_this_role_and_status_and_sign_out_existing_sessions')}
            </label>
            {pending && !busy && (
              <p className="notice warning" role="status">
                {' '}
                {t(
                  'common:the_save_is_unconfirmed_retry_the_original_account_details_when_verification_is_available_you_m',
                )}{' '}
              </p>
            )}
            <div className="button-row">
              <button
                className="primary"
                disabled={
                  busy || reloading || !confirmed || Boolean(selected?.id === session.user.id)
                }
              >
                {busy
                  ? t('common:saving_account')
                  : pending
                    ? t('common:retry_account_save')
                    : creating
                      ? t('common:create_account')
                      : reset
                        ? t('common:reset_credential')
                        : t('common:save_account')}
              </button>
              <button
                type="button"
                disabled={busy || reloading || Boolean(pending)}
                onClick={close}
              >
                {' '}
                {t('common:back_to_staff_directory')}{' '}
              </button>
              {error && !pending && selected && (
                <button type="button" disabled={reloading} onClick={() => void reloadAccount()}>
                  {reloading
                    ? t('common:loading_current_revision')
                    : t('common:reload_current_revision')}
                </button>
              )}
            </div>
          </form>
          {selected?.active &&
            !selected.passwordChangeRequired &&
            selected.id !== session.user.id && (
              <section className="panel">
                <h2>{t('common:first_authenticator_enrollment')}</h2>
                <p>
                  {' '}
                  {t(
                    'common:after_independently_verifying_this_person_s_identity_enter_your_current_password_above_and_issu',
                  )}{' '}
                </p>
                {!selected.firstEnrollmentEligible && (
                  <p>
                    {' '}
                    {t(
                      'common:this_account_needs_independent_operator_recovery_or_its_own_recovery_code_first_enrollment_gran',
                    )}{' '}
                  </p>
                )}
                <button
                  disabled={
                    busy || Boolean(pending) || !current || !selected.firstEnrollmentEligible
                  }
                  onClick={() => void grantEnrollment()}
                >
                  {' '}
                  {t('common:issue_enrollment_grant')}{' '}
                </button>
              </section>
            )}
          {selected && (
            <section className="panel staff-account-history">
              <h2>{t('common:administrative_history')}</h2>
              {historyError ? (
                <>
                  <p role="alert">{interfaceMessage(historyError)}</p>
                  <button onClick={() => setHistoryRefresh((value) => value + 1)}>
                    {' '}
                    {t('common:retry_history')}{' '}
                  </button>
                </>
              ) : historyLoading || !history ? (
                <p role="status">{t('common:loading_history')}</p>
              ) : history.events.length ? (
                <ol>
                  {history.events.map((event) => (
                    <li key={event.id}>
                      <strong>
                        {event.action === 'staff.created'
                          ? t('common:account_created')
                          : event.action === 'staff.updated'
                            ? t('common:access_updated')
                            : event.action === 'staff.reset'
                              ? t('common:credential_reset')
                              : t('common:password_changed')}
                      </strong>
                      <p>
                        {event.actorName} ({event.actorUsername}) · {hospitalDate(event.createdAt)}{' '}
                        {t('common:revision')} {event.revision}
                      </p>
                      <p>
                        {presentationLabel(event.role)} ·{' '}
                        {event.active ? t('common:active') : t('common:inactive')}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>
                  {' '}
                  {t(
                    'common:no_administrative_changes_recorded_this_may_be_an_account_created_through_secure_setup',
                  )}{' '}
                </p>
              )}
              {history && (
                <div className="staff-pagination">
                  <p role="status">
                    {history.total} {t('common:history_events_page')} {history.page}{' '}
                    {t('common:of')} {Math.max(1, Math.ceil(history.total / history.pageSize))}
                  </p>
                  <div className="button-row">
                    <button
                      disabled={historyLoading || historyPage === 1}
                      onClick={() => setHistoryPage((value) => value - 1)}
                    >
                      {' '}
                      {t('common:previous_history')}{' '}
                    </button>
                    <button
                      disabled={historyLoading || historyPage * history.pageSize >= history.total}
                      onClick={() => setHistoryPage((value) => value + 1)}
                    >
                      {' '}
                      {t('common:next_history')}{' '}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      ) : (
        <section className="panel staff-directory">
          <form
            className="staff-search"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search.trim());
              setPage(1);
              setRefresh((value) => value + 1);
            }}
          >
            <div>
              <label htmlFor="account-search">{t('common:search_staff_name_or_username')}</label>
              <input
                id="account-search"
                type="search"
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button disabled={loading}>{t('common:search_staff')}</button>
          </form>
          {loading ? (
            <p role="status">{t('common:loading_staff')}</p>
          ) : loadError ? (
            <>
              <p role="alert">{interfaceMessage(loadError)}</p>
              <button onClick={() => setRefresh((value) => value + 1)}>
                {' '}
                {t('common:retry_staff_directory')}{' '}
              </button>
            </>
          ) : !directory?.accounts.length ? (
            <p>{t('common:no_staff_accounts_match_this_search')}</p>
          ) : (
            <>
              <div
                className="table-region"
                role="region"
                aria-label={t('common:staff_accounts')}
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>{t('common:staff_member')}</th>
                      <th>{t('common:username_2')}</th>
                      <th>{t('common:role')}</th>
                      <th>{t('common:status')}</th>
                      <th>{t('common:account')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {directory.accounts.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <button className="patient-visit-link" onClick={() => open(row)}>
                            {row.displayName}
                          </button>
                        </td>
                        <td>{row.username}</td>
                        <td>{presentationLabel(row.role)}</td>
                        <td>
                          {row.active ? t('common:active') : t('common:inactive')}
                          {row.passwordChangeRequired && (
                            <span className="staff-account-secondary">
                              {' '}
                              {t('common:password_change_required')}{' '}
                            </span>
                          )}
                        </td>
                        <td>
                          <button onClick={() => open(row)}>
                            {' '}
                            {t('common:manage')}
                            <span className="sr-only"> {row.displayName}</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="staff-pagination">
                <p role="status">
                  {directory.total} {t('common:staff_accounts_page')} {directory.page}
                </p>
                <div className="button-row">
                  <button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
                    {' '}
                    {t('common:previous')}{' '}
                  </button>
                  <button
                    disabled={page * 25 >= directory.total}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    {' '}
                    {t('common:next')}{' '}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </section>
  );
}
