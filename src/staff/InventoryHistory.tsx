import { uiMessage } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
import { hospitalDate } from './date';
import { useEffect, useState } from 'react';
import type { InventoryEvent, InventoryPage } from '../../shared/inventory';
import type { VisitView } from '../../shared/outpatient';
import { ApiError, request } from './api';
const labels: Record<string, string> = {
  get 'product.create'() {
    return t('labels:product_created');
  },
  get 'product.status'() {
    return t('labels:product_status_changed');
  },
  get 'batch.create'() {
    return t('labels:batch_created');
  },
  get 'batch.status'() {
    return t('labels:quarantine_changed');
  },
  get 'stock.receive'() {
    return t('labels:stock_received');
  },
  get 'stock.adjust'() {
    return t('labels:stock_adjusted');
  },
  get authorize() {
    return t('labels:product_and_quantity_authorized');
  },
  get dispense() {
    return t('labels:prescription_supplied');
  },
  get cancel() {
    return t('labels:remaining_supply_cancelled');
  },
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
            setError(
              uiMessage(
                'inventory:inventory_history_could_not_be_loaded_retry_when_the_connection_returns',
              ),
            );
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
    <section className="inventory-history" aria-label={t('inventory:inventory_history')}>
      <h3>{t('inventory:inventory_history')}</h3>
      {loading ? (
        <p role="status">{t('inventory:loading_inventory_history')}</p>
      ) : error ? (
        <p role="alert">{interfaceMessage(error)}</p>
      ) : (
        data && (
          <>
            {!data.entries.length ? (
              <p className="empty-small">{t('inventory:no_inventory_events_recorded')}</p>
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
                        <summary>{t('inventory:recorded_movement_and_staff_identity')}</summary>
                        <p>
                          {event.action === 'dispense'
                            ? t('inventory:original_dispense_id_for_patient_returns')
                            : t('inventory:inventory_event_id')}
                          : {event.id}
                        </p>
                        {event.batchId && (
                          <p>
                            {t('inventory:batch_id')} {event.batchId}
                          </p>
                        )}
                        <p>
                          {t('inventory:product_id')} {event.productId}
                        </p>
                        <p>
                          {t('inventory:staff_id')} {event.actorId}
                        </p>
                      </details>
                      {event.prescriptionId &&
                        (index >= 0 ? (
                          <div>
                            <p>
                              <strong>
                                {t('inventory:prescription')} {index + 1}
                              </strong>
                            </p>
                            <p className="preserve">{prescriptions![index].instruction}</p>
                          </div>
                        ) : (
                          <details className="inventory-identity">
                            <summary>{t('inventory:visit_and_prescription_identity')}</summary>
                            <p>
                              {t('inventory:visit_id')} {event.visitId}
                            </p>
                            <p>
                              {t('inventory:prescription_id')} {event.prescriptionId}
                            </p>
                          </details>
                        ))}
                      <p>
                        {event.snapshot.code} · {event.snapshot.name}
                      </p>
                      {event.snapshot.lot && (
                        <p>
                          {' '}
                          {t('inventory:lot')} {event.snapshot.lot}
                          {event.snapshot.expiry && (
                            <>
                              {' '}
                              {t('inventory:recorded_expiry')} {event.snapshot.expiry}
                            </>
                          )}
                        </p>
                      )}
                      {event.snapshot.quantity !== undefined && (
                        <p>
                          {' '}
                          {t('inventory:quantity')} {event.snapshot.quantity} {event.snapshot.unit}
                          {event.snapshot.balance !== undefined && (
                            <>
                              {' '}
                              {t('inventory:batch_balance')} {event.snapshot.balance}
                            </>
                          )}
                        </p>
                      )}
                      {event.snapshot.remaining !== undefined && (
                        <p>
                          {' '}
                          {t('inventory:remaining')} {event.snapshot.remaining}{' '}
                          {event.snapshot.unit}
                        </p>
                      )}
                      {event.snapshot.cancelledQuantity !== undefined && (
                        <p>
                          {' '}
                          {t('inventory:cancelled_remainder')} {event.snapshot.cancelledQuantity}{' '}
                          {t('inventory:already_supplied')} {event.snapshot.supplied}
                        </p>
                      )}
                      {event.snapshot.reason && (
                        <p className="preserve">
                          {t('common:reason')} {event.snapshot.reason}
                        </p>
                      )}
                      {event.snapshot.reference && (
                        <p className="preserve">
                          {t('inventory:receipt_reference')} {event.snapshot.reference}
                        </p>
                      )}
                      {event.snapshot.active !== undefined && (
                        <p>
                          {t(
                            event.snapshot.active
                              ? 'inventory:product_active'
                              : 'inventory:product_inactive',
                          )}
                        </p>
                      )}
                      {event.snapshot.quarantined !== undefined && (
                        <p>
                          {event.snapshot.quarantined
                            ? t('common:quarantined')
                            : t('inventory:not_quarantined')}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <p>
              {data.total} {t('common:events_page')} {data.page} {t('common:of')}{' '}
              {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </p>
          </>
        )
      )}
      <div className="button-row">
        <button disabled={disabled || loading || page === 1} onClick={() => setPage(page - 1)}>
          {' '}
          {t('inventory:previous_inventory_history')}{' '}
        </button>
        <button
          disabled={
            disabled || loading || Boolean(error) || !data || page * data.pageSize >= data.total
          }
          onClick={() => setPage(page + 1)}
        >
          {' '}
          {t('inventory:next_inventory_history')}{' '}
        </button>
        <button disabled={disabled || loading} onClick={() => setRetry(retry + 1)}>
          {error
            ? t('inventory:retry_inventory_history')
            : t('inventory:refresh_inventory_history')}
        </button>
      </div>
    </section>
  );
}
