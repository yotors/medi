import { presentationLabel } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
import { hospitalDate } from './date';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RegisteredPatient, Session } from '../../shared/registration';
import type { VisitCommand, VisitPage, VisitView } from '../../shared/outpatient';
import { ApiError, request } from './api';
import VisitPanel from './VisitPanel';

const empty: VisitPage = { visits: [], page: 1, pageSize: 25, total: 0 };
type Submission = { key: string; path: string; body: object; command?: VisitCommand };
export default function VisitWorkspace({
  session,
  checkInPatient,
  onPending,
  onDirty,
  onSessionError,
}: {
  session: Session;
  checkInPatient: RegisteredPatient | null;
  onPending: (pending: boolean) => void;
  onDirty: (dirty: boolean) => void;
  onSessionError: (error: unknown) => void;
}) {
  const [records, setRecords] = useState(empty);
  const [visit, setVisit] = useState<VisitView | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [assigned, setAssigned] = useState('all');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [queueError, setQueueError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [billingRefresh, setBillingRefresh] = useState(0);
  const [pharmacyPending, setPharmacyPending] = useState(false);
  const [clinicalPending, setClinicalPending] = useState(false);
  const [billingPending, setBillingPending] = useState(false);
  const [pending, setPending] = useState<Submission | null>(null);
  const [saved, setSaved] = useState<{ sequence: number; command?: VisitCommand }>({ sequence: 0 });
  const [needsReload, setNeedsReload] = useState(false);
  const mounted = useRef(false);
  const started = useRef(false);
  const inflight = useRef(false);
  const detailGeneration = useRef(0);
  const desiredVisit = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      detailGeneration.current++;
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [visit?.id]);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    onPending(Boolean(pending) || billingPending || clinicalPending || pharmacyPending);
  }, [pending, billingPending, clinicalPending, pharmacyPending, onPending]);
  useEffect(() => {
    if (visit || pending) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setQueueError('');
    void request<VisitPage>('/api/visits/search', {
      method: 'POST',
      headers: { 'X-CSRF-Token': session.csrfToken },
      body: JSON.stringify({ q: query, status, assigned, page }),
    })
      .then((result) => {
        if (!cancelled) setRecords(result);
      })
      .catch((e) => {
        if (!cancelled) {
          if (e instanceof ApiError && e.status === 401) onSessionError(e);
          else
            setQueueError(e instanceof Error ? e.message : t('common:visits_could_not_be_loaded'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, status, assigned, page, refresh, visit, pending]);
  useEffect(() => {
    if (!checkInPatient || started.current) return;
    started.current = true;
    void submit({
      key: crypto.randomUUID(),
      path: `/api/patients/${checkInPatient.id}/visits`,
      body: {},
    });
  }, [checkInPatient]);
  function report(e: unknown) {
    if (e instanceof ApiError && e.status === 401) onSessionError(e);
    else
      setError(
        e instanceof Error ? e.message : t('common:the_visit_could_not_be_loaded_please_retry'),
      );
  }
  function abandonDetail() {
    detailGeneration.current++;
    desiredVisit.current = null;
    setDetailLoading(false);
  }
  function backToQueue() {
    if (
      pending ||
      billingPending ||
      clinicalPending ||
      pharmacyPending ||
      busy ||
      (dirty &&
        !window.confirm(t('common:discard_unsaved_visit_drafts_and_return_to_the_visit_queue')))
    )
      return;
    abandonDetail();
    setDirty(false);
    onDirty(false);
    setVisit(null);
    setNotice('');
    setError('');
    setNeedsReload(false);
    setRefresh((n) => n + 1);
  }
  async function reloadVisit(id: string, refreshBilling = true) {
    const generation = ++detailGeneration.current;
    desiredVisit.current = id;
    const isCurrent = () =>
      mounted.current && detailGeneration.current === generation && desiredVisit.current === id;
    setDetailLoading(true);
    setError('');
    try {
      const result = await request<{ visit: VisitView }>(`/api/visits/${id}`);
      if (isCurrent() && result.visit.id === id) {
        setVisit(result.visit);
        setNeedsReload(false);
        if (refreshBilling) setBillingRefresh((n) => n + 1);
      }
    } catch (e) {
      if (isCurrent()) {
        setNeedsReload(Boolean(visit));
        report(e);
      }
    } finally {
      if (isCurrent()) setDetailLoading(false);
    }
  }
  async function openVisit(id: string) {
    if (pending || billingPending || clinicalPending || pharmacyPending || inflight.current) return;
    setError('');
    setNotice('');
    await reloadVisit(id);
  }
  async function submit(submission: Submission) {
    if (inflight.current) return false;
    inflight.current = true;
    setBusy(true);
    setPending(submission);
    onPending(true);
    setError('');
    setNotice('');
    try {
      const result = await request<{ visit: VisitView }>(submission.path, {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': submission.key },
        body: JSON.stringify(submission.body),
      });
      if (!mounted.current) return false;
      detailGeneration.current++;
      desiredVisit.current = result.visit.id;
      setDetailLoading(false);
      setVisit(result.visit);
      setBillingRefresh((n) => n + 1);
      setPending(null);
      onPending(false);
      setNeedsReload(false);
      setSaved((previous) => ({ sequence: previous.sequence + 1, command: submission.command }));
      setNotice(submission.command ? t('common:visit_saved') : t('common:patient_checked_in'));
      return true;
    } catch (e) {
      if (!mounted.current) return false;
      if (e instanceof ApiError && e.status > 0 && e.status < 500) {
        setPending(null);
        onPending(false);
      }
      if (e instanceof ApiError && e.status === 409 && e.code === 'STALE_REVISION' && visit) {
        setNotice(
          t(
            'common:the_visit_changed_your_draft_is_still_here_review_the_latest_visit_before_saving_again',
          ),
        );
        setNeedsReload(true);
        await reloadVisit(visit.id);
      } else report(e);
      return false;
    } finally {
      inflight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function command(command: VisitCommand) {
    if (
      !visit ||
      pending ||
      billingPending ||
      clinicalPending ||
      pharmacyPending ||
      needsReload ||
      detailLoading
    )
      return;
    void submit({
      key: crypto.randomUUID(),
      path: `/api/visits/${visit.id}/commands`,
      body: { expectedRevision: visit.revision, command },
      command,
    });
  }
  function searchVisits(e: FormEvent) {
    e.preventDefault();
    abandonDetail();
    setError('');
    setQuery(search.trim());
    setPage(1);
    setRefresh((n) => n + 1);
  }
  return (
    <div className="staff-visits">
      <div className="page-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {visit ? visit.patient.name : t('common:outpatient_visits')}
          </h1>
          <p>
            {visit
              ? `${visit.patient.recordNumber} · ${visit.status === 'closed' ? t('common:closed_historical_visit') : t('common:active_visit')}`
              : t('common:follow_each_visit_from_check_in_through_completion')}
          </p>
        </div>
        {visit && (
          <div className="button-row">
            <button
              disabled={
                Boolean(pending) ||
                billingPending ||
                clinicalPending ||
                pharmacyPending ||
                busy ||
                detailLoading
              }
              onClick={() => void reloadVisit(visit.id)}
            >
              {' '}
              {t('common:refresh_visit')}{' '}
            </button>
            <button
              disabled={
                Boolean(pending) || billingPending || clinicalPending || pharmacyPending || busy
              }
              onClick={backToQueue}
            >
              {' '}
              {t('common:back_to_visit_queue')}{' '}
            </button>
          </div>
        )}
      </div>
      {detailLoading && (
        <p role="status" className="notice">
          {' '}
          {t('common:loading_latest_visit')}{' '}
          {!visit && (
            <button
              onClick={() => {
                abandonDetail();
                setError('');
              }}
            >
              {' '}
              {t('common:cancel_opening_visit')}{' '}
            </button>
          )}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {interfaceMessage(error)}
        </p>
      )}
      {notice && (
        <p className="notice success" role="status">
          {interfaceMessage(notice)}
        </p>
      )}
      {pending && (
        <div className="notice warning" role="status">
          <span>
            {busy
              ? t('common:saving_to_the_hospital_workspace')
              : t(
                  'common:this_save_has_not_been_confirmed_retry_the_same_request_to_find_or_finish_the_original_save',
                )}
          </span>
          <button disabled={busy} onClick={() => void submit(pending)}>
            {busy ? t('common:saving') : t('common:retry_visit_save')}
          </button>
        </div>
      )}
      {needsReload && visit && (
        <div className="notice warning">
          <span>
            {' '}
            {t(
              'common:reload_the_latest_visit_before_making_another_change_your_draft_is_preserved',
            )}{' '}
          </span>
          <button disabled={detailLoading} onClick={() => void reloadVisit(visit.id)}>
            {' '}
            {t('common:reload_latest_visit')}{' '}
          </button>
        </div>
      )}
      {visit ? (
        <VisitPanel
          key={visit.id}
          visit={visit}
          session={session}
          billingRefresh={billingRefresh}
          billingPending={billingPending}
          clinicalPending={clinicalPending}
          pharmacyPending={pharmacyPending}
          onPharmacyPending={setPharmacyPending}
          onClinicalPending={setClinicalPending}
          onBillingPending={setBillingPending}
          onBillingSaved={() => void reloadVisit(visit.id, false)}
          onSessionError={onSessionError}
          disabled={Boolean(pending) || busy || detailLoading || needsReload}
          onCommand={command}
          onDirty={setDirty}
          saved={saved}
        />
      ) : pending ? (
        <section className="panel">
          <p>
            {t('common:checking_in')} {checkInPatient?.name}…
          </p>
        </section>
      ) : (
        <section className="panel staff-directory">
          <form className="staff-search" onSubmit={searchVisits}>
            <div>
              <label htmlFor="visit-search">
                {t('common:search_visits_by_patient_or_record_number')}
              </label>
              <input
                id="visit-search"
                type="search"
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="visit-status-filter">
              <label htmlFor="visit-status">{t('common:visit_status')}</label>
              <select
                id="visit-status"
                value={status}
                onChange={(e) => {
                  abandonDetail();
                  setStatus(e.target.value);
                  setAssigned('all');
                  setPage(1);
                }}
              >
                <option value="active">{t('common:active')}</option>
                <option value="closed">{t('common:closed_2')}</option>
                <option value="all">{t('common:all_visits')}</option>
                <option value="corrections">
                  {t('common:corrections_awaiting_review_all_visits')}
                </option>
              </select>
            </div>
            {status === 'corrections' && ['admin', 'clinician'].includes(session.user.role) && (
              <div>
                <label htmlFor="review-assignment">{t('common:review_assignment')}</label>
                <select
                  id="review-assignment"
                  value={assigned}
                  onChange={(event) => {
                    setAssigned(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">{t('common:all_hospital_reviews')}</option>
                  <option value="me">{t('common:assigned_to_me')}</option>
                </select>
              </div>
            )}
            <button disabled={loading}>{t('common:search_visits')}</button>
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                abandonDetail();
                setError('');
                setRefresh((n) => n + 1);
              }}
            >
              {' '}
              {t('common:refresh')}{' '}
            </button>
          </form>
          {loading ? (
            <p className="empty" role="status">
              {' '}
              {t('common:loading_visits')}{' '}
            </p>
          ) : queueError ? (
            <div className="empty">
              <p role="alert">{interfaceMessage(queueError)}</p>
              <button
                onClick={() => {
                  abandonDetail();
                  setError('');
                  setRefresh((n) => n + 1);
                }}
              >
                {' '}
                {t('common:retry_loading_visits')}{' '}
              </button>
            </div>
          ) : records.visits.length ? (
            <>
              <div
                role="region"
                aria-label={t('common:outpatient_visit_queue')}
                tabIndex={0}
                className="table-region"
              >
                <table>
                  <thead>
                    <tr>
                      <th>{t('common:patient')}</th>
                      <th>{t('common:progress')}</th>
                      <th>{t('common:pending_work')}</th>
                      <th>{t('common:balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.visits.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <button
                            className="patient-visit-link"
                            onClick={() => void openVisit(row.id)}
                          >
                            {row.patient.name}
                          </button>
                          <small>
                            {row.patient.recordNumber} ·{' '}
                            {new Date(row.openedAt).toLocaleDateString()}
                          </small>
                        </td>
                        <td>
                          <span className={`badge ${row.status === 'closed' ? 'neutral' : 'teal'}`}>
                            {presentationLabel(row.stage)}
                          </span>
                        </td>
                        <td>
                          {row.pendingInvestigations} {t('common:investigations_2')}{' '}
                          {row.pendingPrescriptions} {t('common:prescriptions_2')}{' '}
                          {row.pendingClinicalReviews > 0 && (
                            <small>
                              {row.pendingClinicalReviews} {t('common:corrected_results_to_review')}
                            </small>
                          )}
                          {row.clinicalAssignments?.map((assignment) => (
                            <small key={assignment.subjectId}>
                              {' '}
                              {t('common:review_2')} {assignment.ownerName} (@
                              {assignment.ownerUsername}
                              {t('common:corrected')} {hospitalDate(assignment.correctedAt)}
                            </small>
                          ))}
                        </td>
                        <td>
                          {row.billing?.state === 'unbilled'
                            ? t('common:not_yet_billed')
                            : row.billing?.state === 'settled'
                              ? t('common:settled')
                              : money(row.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="staff-pagination">
                <p role="status">
                  {records.total} {t('common:visits_page')} {records.page} {t('common:of')}{' '}
                  {Math.max(1, Math.ceil(records.total / records.pageSize))}
                </p>
                <div className="button-row">
                  <button
                    disabled={page === 1}
                    onClick={() => {
                      abandonDetail();
                      setPage((p) => p - 1);
                    }}
                  >
                    {' '}
                    {t('common:previous_visits')}{' '}
                  </button>
                  <button
                    disabled={records.page * records.pageSize >= records.total}
                    onClick={() => {
                      abandonDetail();
                      setPage((p) => p + 1);
                    }}
                  >
                    {' '}
                    {t('common:next_visits')}{' '}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty">
              <h2>{t('common:no_matching_visits')}</h2>
              <p>
                {status === 'corrections'
                  ? query
                    ? t('common:no_corrected_results_match_these_filters')
                    : assigned === 'me'
                      ? t('common:no_corrected_results_are_currently_assigned_to_you')
                      : t(
                          'common:no_corrected_results_are_awaiting_review_in_active_or_closed_visits',
                        )
                  : status === 'closed'
                    ? t('common:completed_visits_will_appear_here')
                    : t(
                        'common:check_in_a_registered_patient_from_the_patient_directory_or_adjust_the_filters',
                      )}
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
export const money = (amount: number) => `${(amount / 100).toFixed(2)} ETB`;
