import { presentationLabel } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
import { hospitalDate } from './date';
import { useEffect, useRef, useState } from 'react';
import type {
  ClinicalCommand,
  ClinicalRecord,
  ClinicalResult,
  ClinicalReviewer,
} from '../../shared/clinical';
import type { Session } from '../../shared/registration';
import type { VisitView } from '../../shared/outpatient';
import { ApiError, request } from './api';
import './clinical.css';
import ClinicalHistory from './ClinicalHistory';

type Draft = {
  subjectId: string;
  action: 'note.amend' | 'result.correct' | 'result.takeover';
  expectedVersion: number;
  body: string;
  reason: string;
  ownerId: string;
  amendmentId?: string;
};
type Submission = { key: string; command: ClinicalCommand };
const date = (at: string) => hospitalDate(at);
export default function ClinicalCorrections({
  visit,
  kind,
  session,
  disabled,
  onDirty,
  onPending,
  onSaved,
  onSessionError,
}: {
  visit: VisitView;
  kind: 'note' | 'result';
  session: Session;
  disabled: boolean;
  onDirty: (dirty: boolean) => void;
  onPending: (pending: boolean) => void;
  onSaved: () => void;
  onSessionError: (error: unknown) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ text: string; subjectId: string; version: number } | null>(
    null,
  );
  const [needsReview, setNeedsReview] = useState(false);
  const [reviewers, setReviewers] = useState<ClinicalReviewer[]>([]);
  const [reviewersLoading, setReviewersLoading] = useState(false);
  const [reviewersError, setReviewersError] = useState('');
  const [reviewersRefresh, setReviewersRefresh] = useState(0);
  const draftField = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false);
  const inflight = useRef(false);
  const canAmend =
    kind === 'note'
      ? ['admin', 'clinician'].includes(session.user.role)
      : ['admin', 'lab'].includes(session.user.role);
  const canReview = ['admin', 'clinician'].includes(session.user.role);
  const records = visit.clinical?.records.filter((record) => record.kind === kind) ?? [];
  const subjects =
    kind === 'note'
      ? (visit.notes ?? []).map((note, index) => ({
          id: note.id,
          label: t('dynamic:note_number', { number: index + 1 }),
          body: note.body,
        }))
      : (visit.orders ?? [])
          .filter((order) => ['released', 'reviewed'].includes(order.status))
          .map((order) => ({ id: order.id, label: order.test, body: order.result }));
  useEffect(() => {
    if (
      notice &&
      records.some(
        (record) => record.subjectId === notice.subjectId && record.version > notice.version,
      )
    )
      setNotice(null);
  }, [visit.clinical, notice]);
  const prefix = kind === 'note' ? 'note-amendment' : 'result-correction';
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (draft) draftField.current?.focus();
  }, [draft?.subjectId, draft?.action]);
  useEffect(() => {
    onDirty(Boolean(draft));
  }, [draft, onDirty]);
  useEffect(() => {
    onPending(Boolean(pending));
  }, [pending, onPending]);
  useEffect(() => {
    if (kind !== 'result' || !canAmend) return;
    let cancelled = false;
    setReviewersLoading(true);
    setReviewersError('');
    void request<{ reviewers: ClinicalReviewer[] }>('/api/clinical/reviewers')
      .then((result) => {
        if (!cancelled) setReviewers(result.reviewers);
      })
      .catch((error) => {
        if (!cancelled) {
          if (error instanceof ApiError && error.status === 401) onSessionError(error);
          else setReviewersError(t('common:reviewers_failed'));
        }
      })
      .finally(() => {
        if (!cancelled) setReviewersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, canAmend, reviewersRefresh]);
  function start(subjectId: string, takeover = false) {
    if (disabled || pending || draft) return;
    const record = records.find((record) => record.subjectId === subjectId);
    const subject = subjects.find((subject) => subject.id === subjectId)!;
    setDraft({
      subjectId,
      action: takeover ? 'result.takeover' : kind === 'note' ? 'note.amend' : 'result.correct',
      expectedVersion: record?.version ?? 0,
      body: record?.latest.body ?? subject.body,
      reason: '',
      ownerId: '',
      ...(record?.review ? { amendmentId: record.review.amendmentId } : {}),
    });
    setNeedsReview(false);
    setError('');
    setNotice(null);
  }
  async function submit(submission: Submission) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setPending(submission);
    onPending(true);
    setError('');
    setNotice(null);
    try {
      const saved = await request<ClinicalResult>(`/api/visits/${visit.id}/clinical/commands`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': submission.key },
        body: JSON.stringify(submission.command),
      });
      if (!mounted.current) return;
      setPending(null);
      onPending(false);
      setDraft(null);
      onDirty(false);
      setNeedsReview(false);
      setNotice({
        subjectId: saved.subjectId,
        version: saved.version,
        text:
          submission.command.type === 'note.amend'
            ? t('common:note_amendment_saved_the_original_remains_in_the_record')
            : submission.command.type === 'result.correct'
              ? t('common:result_correction_saved_a_new_clinician_review_is_required')
              : submission.command.type === 'result.takeover'
                ? t(
                    'common:you_now_own_this_review_read_the_latest_correction_before_acknowledging_it',
                  )
                : t('common:corrected_result_reviewed'),
      });
      document.getElementById(`${prefix}-subject-${submission.command.subjectId}`)?.focus();
      onSaved();
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof ApiError && error.status > 0 && error.status < 500) {
        setPending(null);
        onPending(false);
      }
      if (error instanceof ApiError && error.status === 401) onSessionError(error);
      else {
        setError(
          error instanceof Error
            ? error.message
            : t('common:the_clinical_change_could_not_be_saved'),
        );
        if (error instanceof ApiError && error.status === 409) {
          setNeedsReview(true);
          onSaved();
          if (error.code === 'REVIEWER_UNAVAILABLE') setReviewersRefresh((n) => n + 1);
        }
      }
    } finally {
      inflight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function saveDraft() {
    if (!draft || disabled || pending || needsReview) return;
    const base = { subjectId: draft.subjectId, expectedVersion: draft.expectedVersion };
    const command: ClinicalCommand =
      draft.action === 'note.amend'
        ? { ...base, type: 'note.amend', body: draft.body.trim(), reason: draft.reason.trim() }
        : draft.action === 'result.correct'
          ? {
              ...base,
              type: 'result.correct',
              body: draft.body.trim(),
              reason: draft.reason.trim(),
              ownerId: draft.ownerId,
            }
          : {
              ...base,
              type: 'result.takeover',
              amendmentId: draft.amendmentId!,
              reason: draft.reason.trim(),
            };
    void submit({ key: crypto.randomUUID(), command });
  }
  function review(record: ClinicalRecord) {
    if (disabled || pending || draft || needsReview) return;
    void submit({
      key: crypto.randomUUID(),
      command: {
        type: 'result.review',
        subjectId: record.subjectId,
        expectedVersion: record.version,
        amendmentId: record.review!.amendmentId,
      },
    });
  }
  const formSubject = subjects.find((subject) => subject.id === draft?.subjectId);
  const formRecord = records.find((record) => record.subjectId === draft?.subjectId);
  return (
    <section className="clinical-corrections" aria-labelledby={`${prefix}-title`}>
      <h2 id={`${prefix}-title`}>
        {kind === 'note' ? t('common:note_amendments') : t('common:result_corrections')}
      </h2>
      <p className="muted">
        {kind === 'note'
          ? t('common:append_a_reasoned_correction_to_a_saved_note_original_notes_remain_above')
          : t(
              'common:original_released_results_remain_above_every_correction_requires_a_new_review_including_after_v',
            )}
      </p>
      {error && (
        <p role="alert" className="notice error">
          {interfaceMessage(error)}
        </p>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice.text}
        </p>
      )}
      {pending && (
        <div role="status" className="notice warning">
          <span>
            {busy
              ? t('common:saving_clinical_history')
              : t(
                  'common:this_clinical_save_has_not_been_confirmed_retry_the_same_request_to_find_or_finish_the_original',
                )}
          </span>
          <button disabled={busy} onClick={() => void submit(pending)}>
            {' '}
            {t('common:retry_clinical_save')}{' '}
          </button>
        </div>
      )}
      {needsReview && (
        <div className="notice warning">
          <span>
            {' '}
            {t(
              'common:your_draft_is_preserved_read_the_latest_history_then_confirm_the_version_before_saving_again',
            )}{' '}
          </span>
          <button
            disabled={disabled || Boolean(pending)}
            onClick={() => {
              if (draft)
                setDraft({
                  ...draft,
                  expectedVersion: formRecord?.version ?? 0,
                  amendmentId: formRecord?.review?.amendmentId,
                });
              setNeedsReview(false);
              setError('');
            }}
          >
            {' '}
            {t('common:use_latest_clinical_version')}{' '}
          </button>
        </div>
      )}
      {!subjects.length && (
        <p className="empty-small">
          {kind === 'note'
            ? t('common:save_a_note_before_adding_an_amendment')
            : t('common:no_released_results_are_available_to_correct')}
        </p>
      )}
      {subjects.map((subject) => {
        const record = records.find((record) => record.subjectId === subject.id);
        const latest = record?.latest;
        const reviewState = record?.review;
        return (
          <article
            className="clinical-subject"
            key={subject.id}
            aria-label={t(
              kind === 'note' ? 'dynamic:note_history_label' : 'dynamic:result_history_label',
              { label: subject.label },
            )}
          >
            <div className="section-heading">
              <h3 id={`${prefix}-subject-${subject.id}`} tabIndex={-1}>
                {subject.label}
              </h3>
              {latest && (
                <span
                  className={`badge ${reviewState && !reviewState.reviewed ? 'warning' : 'neutral'}`}
                >
                  {kind === 'note'
                    ? t('common:amended')
                    : reviewState?.reviewed
                      ? t('common:correction_reviewed')
                      : t('common:review_required')}
                </span>
              )}
            </div>
            {record?.originalActor && (
              <p className="muted clinical-identity">
                {' '}
                {t('common:original_actor')}
                {record.originalActor.username} · {record.originalActor.id}
                {t('common:current_account_name')} {record.originalActor.currentName}
                {t('common:historical_display_name_unavailable')}
                {record.originalAt && (
                  <>
                    {' '}
                    {t('common:recorded')} {date(record.originalAt)}.
                  </>
                )}
              </p>
            )}
            {latest ? (
              <>
                <h4>
                  {kind === 'note'
                    ? t('common:latest_amended_note')
                    : t('common:latest_corrected_result')}
                </h4>
                <p className="preserve clinical-current">{latest.body}</p>
                <p className="preserve">
                  <strong>{t('common:reason')}</strong> {latest.reason}
                </p>
                <small>
                  {latest.actorName} · {date(latest.at)}
                </small>
              </>
            ) : (
              <p className="muted">
                {t(
                  kind === 'note'
                    ? 'common:no_amendments_recorded'
                    : 'common:no_corrections_recorded',
                )}
              </p>
            )}
            {reviewState && (
              <div className="clinical-review">
                <p>
                  <strong>{t('common:review_owner')}</strong> {reviewState.ownerName}
                  {!reviewState.ownerActive &&
                    !reviewState.reviewed &&
                    t('common:unavailable_another_clinician_must_take_over')}
                </p>
                {reviewState.reviewed ? (
                  <p>
                    {' '}
                    {t('common:reviewed_by')} {reviewState.reviewerName} ·{' '}
                    {date(reviewState.reviewedAt!)}
                  </p>
                ) : (
                  <p className="clinical-pending">
                    {' '}
                    {t('common:this_correction_still_needs_acknowledgement')}{' '}
                    {visit.status === 'closed' &&
                      t('common:the_visit_remains_closed_this_follow_up_stays_outstanding')}
                  </p>
                )}
              </div>
            )}
            {record && (
              <ClinicalHistory
                visitId={visit.id}
                kind={kind}
                subjectId={subject.id}
                version={record.version}
                disabled={disabled || Boolean(pending)}
                onSessionError={onSessionError}
              />
            )}
            <div className="button-row">
              {canAmend && (
                <button
                  disabled={disabled || Boolean(pending) || Boolean(draft)}
                  onClick={() => start(subject.id)}
                >
                  {kind === 'note'
                    ? t('dynamic:amend_subject', { label: subject.label })
                    : t('dynamic:correct_subject', { label: subject.label })}
                </button>
              )}
              {canReview &&
                reviewState &&
                !reviewState.reviewed &&
                (reviewState.ownerId === session.user.id ? (
                  <button
                    className="primary"
                    disabled={disabled || Boolean(pending) || Boolean(draft) || needsReview}
                    onClick={() => review(record!)}
                  >
                    {' '}
                    {t('common:acknowledge')} {subject.label} {t('common:correction')}{' '}
                  </button>
                ) : (
                  <button
                    disabled={disabled || Boolean(pending) || Boolean(draft)}
                    onClick={() => start(subject.id, true)}
                  >
                    {' '}
                    {t('common:take_over')} {subject.label} {t('common:review')}{' '}
                  </button>
                ))}
            </div>
          </article>
        );
      })}
      {draft && (
        <form
          className="clinical-draft"
          aria-label={t('dynamic:clinical_change', { label: formSubject?.label })}
          onSubmit={(event) => {
            event.preventDefault();
            saveDraft();
          }}
        >
          <h3>
            {draft.action === 'result.takeover'
              ? t('common:take_responsibility_for_review')
              : draft.action === 'note.amend'
                ? t('common:amend_saved_note')
                : t('common:correct_released_result')}{' '}
            · {formSubject?.label}
          </h3>
          {draft.action !== 'result.takeover' && (
            <>
              <label htmlFor={`${prefix}-body`}>
                {kind === 'note'
                  ? t('common:amended_note_text')
                  : t('common:corrected_result_text')}
              </label>
              <textarea
                ref={draftField}
                id={`${prefix}-body`}
                required
                maxLength={4000}
                value={draft.body}
                disabled={disabled || Boolean(pending)}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              />
            </>
          )}
          <label htmlFor={`${prefix}-reason`}>
            {draft.action === 'result.takeover'
              ? t('common:reason_for_taking_over')
              : t('common:reason_for_correction')}
          </label>
          <textarea
            ref={draft.action === 'result.takeover' ? draftField : undefined}
            id={`${prefix}-reason`}
            required
            maxLength={500}
            value={draft.reason}
            disabled={disabled || Boolean(pending)}
            onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
          />
          {draft.action === 'result.correct' && (
            <>
              <label htmlFor={`${prefix}-owner`}>{t('common:assign_correction_reviewer')}</label>
              <select
                id={`${prefix}-owner`}
                required
                value={draft.ownerId}
                disabled={disabled || Boolean(pending) || reviewersLoading}
                onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}
              >
                <option value="">{t('common:choose_an_active_reviewer')}</option>
                {reviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name} · @{reviewer.username} · {presentationLabel(reviewer.role)}
                  </option>
                ))}
              </select>
              {reviewersLoading && <p role="status">{t('common:loading_reviewers')}</p>}
              {reviewersError && <p role="alert">{reviewersError}</p>}
              {!reviewersLoading && !reviewersError && reviewers.length === 0 && (
                <p role="status">
                  {' '}
                  {t(
                    'common:no_eligible_reviewers_are_available_an_administrator_must_activate_a_clinician_or_administrator',
                  )}{' '}
                </p>
              )}
              <button
                type="button"
                disabled={disabled || Boolean(pending) || reviewersLoading}
                onClick={() => setReviewersRefresh((n) => n + 1)}
              >
                {' '}
                {t('common:refresh_reviewers')}{' '}
              </button>
            </>
          )}
          <div className="button-row">
            <button
              className="primary"
              disabled={
                disabled ||
                Boolean(pending) ||
                needsReview ||
                !draft.reason.trim() ||
                (draft.action !== 'result.takeover' && !draft.body.trim()) ||
                (draft.action === 'result.correct' &&
                  (!draft.ownerId || reviewersLoading || Boolean(reviewersError)))
              }
            >
              {draft.action === 'note.amend'
                ? t('common:save_note_amendment')
                : draft.action === 'result.correct'
                  ? t('common:save_result_correction')
                  : t('common:take_responsibility')}
            </button>
            <button
              type="button"
              disabled={disabled || Boolean(pending)}
              onClick={() => {
                setDraft(null);
                setError('');
                setNeedsReview(false);
              }}
            >
              {' '}
              {t('common:discard_clinical_draft')}{' '}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
