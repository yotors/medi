import { useEffect, useRef, useState } from 'react';
import type { ClinicalCommand, ClinicalRecord, ClinicalResult, ClinicalReviewer } from '../../shared/clinical';
import type { Session } from '../../shared/registration';
import type { VisitView } from '../../shared/outpatient';
import { ApiError, request } from './api';
import './clinical.css';
import ClinicalHistory from './ClinicalHistory';

type Draft = { subjectId: string; action: 'note.amend' | 'result.correct' | 'result.takeover'; expectedVersion: number; body: string; reason: string; ownerId: string; amendmentId?: string };
type Submission = { key: string; command: ClinicalCommand };
const date = (at: string) => new Date(at).toLocaleString();
export default function ClinicalCorrections({ visit, kind, session, disabled, onDirty, onPending, onSaved, onSessionError }: {
  visit: VisitView; kind: 'note' | 'result'; session: Session; disabled: boolean;
  onDirty: (dirty: boolean) => void; onPending: (pending: boolean) => void; onSaved: () => void; onSessionError: (error: unknown) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null); const [pending, setPending] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState<{ text: string; subjectId: string; version: number } | null>(null);
  const [needsReview, setNeedsReview] = useState(false); const [reviewers, setReviewers] = useState<ClinicalReviewer[]>([]);
  const [reviewersLoading, setReviewersLoading] = useState(false); const [reviewersError, setReviewersError] = useState(''); const [reviewersRefresh, setReviewersRefresh] = useState(0);
  const draftField = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false); const inflight = useRef(false);
  const canAmend = kind === 'note' ? ['admin', 'clinician'].includes(session.user.role) : ['admin', 'lab'].includes(session.user.role);
  const canReview = ['admin', 'clinician'].includes(session.user.role);
  const records = visit.clinical?.records.filter(record => record.kind === kind) ?? [];
  const subjects = kind === 'note' ? (visit.notes ?? []).map((note, index) => ({ id: note.id, label: `Note ${index + 1}`, body: note.body }))
    : (visit.orders ?? []).filter(order => ['released', 'reviewed'].includes(order.status)).map(order => ({ id: order.id, label: order.test, body: order.result }));
  useEffect(() => { if (notice && records.some(record => record.subjectId === notice.subjectId && record.version > notice.version)) setNotice(null); }, [visit.clinical, notice]);
  const prefix = kind === 'note' ? 'note-amendment' : 'result-correction';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (draft) draftField.current?.focus(); }, [draft?.subjectId, draft?.action]);
  useEffect(() => { onDirty(Boolean(draft)); }, [draft, onDirty]);
  useEffect(() => { onPending(Boolean(pending)); }, [pending, onPending]);
  useEffect(() => {
    if (kind !== 'result' || !canAmend) return;
    let cancelled = false; setReviewersLoading(true); setReviewersError('');
    void request<{ reviewers: ClinicalReviewer[] }>('/api/clinical/reviewers').then(result => { if (!cancelled) setReviewers(result.reviewers); })
      .catch(error => { if (!cancelled) { if (error instanceof ApiError && error.status === 401) onSessionError(error); else setReviewersError('Reviewers could not be loaded. Retry before saving a correction.'); } })
      .finally(() => { if (!cancelled) setReviewersLoading(false); });
    return () => { cancelled = true; };
  }, [kind, canAmend, reviewersRefresh]);
  function start(subjectId: string, takeover = false) {
    if (disabled || pending || draft) return;
    const record = records.find(record => record.subjectId === subjectId); const subject = subjects.find(subject => subject.id === subjectId)!;
    setDraft({ subjectId, action: takeover ? 'result.takeover' : kind === 'note' ? 'note.amend' : 'result.correct', expectedVersion: record?.version ?? 0,
      body: record?.latest.body ?? subject.body, reason: '', ownerId: '', ...(record?.review ? { amendmentId: record.review.amendmentId } : {}) });
    setNeedsReview(false); setError(''); setNotice(null);
  }
  async function submit(submission: Submission) {
    if (inflight.current) return;
    inflight.current = true; setBusy(true); setPending(submission); onPending(true); setError(''); setNotice(null);
    try {
      const saved = await request<ClinicalResult>(`/api/visits/${visit.id}/clinical/commands`, { method: 'POST', headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': submission.key }, body: JSON.stringify(submission.command) });
      if (!mounted.current) return;
      setPending(null); onPending(false); setDraft(null); onDirty(false); setNeedsReview(false);
      setNotice({ subjectId: saved.subjectId, version: saved.version, text: submission.command.type === 'note.amend' ? 'Note amendment saved. The original remains in the record.' : submission.command.type === 'result.correct' ? 'Result correction saved. A new clinician review is required.' : submission.command.type === 'result.takeover' ? 'You now own this review. Read the latest correction before acknowledging it.' : 'Corrected result reviewed.' });
      document.getElementById(`${prefix}-subject-${submission.command.subjectId}`)?.focus();
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiError && error.status > 0 && error.status < 500) { setPending(null); onPending(false); }
      if (error instanceof ApiError && error.status === 401) onSessionError(error);
      else {
        setError(error instanceof Error ? error.message : 'The clinical change could not be saved.');
        if (error instanceof ApiError && error.status === 409) { setNeedsReview(true); onSaved(); if (error.code === 'REVIEWER_UNAVAILABLE') setReviewersRefresh(n => n + 1); }
      }
    } finally { inflight.current = false; if (mounted.current) setBusy(false); }
  }
  function saveDraft() {
    if (!draft || disabled || pending || needsReview) return;
    const base = { subjectId: draft.subjectId, expectedVersion: draft.expectedVersion };
    const command: ClinicalCommand = draft.action === 'note.amend' ? { ...base, type: 'note.amend', body: draft.body.trim(), reason: draft.reason.trim() }
      : draft.action === 'result.correct' ? { ...base, type: 'result.correct', body: draft.body.trim(), reason: draft.reason.trim(), ownerId: draft.ownerId }
      : { ...base, type: 'result.takeover', amendmentId: draft.amendmentId!, reason: draft.reason.trim() };
    void submit({ key: crypto.randomUUID(), command });
  }
  function review(record: ClinicalRecord) {
    if (disabled || pending || draft || needsReview) return;
    void submit({ key: crypto.randomUUID(), command: { type: 'result.review', subjectId: record.subjectId, expectedVersion: record.version, amendmentId: record.review!.amendmentId } });
  }
  const formSubject = subjects.find(subject => subject.id === draft?.subjectId);
  const formRecord = records.find(record => record.subjectId === draft?.subjectId);
  return <section className="clinical-corrections" aria-labelledby={`${prefix}-title`}>
    <h2 id={`${prefix}-title`}>{kind === 'note' ? 'Note amendments' : 'Result corrections'}</h2>
    <p className="muted">{kind === 'note' ? 'Append a reasoned correction to a saved note. Original notes remain above.' : 'Original released results remain above. Every correction requires a new review, including after visit closure.'}</p>
    {error && <p role="alert" className="notice error">{error}</p>}
    {notice && <p role="status" className="notice success">{notice.text}</p>}
    {pending && <div role="status" className="notice warning"><span>{busy ? 'Saving clinical history…' : 'This clinical save has not been confirmed. Retry the same request to find or finish the original save.'}</span><button disabled={busy} onClick={() => void submit(pending)}>Retry clinical save</button></div>}
    {needsReview && <div className="notice warning"><span>Your draft is preserved. Read the latest history, then confirm the version before saving again.</span><button disabled={disabled || Boolean(pending)} onClick={() => { if (draft) setDraft({ ...draft, expectedVersion: formRecord?.version ?? 0, amendmentId: formRecord?.review?.amendmentId }); setNeedsReview(false); setError(''); }}>Use latest clinical version</button></div>}
    {!subjects.length && <p className="empty-small">{kind === 'note' ? 'Save a note before adding an amendment.' : 'No released results are available to correct.'}</p>}
    {subjects.map(subject => {
      const record = records.find(record => record.subjectId === subject.id); const latest = record?.latest; const reviewState = record?.review;
      return <article className="clinical-subject" key={subject.id} aria-label={`${subject.label} ${kind === 'note' ? 'amendments' : 'corrections'}`}>
        <div className="section-heading"><h3 id={`${prefix}-subject-${subject.id}`} tabIndex={-1}>{subject.label}</h3>{latest && <span className={`badge ${reviewState && !reviewState.reviewed ? 'warning' : 'neutral'}`}>{kind === 'note' ? 'Amended' : reviewState?.reviewed ? 'Correction reviewed' : 'Review required'}</span>}</div>
        {record?.originalActor && <p className="muted clinical-identity">Original actor: @{record.originalActor.username} · {record.originalActor.id}. Current account name: {record.originalActor.currentName}. Historical display name unavailable.{record.originalAt && <> Recorded {date(record.originalAt)}.</>}</p>}
        {latest ? <><h4>{kind === 'note' ? 'Latest amended note' : 'Latest corrected result'}</h4><p className="preserve clinical-current">{latest.body}</p><p className="preserve"><strong>Reason:</strong> {latest.reason}</p><small>{latest.actorName} · {date(latest.at)}</small></> : <p className="muted">No {kind === 'note' ? 'amendments' : 'corrections'} recorded.</p>}
        {reviewState && <div className="clinical-review"><p><strong>Review owner:</strong> {reviewState.ownerName}{!reviewState.ownerActive && !reviewState.reviewed && ' · Unavailable — another clinician must take over'}</p>{reviewState.reviewed ? <p>Reviewed by {reviewState.reviewerName} · {date(reviewState.reviewedAt!)}</p> : <p className="clinical-pending">This correction still needs acknowledgement.{visit.status === 'closed' && ' The visit remains closed; this follow-up stays outstanding.'}</p>}</div>}
        {record && <ClinicalHistory visitId={visit.id} kind={kind} subjectId={subject.id} version={record.version} disabled={disabled || Boolean(pending)} onSessionError={onSessionError} />}
        <div className="button-row">{canAmend && <button disabled={disabled || Boolean(pending) || Boolean(draft)} onClick={() => start(subject.id)}>{kind === 'note' ? `Amend ${subject.label.toLowerCase()}` : `Correct ${subject.label} result`}</button>}{canReview && reviewState && !reviewState.reviewed && (reviewState.ownerId === session.user.id ? <button className="primary" disabled={disabled || Boolean(pending) || Boolean(draft) || needsReview} onClick={() => review(record!)}>Acknowledge {subject.label} correction</button> : <button disabled={disabled || Boolean(pending) || Boolean(draft)} onClick={() => start(subject.id, true)}>Take over {subject.label} review</button>)}</div>
      </article>;
    })}
    {draft && <form className="clinical-draft" aria-label={`${formSubject?.label} clinical change`} onSubmit={event => { event.preventDefault(); saveDraft(); }}>
      <h3>{draft.action === 'result.takeover' ? 'Take responsibility for review' : draft.action === 'note.amend' ? 'Amend saved note' : 'Correct released result'} · {formSubject?.label}</h3>
      {draft.action !== 'result.takeover' && <><label htmlFor={`${prefix}-body`}>{kind === 'note' ? 'Amended note text' : 'Corrected result text'}</label><textarea ref={draftField} id={`${prefix}-body`} required maxLength={4000} value={draft.body} disabled={disabled || Boolean(pending)} onChange={event => setDraft({ ...draft, body: event.target.value })} /></>}
      <label htmlFor={`${prefix}-reason`}>{draft.action === 'result.takeover' ? 'Reason for taking over' : 'Reason for correction'}</label><textarea ref={draft.action === 'result.takeover' ? draftField : undefined} id={`${prefix}-reason`} required maxLength={500} value={draft.reason} disabled={disabled || Boolean(pending)} onChange={event => setDraft({ ...draft, reason: event.target.value })} />
      {draft.action === 'result.correct' && <><label htmlFor={`${prefix}-owner`}>Assign correction reviewer</label><select id={`${prefix}-owner`} required value={draft.ownerId} disabled={disabled || Boolean(pending) || reviewersLoading} onChange={event => setDraft({ ...draft, ownerId: event.target.value })}><option value="">Choose an active reviewer</option>{reviewers.map(reviewer => <option key={reviewer.id} value={reviewer.id}>{reviewer.name} · @{reviewer.username} · {reviewer.role}</option>)}</select>{reviewersLoading && <p role="status">Loading reviewers…</p>}{reviewersError && <p role="alert">{reviewersError}</p>}{!reviewersLoading && !reviewersError && reviewers.length === 0 && <p role="status">No eligible reviewers are available. An administrator must activate a clinician or administrator account and the reviewer must complete any required password change. Refresh reviewers after this is resolved.</p>}<button type="button" disabled={disabled || Boolean(pending) || reviewersLoading} onClick={() => setReviewersRefresh(n => n + 1)}>Refresh reviewers</button></>}
      <div className="button-row"><button className="primary" disabled={disabled || Boolean(pending) || needsReview || !draft.reason.trim() || (draft.action !== 'result.takeover' && !draft.body.trim()) || (draft.action === 'result.correct' && (!draft.ownerId || reviewersLoading || Boolean(reviewersError)))}>{draft.action === 'note.amend' ? 'Save note amendment' : draft.action === 'result.correct' ? 'Save result correction' : 'Take responsibility'}</button><button type="button" disabled={disabled || Boolean(pending)} onClick={() => { setDraft(null); setError(''); setNeedsReview(false); }}>Discard clinical draft</button></div>
    </form>}
  </section>;
}
