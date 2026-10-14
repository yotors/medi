import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
import { hospitalDate } from './date';
import { useEffect, useState } from 'react';
import type { ClinicalHistoryPage } from '../../shared/clinical';
import { ApiError, request } from './api';
const labels = {
  get 'note.amend'() {
    return t('labels:note_amended');
  },
  get 'result.correct'() {
    return t('labels:result_corrected');
  },
  get 'result.review'() {
    return t('labels:correction_reviewed');
  },
  get 'result.takeover'() {
    return t('labels:review_responsibility_changed');
  },
};
export default function ClinicalHistory({
  visitId,
  kind,
  subjectId,
  version,
  disabled,
  onSessionError,
}: {
  visitId: string;
  kind?: 'note' | 'result';
  subjectId?: string;
  version?: number;
  disabled: boolean;
  onSessionError: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<ClinicalHistoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setPage(1);
  }, [version]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    void request<ClinicalHistoryPage>(
      `/api/visits/${visitId}/clinical/history?page=${page}${kind && subjectId ? `&kind=${kind}&subjectId=${subjectId}` : ''}`,
    )
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((error) => {
        if (!cancelled) {
          if (error instanceof ApiError && error.status === 401) onSessionError(error);
          else
            setError(
              error instanceof Error ? error.message : t('common:history_could_not_be_loaded'),
            );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, page, refresh, visitId, kind, subjectId, version]);
  return (
    <details className="clinical-history" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {subjectId
          ? t('dynamic:clinical_history_count', { count: version ?? 0 })
          : t('common:clinical_amendment_and_review_history')}
      </summary>
      {open && (
        <div role="region" aria-label={t('common:clinical_history_pages')}>
          {loading ? (
            <p role="status">{t('common:loading_clinical_history')}</p>
          ) : error ? (
            <p role="alert">{interfaceMessage(error)}</p>
          ) : (
            data && (
              <>
                <p>
                  {data.total} {t('common:events_page')} {data.page} {t('common:of')}{' '}
                  {Math.max(1, Math.ceil(data.total / data.pageSize))}
                </p>
                {!data.events.length && <p>{t('common:no_clinical_corrections_recorded')}</p>}
                <ol className="timeline">
                  {data.events.map((event) => (
                    <li key={event.id}>
                      <strong>{labels[event.action]}</strong>
                      <small>
                        {event.actorName} · {hospitalDate(event.at)} {t('common:version')}{' '}
                        {event.version}
                      </small>
                      {event.amendment && (
                        <>
                          <p className="preserve">{event.amendment.body}</p>
                          <p className="preserve">
                            {t('common:reason')} {event.amendment.reason}
                          </p>
                        </>
                      )}
                      {event.reason && (
                        <p className="preserve">
                          {t('common:reason')} {event.reason}
                        </p>
                      )}
                      {event.ownerName && (
                        <p>
                          {t('common:review_assigned_to')} {event.ownerName}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )
          )}
          <div className="button-row">
            <button
              disabled={disabled || loading || page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              {' '}
              {t('common:previous_clinical_history')}{' '}
            </button>
            <button
              disabled={
                disabled || loading || Boolean(error) || !data || page * data.pageSize >= data.total
              }
              onClick={() => setPage((value) => value + 1)}
            >
              {' '}
              {t('common:next_clinical_history')}{' '}
            </button>
            <button disabled={disabled || loading} onClick={() => setRefresh((value) => value + 1)}>
              {error ? t('common:retry_clinical_history') : t('common:refresh_clinical_history')}
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
