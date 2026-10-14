import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RegisteredPatient, Session } from '../../shared/registration';
import type { VisitCommand, VisitPage, VisitView } from '../../shared/outpatient';
import { ApiError, request } from './api';
import VisitPanel from './VisitPanel';

const empty: VisitPage = { visits: [], page: 1, pageSize: 25, total: 0 };
type Submission = { key: string; path: string; body: object; command?: VisitCommand };
export default function VisitWorkspace({ session, checkInPatient, onPending, onDirty, onSessionError }: {
  session: Session; checkInPatient: RegisteredPatient | null; onPending: (pending: boolean) => void; onDirty: (dirty: boolean) => void; onSessionError: (error: unknown) => void;
}) {
  const [records, setRecords] = useState(empty);
  const [visit, setVisit] = useState<VisitView | null>(null);
  const [search, setSearch] = useState(''); const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active'); const [page, setPage] = useState(1); const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [queueError, setQueueError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false); const [dirty, setDirty] = useState(false); const [notice, setNotice] = useState('');
  const [billingRefresh, setBillingRefresh] = useState(0);
  const [billingPending, setBillingPending] = useState(false);
  const [pending, setPending] = useState<Submission | null>(null);
  const [saved, setSaved] = useState<{ sequence: number; command?: VisitCommand }>({ sequence: 0 });
  const [needsReload, setNeedsReload] = useState(false);
  const mounted = useRef(false); const started = useRef(false); const inflight = useRef(false);
  const detailGeneration = useRef(0); const desiredVisit = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; detailGeneration.current++; }; }, []);
  useEffect(() => { heading.current?.focus(); }, [visit?.id]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { onPending(Boolean(pending) || billingPending); }, [pending, billingPending, onPending]);
  useEffect(() => {
    if (visit || pending) { setLoading(false); return; }
    let cancelled = false; setLoading(true); setQueueError('');
    void request<VisitPage>(`/api/visits?q=${encodeURIComponent(query)}&status=${status}&page=${page}`).then(result => {
      if (!cancelled) setRecords(result);
    }).catch(e => { if (!cancelled) { if (e instanceof ApiError && e.status === 401) onSessionError(e); else setQueueError(e instanceof Error ? e.message : 'Visits could not be loaded.'); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, status, page, refresh, visit, pending]);
  useEffect(() => {
    if (!checkInPatient || started.current) return;
    started.current = true;
    void submit({ key: crypto.randomUUID(), path: `/api/patients/${checkInPatient.id}/visits`, body: {} });
  }, [checkInPatient]);
  function report(e: unknown) {
    if (e instanceof ApiError && e.status === 401) onSessionError(e);
    else setError(e instanceof Error ? e.message : 'The visit could not be loaded. Please retry.');
  }
  function abandonDetail() {
    detailGeneration.current++; desiredVisit.current = null; setDetailLoading(false);
  }
  function backToQueue() {
    if (pending || billingPending || busy || (dirty && !window.confirm('Discard unsaved visit drafts and return to the visit queue?'))) return;
    abandonDetail(); setDirty(false); onDirty(false); setVisit(null); setNotice(''); setError(''); setNeedsReload(false); setRefresh(n => n + 1);
  }
  async function reloadVisit(id: string, refreshBilling = true) {
    const generation = ++detailGeneration.current; desiredVisit.current = id;
    const isCurrent = () => mounted.current && detailGeneration.current === generation && desiredVisit.current === id;
    setDetailLoading(true); setError('');
    try {
      const result = await request<{ visit: VisitView }>(`/api/visits/${id}`);
      if (isCurrent() && result.visit.id === id) { setVisit(result.visit); setNeedsReload(false); if (refreshBilling) setBillingRefresh(n => n + 1); }
    } catch (e) { if (isCurrent()) { setNeedsReload(Boolean(visit)); report(e); } }
    finally { if (isCurrent()) setDetailLoading(false); }
  }
  async function openVisit(id: string) { if (pending || billingPending || inflight.current) return; setError(''); setNotice(''); await reloadVisit(id); }
  async function submit(submission: Submission) {
    if (inflight.current) return false;
    inflight.current = true; setBusy(true); setPending(submission); onPending(true); setError(''); setNotice('');
    try {
      const result = await request<{ visit: VisitView }>(submission.path, { method: 'POST', headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': submission.key }, body: JSON.stringify(submission.body) });
      if (!mounted.current) return false;
      detailGeneration.current++; desiredVisit.current = result.visit.id; setDetailLoading(false);
      setVisit(result.visit); setBillingRefresh(n => n + 1); setPending(null); onPending(false); setNeedsReload(false);
      setSaved(previous => ({ sequence: previous.sequence + 1, command: submission.command }));
      setNotice(submission.command ? 'Visit saved.' : 'Patient checked in.');
      return true;
    } catch (e) {
      if (!mounted.current) return false;
      if (e instanceof ApiError && e.status > 0 && e.status < 500) { setPending(null); onPending(false); }
      if (e instanceof ApiError && e.status === 409 && e.code === 'STALE_REVISION' && visit) {
        setNotice('The visit changed. Your draft is still here. Review the latest visit before saving again.');
        setNeedsReload(true); await reloadVisit(visit.id);
      } else report(e);
      return false;
    } finally { inflight.current = false; if (mounted.current) setBusy(false); }
  }
  function command(command: VisitCommand) {
    if (!visit || pending || billingPending || needsReload || detailLoading) return;
    void submit({ key: crypto.randomUUID(), path: `/api/visits/${visit.id}/commands`, body: { expectedRevision: visit.revision, command }, command });
  }
  function searchVisits(e: FormEvent) { e.preventDefault(); abandonDetail(); setError(''); setQuery(search.trim()); setPage(1); setRefresh(n => n + 1); }
  return <div className="staff-visits">
    <div className="page-heading"><div><h1 ref={heading} tabIndex={-1}>{visit ? visit.patient.name : 'Outpatient visits'}</h1><p>{visit ? `${visit.patient.recordNumber} · ${visit.status === 'closed' ? 'Closed historical visit' : 'Active visit'}` : 'Follow each visit from check-in through completion.'}</p></div>{visit && <div className="button-row"><button disabled={Boolean(pending) || billingPending || busy || detailLoading} onClick={() => void reloadVisit(visit.id)}>Refresh visit</button><button disabled={Boolean(pending) || billingPending || busy} onClick={backToQueue}>Back to visit queue</button></div>}</div>
    {detailLoading && <p role="status" className="notice">Loading latest visit…{!visit && <button onClick={() => { abandonDetail(); setError(''); }}>Cancel opening visit</button>}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {pending && <div className="notice warning" role="status"><span>{busy ? 'Saving to the hospital workspace…' : 'This save has not been confirmed. Retry the same request to find or finish the original save.'}</span><button disabled={busy} onClick={() => void submit(pending)}>{busy ? 'Saving…' : 'Retry visit save'}</button></div>}
    {needsReload && visit && <div className="notice warning"><span>Reload the latest visit before making another change. Your draft is preserved.</span><button disabled={detailLoading} onClick={() => void reloadVisit(visit.id)}>Reload latest visit</button></div>}
    {visit ? <VisitPanel key={visit.id} visit={visit} session={session} billingRefresh={billingRefresh} billingPending={billingPending} onBillingPending={setBillingPending} onBillingSaved={() => void reloadVisit(visit.id, false)} onSessionError={onSessionError} disabled={Boolean(pending) || busy || detailLoading || needsReload} onCommand={command} onDirty={setDirty} saved={saved} /> : pending ? <section className="panel"><p>Checking in {checkInPatient?.name}…</p></section> : <section className="panel staff-directory">
      <form className="staff-search" onSubmit={searchVisits}><div><label htmlFor="visit-search">Search visits by patient or record number</label><input id="visit-search" type="search" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} /></div><div className="visit-status-filter"><label htmlFor="visit-status">Visit status</label><select id="visit-status" value={status} onChange={e => { abandonDetail(); setStatus(e.target.value); setPage(1); }}><option value="active">Active</option><option value="closed">Closed</option><option value="all">All visits</option></select></div><button disabled={loading}>Search visits</button><button type="button" disabled={loading} onClick={() => { abandonDetail(); setError(''); setRefresh(n => n + 1); }}>Refresh</button></form>
      {loading ? <p className="empty" role="status">Loading visits…</p> : queueError ? <div className="empty"><p role="alert">{queueError}</p><button onClick={() => { abandonDetail(); setError(''); setRefresh(n => n + 1); }}>Retry loading visits</button></div> : records.visits.length ? <><div role="region" aria-label="Outpatient visit queue" tabIndex={0} className="table-region"><table><thead><tr><th>Patient</th><th>Progress</th><th>Pending work</th><th>Balance</th></tr></thead><tbody>{records.visits.map(row => <tr key={row.id}><td><button className="patient-visit-link" onClick={() => void openVisit(row.id)}>{row.patient.name}</button><small>{row.patient.recordNumber} · {new Date(row.openedAt).toLocaleDateString()}</small></td><td><span className={`badge ${row.status === 'closed' ? 'neutral' : 'teal'}`}>{row.stage}</span></td><td>{row.pendingInvestigations} investigations · {row.pendingPrescriptions} prescriptions</td><td>{row.billing?.state === 'unbilled' ? 'Not yet billed' : row.billing?.state === 'settled' ? 'Settled' : money(row.balance)}</td></tr>)}</tbody></table></div><div className="staff-pagination"><p role="status">{records.total} visits · Page {records.page} of {Math.max(1, Math.ceil(records.total / records.pageSize))}</p><div className="button-row"><button disabled={page === 1} onClick={() => { abandonDetail(); setPage(p => p - 1); }}>Previous visits</button><button disabled={records.page * records.pageSize >= records.total} onClick={() => { abandonDetail(); setPage(p => p + 1); }}>Next visits</button></div></div></> : <div className="empty"><h2>No matching visits</h2><p>{status === 'closed' ? 'Completed visits will appear here.' : 'Check in a registered patient from the patient directory, or adjust the filters.'}</p></div>}
    </section>}
  </div>;
}
export const money = (amount: number) => `${(amount / 100).toFixed(2)} ETB`;
