import { hospitalDate } from './date';
import { useEffect, useState } from 'react';
import type { ClinicalHistoryPage } from '../../shared/clinical';
import { ApiError, request } from './api';
const labels = {
  'note.amend': 'Note amended',
  'result.correct': 'Result corrected',
  'result.review': 'Correction reviewed',
  'result.takeover': 'Review responsibility changed',
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
          else setError(error instanceof Error ? error.message : 'History could not be loaded.');
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
          ? `View amendment and review history (${version ?? 0})`
          : 'Clinical amendment and review history'}
      </summary>
      {open && (
        <div role="region" aria-label="Clinical history pages">
          {loading ? (
            <p role="status">Loading clinical history…</p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : (
            data && (
              <>
                <p>
                  {data.total} events · Page {data.page} of{' '}
                  {Math.max(1, Math.ceil(data.total / data.pageSize))}
                </p>
                {!data.events.length && <p>No clinical corrections recorded.</p>}
                <ol className="timeline">
                  {data.events.map((event) => (
                    <li key={event.id}>
                      <strong>{labels[event.action]}</strong>
                      <small>
                        {event.actorName} · {hospitalDate(event.at)} · Version {event.version}
                      </small>
                      {event.amendment && (
                        <>
                          <p className="preserve">{event.amendment.body}</p>
                          <p className="preserve">Reason: {event.amendment.reason}</p>
                        </>
                      )}
                      {event.reason && <p className="preserve">Reason: {event.reason}</p>}
                      {event.ownerName && <p>Review assigned to {event.ownerName}</p>}
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
              Previous clinical history
            </button>
            <button
              disabled={
                disabled || loading || Boolean(error) || !data || page * data.pageSize >= data.total
              }
              onClick={() => setPage((value) => value + 1)}
            >
              Next clinical history
            </button>
            <button disabled={disabled || loading} onClick={() => setRefresh((value) => value + 1)}>
              {error ? 'Retry clinical history' : 'Refresh clinical history'}
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
