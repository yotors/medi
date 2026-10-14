import { hospitalDate } from './date';
import { useEffect, useState } from 'react';
import type { InventoryEvent, InventoryPage } from '../../shared/inventory';
import type { VisitView } from '../../shared/outpatient';
import { ApiError, request } from './api';
const labels: Record<string, string> = {
  'product.create': 'Product created',
  'product.status': 'Product status changed',
  'batch.create': 'Batch created',
  'batch.status': 'Quarantine changed',
  'stock.receive': 'Stock received',
  'stock.adjust': 'Stock adjusted',
  authorize: 'Product and quantity authorized',
  dispense: 'Prescription supplied',
  cancel: 'Remaining supply cancelled',
};
export default function InventoryHistory({
  path,
  refresh,
  disabled,
  onSessionError,
  prescriptions,
}: {
  path: string;
  refresh: number;
  disabled: boolean;
  onSessionError: (error: unknown) => void;
  prescriptions?: VisitView['prescriptions'];
}) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<InventoryPage<InventoryEvent> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    setPage(1);
  }, [path, refresh]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void request<InventoryPage<InventoryEvent>>(
      `${path}${path.includes('?') ? '&' : '?'}page=${page}`,
    )
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((error) => {
        if (!cancelled) {
          if (error instanceof ApiError && error.status === 401) onSessionError(error);
          else
            setError('Inventory history could not be loaded. Retry when the connection returns.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, page, refresh, retry]);
  return (
    <section className="inventory-history" aria-label="Inventory history">
      <h3>Inventory history</h3>
      {loading ? (
        <p role="status">Loading inventory history…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        data && (
          <>
            {!data.entries.length ? (
              <p className="empty-small">No inventory events recorded.</p>
            ) : (
              <ol className="timeline">
                {data.entries.map((event) => {
                  const index =
                    prescriptions?.findIndex((item) => item.id === event.prescriptionId) ?? -1;
                  return (
                    <li key={event.id}>
                      <strong>{labels[event.action]}</strong>
                      <small>
                        {event.actorName} · {hospitalDate(event.at)}
                      </small>
                      <details className="inventory-identity">
                        <summary>Recorded movement and staff identity</summary>
                        <p>
                          {event.action === 'dispense'
                            ? 'Original dispense ID for patient returns'
                            : 'Inventory event ID'}
                          : {event.id}
                        </p>
                        {event.batchId && <p>Batch ID: {event.batchId}</p>}
                        <p>Product ID: {event.productId}</p>
                        <p>Staff ID: {event.actorId}</p>
                      </details>
                      {event.prescriptionId &&
                        (index >= 0 ? (
                          <div>
                            <p>
                              <strong>Prescription {index + 1}</strong>
                            </p>
                            <p className="preserve">{prescriptions![index].instruction}</p>
                          </div>
                        ) : (
                          <details className="inventory-identity">
                            <summary>Visit and prescription identity</summary>
                            <p>Visit ID: {event.visitId}</p>
                            <p>Prescription ID: {event.prescriptionId}</p>
                          </details>
                        ))}
                      <p>
                        {event.snapshot.code} · {event.snapshot.name}
                      </p>
                      {event.snapshot.lot && (
                        <p>
                          Lot {event.snapshot.lot}
                          {event.snapshot.expiry && <> · Recorded expiry {event.snapshot.expiry}</>}
                        </p>
                      )}
                      {event.snapshot.quantity !== undefined && (
                        <p>
                          Quantity: {event.snapshot.quantity} {event.snapshot.unit}
                          {event.snapshot.balance !== undefined && (
                            <> · Batch balance: {event.snapshot.balance}</>
                          )}
                        </p>
                      )}
                      {event.snapshot.remaining !== undefined && (
                        <p>
                          Remaining: {event.snapshot.remaining} {event.snapshot.unit}
                        </p>
                      )}
                      {event.snapshot.cancelledQuantity !== undefined && (
                        <p>
                          Cancelled remainder: {event.snapshot.cancelledQuantity} · Already
                          supplied: {event.snapshot.supplied}
                        </p>
                      )}
                      {event.snapshot.reason && (
                        <p className="preserve">Reason: {event.snapshot.reason}</p>
                      )}
                      {event.snapshot.reference && (
                        <p className="preserve">Receipt reference: {event.snapshot.reference}</p>
                      )}
                      {event.snapshot.active !== undefined && (
                        <p>Product {event.snapshot.active ? 'active' : 'inactive'}</p>
                      )}
                      {event.snapshot.quarantined !== undefined && (
                        <p>{event.snapshot.quarantined ? 'Quarantined' : 'Not quarantined'}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <p>
              {data.total} events · Page {data.page} of{' '}
              {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </p>
          </>
        )
      )}
      <div className="button-row">
        <button disabled={disabled || loading || page === 1} onClick={() => setPage(page - 1)}>
          Previous inventory history
        </button>
        <button
          disabled={
            disabled || loading || Boolean(error) || !data || page * data.pageSize >= data.total
          }
          onClick={() => setPage(page + 1)}
        >
          Next inventory history
        </button>
        <button disabled={disabled || loading} onClick={() => setRetry(retry + 1)}>
          {error ? 'Retry inventory history' : 'Refresh inventory history'}
        </button>
      </div>
    </section>
  );
}
