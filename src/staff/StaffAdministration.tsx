import { useEffect, useRef, useState, type FormEvent } from 'react';
import { staffRoles, type AdministrationCommand, type StaffAccount, type StaffAccountResponse, type StaffDirectory, type StaffHistory } from '../../shared/administration';
import type { Session, StaffRole } from '../../shared/registration';
import { ApiError, request } from './api';
const temporaryPassword = () => { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); };
export default function StaffAdministration({ session, onDirty, onPending, onSessionError }: { session: Session; onDirty: (value: boolean) => void; onPending: (value: boolean) => void; onSessionError: (error: unknown) => void }) {
  const [directory, setDirectory] = useState<StaffDirectory | null>(null); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState(''); const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<StaffAccount | null>(null); const [creating, setCreating] = useState(false);
  const [name, setName] = useState(''); const [username, setUsername] = useState(''); const [role, setRole] = useState<StaffRole>('receptionist'); const [active, setActive] = useState(true);
  const [grant,setGrant] = useState('');
  const [grantExpiresAt,setGrantExpiresAt] = useState<string | null>(null);
  useEffect(() => {
    if(!grant || !grantExpiresAt)return;
    const expire=()=>{if(Date.now()>=Date.parse(grantExpiresAt)){setGrant('');setGrantExpiresAt(null);setNotice('Enrollment grant expired. Verify the staff member’s identity and issue a replacement grant.');}};
    const timer=setTimeout(expire,Math.max(0,Date.parse(grantExpiresAt)-Date.now()));document.addEventListener('visibilitychange',expire);
    return ()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',expire);};
  },[grant,grantExpiresAt]);
  const [current, setCurrent] = useState(''); const [reset, setReset] = useState(false); const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState<{ key: string; command: AdministrationCommand; uncertain: boolean } | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [credential, setCredential] = useState<{ username: string; password: string } | null>(null); const [history, setHistory] = useState<StaffHistory | null>(null); const [historyError, setHistoryError] = useState(''); const [historyRefresh, setHistoryRefresh] = useState(0);
  const [historyPage, setHistoryPage] = useState(1); const [historyLoading, setHistoryLoading] = useState(false); const [reloading, setReloading] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null); const alive = useRef(true);
  const dirty = Boolean(name || username || current || reset || (creating && role !== 'receptionist') || (selected && (role !== selected.role || active !== selected.active)) || credential || grant);
  useEffect(() => { heading.current?.focus(); }, [creating, selected?.id]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { onPending(Boolean(pending) || busy || reloading); }, [pending, busy, reloading, onPending]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false; setLoading(true); setLoadError('');
    void request<StaffDirectory>(`/api/staff?q=${encodeURIComponent(query)}&page=${page}`).then(value => { if (!cancelled) setDirectory(value); }).catch(error => {
      if (cancelled) return; if (error instanceof ApiError && error.status === 401) onSessionError(error); else setLoadError(error instanceof Error ? error.message : 'Staff could not be loaded.');
    }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; };
  }, [query, page, refresh]);
  useEffect(() => {
    setHistoryError(''); if (!selected) { setHistory(null); return; } let cancelled = false; setHistoryLoading(true);
    void request<StaffHistory>(`/api/staff/${selected.id}/history?page=${historyPage}`).then(value => { if (!cancelled) setHistory(value); }).catch(error => { if (cancelled) return; if (error instanceof ApiError && error.status === 401) onSessionError(error); else setHistoryError(error instanceof Error ? error.message : 'History could not be loaded.'); }).finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [selected, historyRefresh, historyPage]);
  function clearDraft() { setGrant(''); setHistoryPage(1); setName(''); setUsername(''); setCurrent(''); setReset(false); setConfirmed(false); setError(''); setPending(null); }
  function close() { if (busy || reloading || pending || (dirty && !window.confirm('Discard unsaved account details and clear any temporary credential?'))) return; clearDraft(); setCredential(null); setCreating(false); setSelected(null); }
  function open(row: StaffAccount) { clearDraft(); setHistory(null); setCredential(null); setSelected(row); setRole(row.role); setActive(row.active); setCreating(false); setNotice(''); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || reloading || !confirmed) return;
    const command: AdministrationCommand = pending?.command ?? (creating ? { type: 'create', displayName: name.trim(), username: username.trim().toLowerCase(), role, temporaryPassword: temporaryPassword() }
      : reset ? { type: 'reset', accountId: selected!.id, expectedRevision: selected!.revision, temporaryPassword: temporaryPassword() }
      : { type: 'update', accountId: selected!.id, expectedRevision: selected!.revision, role, active });
    const submission = pending ?? { key: crypto.randomUUID(), command, uncertain: false };
    if (command.type === 'create' || command.type === 'reset') setCredential(null);
    setPending(submission); setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ account: StaffAccount }>('/api/staff/commands', { method: 'POST', headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': submission.key }, body: JSON.stringify({ command: submission.command, currentPassword: current }) });
      if (!alive.current) return;
      clearDraft(); setCreating(false); setSelected(result.account); setRole(result.account.role); setActive(result.account.active); setRefresh(value => value + 1);
      if ('temporaryPassword' in submission.command) setCredential({ username: result.account.username, password: submission.command.temporaryPassword });
      setNotice('Staff account saved. Existing sessions were revoked for account changes.');
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.status === 401) { onSessionError(error); return; }
      const uncertainResponse = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
      const verificationRejected = error instanceof ApiError && [403, 429].includes(error.status);
      if (uncertainResponse || (submission.uncertain && verificationRejected)) setPending({ ...submission, uncertain: true });
      else setPending(null);
      setError(error instanceof Error ? error.message : 'The account save could not be confirmed.');
    } finally { if (alive.current) setBusy(false); }
  }
  async function grantEnrollment() {
    if (!selected || !selected.firstEnrollmentEligible || busy || pending || !current) return;
    setBusy(true);setError('');setGrant('');
    try {
      const result = await request<{grant:string;expiresAt:string}>('/api/staff/mfa/grant',{method:'POST',headers:{'X-CSRF-Token':session.csrfToken},body:JSON.stringify({accountId:selected.id,password:current})});
      if (alive.current) {setGrant(result.grant);setGrantExpiresAt(result.expiresAt);setCurrent('');}
    } catch (error) {if (alive.current) {setCurrent('');if(error instanceof ApiError && error.status===401)onSessionError(error);else setError(error instanceof Error ? error.message : 'Grant could not be issued. Retry after verifying the account.');}}
    finally {if(alive.current)setBusy(false);}
  }
  async function reloadAccount() {
    if (!selected || reloading || busy || pending) return;
    setReloading(true);
    try {
      const result = await request<StaffAccountResponse>(`/api/staff/${selected.id}`);
      if (!alive.current) return;
      setSelected(result.account); setConfirmed(false);
      setError('Current revision loaded. Review your retained draft before saving.');
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && error.status === 401) onSessionError(error);
      else setError(error instanceof Error ? error.message : 'Current account details could not be loaded. Retry the lookup.');
    } finally { if (alive.current) setReloading(false); }
  }
  return <section className="staff-administration"><div className="page-heading"><div><h1 ref={heading} tabIndex={-1}>{creating ? 'Create staff account' : selected ? selected.displayName : 'Staff administration'}</h1><p>{creating ? 'Give a named staff member access to this hospital.' : selected ? `${selected.username} · Revision ${selected.revision}` : 'Manage your hospital’s named accounts and access.'}</p></div>{!selected && !creating && <button className="primary" onClick={() => { clearDraft(); setCredential(null); setCreating(true); setRole('receptionist'); setNotice(''); }}>Create staff account</button>}</div>
    {notice && <p className="notice success" role="status">{notice}</p>}{error && <p className="notice error" role="alert">{error}</p>}
    {grant && <section className="notice warning" aria-label="Enrollment grant"><h2>Deliver this enrollment grant privately</h2><p>Verify the staff member’s identity through an independent channel. This grant expires at {grantExpiresAt ? new Date(grantExpiresAt).toLocaleTimeString() : 'the stated deadline'}. A replacement invalidates previous grants and pending sign-ins.</p><p data-private className="mfa-secret"><code>{grant}</code></p><button onClick={() => setGrant('')}>Clear enrollment grant</button></section>}
    {credential && <section className="notice warning staff-credential" aria-label="Temporary credential"><h2>Share this temporary password privately</h2><p>Username: <strong>{credential.username}</strong> · Hospital: <strong>{session.user.hospital.code}</strong></p><label htmlFor="temporary-password">Temporary password</label><input id="temporary-password" readOnly value={credential.password} autoComplete="off" /><p>This is held only in this page. The staff member must replace it at first sign-in.</p><button onClick={() => setCredential(null)}>I have shared it — clear password</button></section>}
    {creating || selected ? <>
      <form className="panel staff-account-form" onSubmit={save}>
        {creating && <><label htmlFor="account-name">Staff display name</label><input id="account-name" required maxLength={100} value={name} disabled={busy || Boolean(pending)} onChange={e => setName(e.target.value)} /><label htmlFor="account-username">Staff username</label><input id="account-username" required maxLength={100} autoCapitalize="none" autoComplete="off" value={username} disabled={busy || Boolean(pending)} onChange={e => setUsername(e.target.value)} /></>}
        <label htmlFor="account-role">Role</label><select id="account-role" value={role} disabled={busy || Boolean(pending) || reset || selected?.id === session.user.id} onChange={e => { setRole(e.target.value as StaffRole); setConfirmed(false); }}>{staffRoles.map(value => <option key={value} value={value}>{value}</option>)}</select>
        {selected && <><label className="checkbox"><input type="checkbox" checked={active} disabled={busy || Boolean(pending) || reset || selected.id === session.user.id} onChange={e => { setActive(e.target.checked); setConfirmed(false); }} />Active account</label>{selected.id !== session.user.id && <label className="checkbox"><input type="checkbox" checked={reset} disabled={busy || Boolean(pending)} onChange={e => { setReset(e.target.checked); setConfirmed(false); }} />Reset password with a new temporary credential</label>}<p className="muted">{selected.passwordChangeRequired ? 'Password replacement is required before workspace access.' : 'Password replacement completed.'} Account history is retained when access is removed.</p></>}
        <label htmlFor="admin-current">Your current password</label><input id="admin-current" type="password" autoComplete="current-password" required maxLength={256} value={current} disabled={busy} onChange={e => setCurrent(e.target.value)} />
        <label className="checkbox"><input type="checkbox" checked={confirmed} disabled={busy || Boolean(pending)} onChange={e => setConfirmed(e.target.checked)} />{creating ? 'Create this named account with the selected role.' : reset ? 'Reset this account’s password and sign out its sessions.' : 'Apply this role and status, and sign out existing sessions.'}</label>
        {pending && !busy && <p className="notice warning" role="status">The save is unconfirmed. Retry the original account details when verification is available. You may correct your current password; the account details and temporary credential remain preserved.</p>}
        <div className="button-row"><button className="primary" disabled={busy || reloading || !confirmed || Boolean(selected?.id === session.user.id)}>{busy ? 'Saving account…' : pending ? 'Retry account save' : creating ? 'Create account' : reset ? 'Reset credential' : 'Save account'}</button><button type="button" disabled={busy || reloading || Boolean(pending)} onClick={close}>Back to staff directory</button>{error && !pending && selected && <button type="button" disabled={reloading} onClick={() => void reloadAccount()}>{reloading ? 'Loading current revision…' : 'Reload current revision'}</button>}</div>
      </form>
      {selected?.active && !selected.passwordChangeRequired && selected.id !== session.user.id && <section className="panel"><h2>First authenticator enrollment</h2><p>After independently verifying this person’s identity, enter your current password above and issue a grant. Existing authenticators can only be reset using the person’s recovery code or the private operator process.</p>{!selected.firstEnrollmentEligible && <p>This account needs independent operator recovery or its own recovery code. First enrollment grants are unavailable.</p>}<button disabled={busy || Boolean(pending) || !current || !selected.firstEnrollmentEligible} onClick={() => void grantEnrollment()}>Issue enrollment grant</button></section>}
      {selected && <section className="panel staff-account-history"><h2>Administrative history</h2>{historyError ? <><p role="alert">{historyError}</p><button onClick={() => setHistoryRefresh(value => value + 1)}>Retry history</button></> : historyLoading || !history ? <p role="status">Loading history…</p> : history.events.length ? <ol>{history.events.map(event => <li key={event.id}><strong>{event.action === 'staff.created' ? 'Account created' : event.action === 'staff.updated' ? 'Access updated' : event.action === 'staff.reset' ? 'Credential reset' : 'Password changed'}</strong><p>{event.actorName} ({event.actorUsername}) · {new Date(event.createdAt).toLocaleString()} · Revision {event.revision}</p><p>{event.role} · {event.active ? 'Active' : 'Inactive'}</p></li>)}</ol> : <p>No administrative changes recorded. This may be an account created through secure setup.</p>}{history && <div className="staff-pagination"><p role="status">{history.total} history events · Page {history.page} of {Math.max(1, Math.ceil(history.total / history.pageSize))}</p><div className="button-row"><button disabled={historyLoading || historyPage === 1} onClick={() => setHistoryPage(value => value - 1)}>Previous history</button><button disabled={historyLoading || historyPage * history.pageSize >= history.total} onClick={() => setHistoryPage(value => value + 1)}>Next history</button></div></div>}</section>}
    </> : <section className="panel staff-directory"><form className="staff-search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); setRefresh(value => value + 1); }}><div><label htmlFor="account-search">Search staff name or username</label><input id="account-search" type="search" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} /></div><button disabled={loading}>Search staff</button></form>
      {loading ? <p role="status">Loading staff…</p> : loadError ? <><p role="alert">{loadError}</p><button onClick={() => setRefresh(value => value + 1)}>Retry staff directory</button></> : !directory?.accounts.length ? <p>No staff accounts match this search.</p> : <><div className="table-region" role="region" aria-label="Staff accounts" tabIndex={0}><table><thead><tr><th>Staff member</th><th>Username</th><th>Role</th><th>Status</th><th>Account</th></tr></thead><tbody>{directory.accounts.map(row => <tr key={row.id}><td><button className="patient-visit-link" onClick={() => open(row)}>{row.displayName}</button></td><td>{row.username}</td><td>{row.role}</td><td>{row.active ? 'Active' : 'Inactive'}{row.passwordChangeRequired && <span className="staff-account-secondary">Password change required</span>}</td><td><button onClick={() => open(row)}>Manage<span className="sr-only"> {row.displayName}</span></button></td></tr>)}</tbody></table></div><div className="staff-pagination"><p role="status">{directory.total} staff accounts · Page {directory.page}</p><div className="button-row"><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><button disabled={page * 25 >= directory.total} onClick={() => setPage(value => value + 1)}>Next</button></div></div></>}
    </section>}
  </section>;
}
