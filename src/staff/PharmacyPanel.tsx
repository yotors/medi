import { uiMessage } from '../i18n';
import { presentationLabel } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
import { hospitalDate } from './date';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../shared/registration';
import type { VisitCommand, VisitView } from '../../shared/outpatient';
import type {
  InventoryBatch,
  InventoryBatches,
  InventoryPage,
  InventoryProduct,
  PharmacyCommand,
} from '../../shared/inventory';
import { ApiError, request } from './api';
import { useInventoryMutation } from './useInventoryMutation';
import InventoryHistory from './InventoryHistory';
import { eligibilityLabel } from './InventoryWorkspace';
import './inventory.css';
type Draft = {
  type: PharmacyCommand['type'];
  prescriptionId: string;
  expectedVisitRevision: number;
  product?: InventoryProduct;
  batch?: InventoryBatch;
  quantity: string;
  reason: string;
  confirmed: boolean;
  stale?: boolean;
};
export default function PharmacyPanel({
  visit,
  session,
  disabled,
  onDirty,
  onPending,
  onSaved,
  onSessionError,
  onCommand,
}: {
  visit: VisitView;
  session: Session;
  disabled: boolean;
  onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void;
  onSaved: () => void;
  onSessionError: (error: unknown) => void;
  onCommand: (command: VisitCommand) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [products, setProducts] = useState<InventoryPage<InventoryProduct> | null>(null);
  const [batches, setBatches] = useState<InventoryBatches | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const savedNotice = useRef<HTMLParagraphElement>(null);
  const canAuthorize = ['admin', 'clinician'].includes(session.user.role);
  const canSupply = ['admin', 'pharmacist'].includes(session.user.role);
  const mutation = useInventoryMutation(
    session,
    onPending,
    onSessionError,
    () => {
      setDraft(null);
      onDirty(false);
      setNotice(uiMessage('inventory:pharmacy_change_saved'));
      onSaved();
    },
    () => {
      setRefresh((value) => value + 1);
      onSaved();
    },
  );
  useEffect(() => {
    if (notice && !draft) savedNotice.current?.focus();
  }, [notice, draft]);
  useEffect(() => {
    onDirty(Boolean(draft));
  }, [draft, onDirty]);
  useEffect(() => {
    if (draft) form.current?.querySelector<HTMLInputElement>('input,textarea')?.focus();
  }, [draft?.type, draft?.prescriptionId]);
  useEffect(() => {
    if (!draft || draft.type === 'cancel') {
      setLoading(false);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    const path =
      draft.type === 'authorize'
        ? `/api/inventory/products?active=active&q=${encodeURIComponent(query)}&page=${page}`
        : `/api/inventory/products/${draft.product!.id}/batches?page=${page}${draft.batch ? `&selectedBatchId=${draft.batch.id}` : ''}`;
    void request<InventoryPage<InventoryProduct> | InventoryBatches>(path)
      .then((data) => {
        if (!cancelled) {
          if ('product' in data) {
            setBatches(data);
            setDraft((current) => {
              if (!current?.batch || mutation.pending) return current;
              const latest =
                data.selectedBatch ?? data.entries.find((entry) => entry.id === current.batch!.id);
              return latest &&
                (latest.revision !== current.batch.revision ||
                  latest.balance !== current.batch.balance ||
                  latest.eligibility !== current.batch.eligibility)
                ? { ...current, stale: true, confirmed: false }
                : current;
            });
          } else setProducts(data);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          if (error instanceof ApiError && error.status === 401) onSessionError(error);
          else
            setError(uiMessage('inventory:pharmacy_choices_could_not_be_loaded_retry_to_continue'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    draft?.type,
    draft?.prescriptionId,
    draft?.type === 'dispense' ? draft.product?.id : null,
    page,
    query,
    refresh,
  ]);
  function start(type: Draft['type'], prescriptionId: string) {
    if (disabled || draft || mutation.pending) return;
    const authorization = visit.pharmacy?.find((entry) => entry.prescriptionId === prescriptionId);
    setDraft({
      type,
      prescriptionId,
      expectedVisitRevision: visit.revision,
      product: type === 'authorize' ? undefined : authorization?.product,
      quantity: '',
      reason: '',
      confirmed: false,
    });
    setPage(1);
    setProducts(null);
    setBatches(null);
    setQuery('');
    setSearch('');
    setError('');
    setNotice('');
    mutation.clear();
  }
  const authorization = visit.pharmacy?.find(
    (entry) => entry.prescriptionId === draft?.prescriptionId,
  );
  const currentBatch =
    batches?.selectedBatch?.id === draft?.batch?.id
      ? batches?.selectedBatch
      : batches?.entries.find((entry) => entry.id === draft?.batch?.id);
  const targetIndex =
    visit.prescriptions?.findIndex((entry) => entry.id === draft?.prescriptionId) ?? -1;
  const blocked = disabled || Boolean(mutation.pending);
  const choices = draft?.type === 'authorize' ? products : batches;
  function save() {
    if (
      !draft ||
      blocked ||
      mutation.conflict ||
      draft.stale ||
      !draft.confirmed ||
      loading ||
      error
    )
      return;
    const base = {
      prescriptionId: draft.prescriptionId,
      expectedVisitRevision: draft.expectedVisitRevision,
    };
    let command: PharmacyCommand;
    if (draft.type === 'authorize') {
      if (!draft.product) return;
      command = {
        ...base,
        type: 'authorize',
        productId: draft.product.id,
        quantity: Number(draft.quantity),
      };
    } else if (draft.type === 'dispense') {
      if (!draft.batch) return;
      command = {
        ...base,
        type: 'dispense',
        batchId: draft.batch.id,
        expectedBatchRevision: draft.batch.revision,
        quantity: Number(draft.quantity),
      };
    } else command = { ...base, type: 'cancel', reason: draft.reason.trim() };
    mutation.save(`/api/visits/${visit.id}/inventory/commands`, command);
  }
  return (
    <div className="pharmacy-workspace">
      {notice && (
        <p ref={savedNotice} tabIndex={-1} role="status" className="notice success">
          {interfaceMessage(notice)}
        </p>
      )}
      {mutation.error && (
        <p role="alert" className="notice error">
          {interfaceMessage(mutation.error)}
        </p>
      )}
      {mutation.pending && (
        <div className="notice warning" role="status">
          <span>
            {mutation.busy
              ? t('inventory:saving_pharmacy_change')
              : t('inventory:supply_save_not_confirmed_retry_the_same_details_before_continuing')}
          </span>
          <button disabled={mutation.busy} onClick={mutation.retry}>
            {' '}
            {t('inventory:retry_pharmacy_save')}{' '}
          </button>
        </div>
      )}
      {(mutation.conflict || draft?.stale) && draft && (
        <div className="notice warning">
          <span>
            {' '}
            {t(
              'inventory:draft_preserved_review_the_latest_visit_remaining_quantity_and_stock',
            )}{' '}
            {currentBatch && (
              <>
                {' '}
                {t('inventory:current_lot')} {currentBatch.lot}: {currentBatch.balance}{' '}
                {draft.product?.unit} · {eligibilityLabel[currentBatch.eligibility]}.
              </>
            )}
          </span>
          <button
            disabled={
              blocked ||
              loading ||
              Boolean(error) ||
              (draft.type === 'dispense' &&
                (!currentBatch ||
                  currentBatch.eligibility !== 'available' ||
                  currentBatch.balance === 0))
            }
            onClick={() => {
              setDraft({
                ...draft,
                expectedVisitRevision: visit.revision,
                batch: currentBatch ?? draft.batch,
                stale: false,
                confirmed: false,
              });
              mutation.clear();
            }}
          >
            {' '}
            {t('inventory:use_latest_pharmacy_version')}{' '}
          </button>
        </div>
      )}
      {!visit.prescriptions?.length && (
        <p className="empty-small">{t('inventory:no_prescriptions_added')}</p>
      )}
      {visit.prescriptions?.map((prescription, index) => {
        const allocation = visit.pharmacy?.find(
          (entry) => entry.prescriptionId === prescription.id,
        );
        const active = visit.status === 'active' && prescription.status === 'pending';
        return (
          <article
            className="pharmacy-prescription"
            key={prescription.id}
            aria-label={t('dynamic:prescription_number', { number: index + 1 })}
          >
            <div className="section-heading">
              <h3>
                {t('inventory:prescription')} {index + 1}
              </h3>
              <span className="badge neutral">{presentationLabel(prescription.status)}</span>
            </div>
            <p className="preserve">{prescription.instruction}</p>
            {allocation ? (
              <>
                <p>
                  <strong>{allocation.product.name}</strong> · {allocation.product.code} ·{' '}
                  {allocation.product.unit}
                </p>
                <dl className="pharmacy-quantity">
                  <div>
                    <dt>{t('inventory:authorized')}</dt>
                    <dd>{allocation.quantity}</dd>
                  </div>
                  <div>
                    <dt>{t('common:supplied')}</dt>
                    <dd>{allocation.supplied}</dd>
                  </div>
                  <div>
                    <dt>{t('inventory:remaining_2')}</dt>
                    <dd>{allocation.remaining}</dd>
                  </div>
                </dl>
                <small>
                  {' '}
                  {t('inventory:authorized_by')} {allocation.actorName} ·{' '}
                  {hospitalDate(allocation.at)}
                </small>
                <details className="inventory-identity">
                  <summary>{t('inventory:authorizing_staff_identity')}</summary>
                  <p>
                    {t('inventory:staff_id')} {allocation.actorId}
                  </p>
                </details>
                {allocation.cancelled && (
                  <p className="notice warning">
                    {' '}
                    {t('inventory:remaining_2')} {allocation.quantity - allocation.supplied}{' '}
                    {allocation.product.unit}{' '}
                    {t('inventory:cancelled_already_supplied_stock_was_not_returned')}{' '}
                  </p>
                )}
                {canSupply && active && (
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={blocked || Boolean(draft)}
                      onClick={() => start('dispense', prescription.id)}
                    >
                      {' '}
                      {t('inventory:record_supply_for_prescription')} {index + 1}
                    </button>
                    <button
                      disabled={blocked || Boolean(draft)}
                      onClick={() => start('cancel', prescription.id)}
                    >
                      {' '}
                      {t('inventory:cancel_remaining_prescription')} {index + 1}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="muted">
                  {' '}
                  {t('inventory:unlinked_handoff_completion_here_does_not_account_for_stock')}{' '}
                </p>
                <div className="button-row">
                  {canAuthorize && active && (
                    <button
                      className="primary"
                      disabled={blocked || Boolean(draft)}
                      onClick={() => start('authorize', prescription.id)}
                    >
                      {' '}
                      {t('inventory:authorize_product_for_prescription')} {index + 1}
                    </button>
                  )}
                  {canSupply && active && (
                    <>
                      <button
                        disabled={blocked || Boolean(draft)}
                        onClick={() =>
                          onCommand({
                            type: 'fulfill',
                            prescriptionId: prescription.id,
                            next: 'fulfilled',
                          })
                        }
                      >
                        {' '}
                        {t('inventory:complete_unlinked_handoff')} {index + 1}
                      </button>
                      <button
                        disabled={blocked || Boolean(draft)}
                        onClick={() =>
                          onCommand({
                            type: 'fulfill',
                            prescriptionId: prescription.id,
                            next: 'cancelled',
                          })
                        }
                      >
                        {' '}
                        {t('inventory:cancel_unlinked_prescription')} {index + 1}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </article>
        );
      })}
      {draft && (
        <form
          ref={form}
          className="pharmacy-editor"
          aria-label={t('inventory:pharmacy_change')}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <h3>
            {draft.type === 'authorize'
              ? t('inventory:authorize_product_and_quantity')
              : draft.type === 'dispense'
                ? t('inventory:record_actual_supply')
                : t('inventory:cancel_remaining_supply')}
          </h3>
          <p>
            <strong>
              {t('inventory:prescription')} {targetIndex + 1}
            </strong>
          </p>
          <p className="preserve">{visit.prescriptions?.[targetIndex]?.instruction}</p>
          {draft.type === 'authorize' && (
            <>
              <p>
                {' '}
                {t(
                  'inventory:select_the_prescribed_product_and_whole_base_unit_quantity_instructions_remain_unchanged_no_dos',
                )}{' '}
              </p>
              <label htmlFor="pharmacy-search">{t('inventory:search_active_products')}</label>
              <input
                id="pharmacy-search"
                value={search}
                maxLength={100}
                disabled={blocked}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button
                type="button"
                disabled={blocked || loading}
                onClick={() => {
                  setPage(1);
                  setQuery(search.trim());
                  setRefresh((value) => value + 1);
                }}
              >
                {' '}
                {t('inventory:find_products')}{' '}
              </button>
            </>
          )}
          {draft.type !== 'authorize' && (
            <p>
              {draft.product?.name} {t('inventory:authorized_2')} {authorization?.quantity}{' '}
              {draft.product?.unit} {t('inventory:supplied_2')} {authorization?.supplied}{' '}
              {t('inventory:remaining_3')} {authorization?.remaining}
            </p>
          )}
          {draft.type !== 'cancel' && (
            <>
              {loading ? (
                <p role="status">{t('inventory:loading_pharmacy_choices')}</p>
              ) : error ? (
                <div>
                  <p role="alert">{interfaceMessage(error)}</p>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => setRefresh((value) => value + 1)}
                  >
                    {' '}
                    {t('inventory:retry_pharmacy_choices')}{' '}
                  </button>
                </div>
              ) : (
                <>
                  {draft.type === 'authorize' ? (
                    <ul className="pharmacy-choices">
                      {products?.entries.map((product) => (
                        <li key={product.id}>
                          <strong>{product.name}</strong>
                          <p>
                            {product.code} · {product.unit}
                          </p>
                          <button
                            type="button"
                            aria-pressed={draft.product?.id === product.id}
                            disabled={blocked}
                            onClick={() => setDraft({ ...draft, product, confirmed: false })}
                          >
                            {' '}
                            {t('common:choose')} {product.code}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <>
                      <p className="muted">
                        {' '}
                        {t('inventory:supply_uses_addis_ababa_date')} {batches?.today}
                        {t('inventory:expiry_day_stock_is_blocked')}{' '}
                      </p>
                      <ul className="pharmacy-choices">
                        {batches?.entries.map((batch) => (
                          <li key={batch.id}>
                            <strong>
                              {t('inventory:lot')} {batch.lot}
                            </strong>
                            <p>
                              {batch.balance} {draft.product?.unit} {t('inventory:expiry')}{' '}
                              {batch.expiry} · {eligibilityLabel[batch.eligibility]}
                            </p>
                            <button
                              type="button"
                              aria-pressed={draft.batch?.id === batch.id}
                              disabled={
                                blocked || batch.eligibility !== 'available' || batch.balance === 0
                              }
                              onClick={() =>
                                setDraft({ ...draft, batch, stale: false, confirmed: false })
                              }
                            >
                              {' '}
                              {t('inventory:choose_lot')} {batch.lot}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {choices?.total === 0 && (
                    <p className="empty-small">
                      {draft.type === 'authorize'
                        ? t(
                            'inventory:no_active_products_match_pharmacy_staff_can_create_and_activate_the_catalog',
                          )
                        : t(
                            'inventory:no_batches_exist_for_this_product_pharmacy_staff_must_add_and_receive_stock_first',
                          )}
                    </p>
                  )}
                  <div className="button-row">
                    <button
                      type="button"
                      disabled={blocked || page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      {' '}
                      {t('inventory:previous_pharmacy_choices')}{' '}
                    </button>
                    <button
                      type="button"
                      disabled={blocked || !choices || page * 25 >= choices.total}
                      onClick={() => setPage(page + 1)}
                    >
                      {' '}
                      {t('inventory:next_pharmacy_choices')}{' '}
                    </button>
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => setRefresh((value) => value + 1)}
                    >
                      {' '}
                      {t('inventory:refresh_pharmacy_choices')}{' '}
                    </button>
                  </div>
                </>
              )}
              {draft.product && (
                <p>
                  {' '}
                  {t('inventory:selected_product')} <strong>{draft.product.name}</strong>{' '}
                  {t('inventory:base_unit_2')} {draft.product.unit}
                </p>
              )}
              {draft.batch && (
                <p>
                  {' '}
                  {t('inventory:selected_lot')} <strong>{draft.batch.lot}</strong>{' '}
                  {t('inventory:expiry')} {draft.batch.expiry} {t('inventory:stock_2')}{' '}
                  {draft.batch.balance} {draft.product?.unit}
                </p>
              )}
              <label htmlFor="pharmacy-quantity">
                {draft.type === 'authorize'
                  ? t('inventory:authorized_quantity')
                  : t('inventory:quantity_supplied')}{' '}
                · {draft.product?.unit ?? t('inventory:base_units')}
              </label>
              <input
                id="pharmacy-quantity"
                required
                type="number"
                min="1"
                max={
                  draft.type === 'dispense'
                    ? Math.min(authorization?.remaining ?? 0, draft.batch?.balance ?? 0)
                    : 1000000
                }
                step="1"
                value={draft.quantity}
                disabled={blocked}
                onChange={(event) =>
                  setDraft({ ...draft, quantity: event.target.value, confirmed: false })
                }
              />
            </>
          )}
          {draft.type === 'cancel' && (
            <>
              <p>
                {' '}
                {t(
                  'inventory:only_the_remaining_quantity_will_be_cancelled_already_supplied_stock_stays_deducted_patient_ret',
                )}{' '}
              </p>
              <label htmlFor="pharmacy-cancel-reason">
                {t('inventory:reason_for_cancelling_remainder')}
              </label>
              <textarea
                id="pharmacy-cancel-reason"
                required
                maxLength={500}
                value={draft.reason}
                disabled={blocked}
                onChange={(event) =>
                  setDraft({ ...draft, reason: event.target.value, confirmed: false })
                }
              />
            </>
          )}
          <label className="checkbox inventory-confirm">
            <input
              type="checkbox"
              required
              checked={draft.confirmed}
              disabled={blocked}
              onChange={(event) => setDraft({ ...draft, confirmed: event.target.checked })}
            />{' '}
            {t('inventory:i_checked_this_prescription_product_and_quantity')}{' '}
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={
                blocked ||
                loading ||
                Boolean(error) ||
                mutation.conflict ||
                draft.stale ||
                !draft.confirmed ||
                (draft.type === 'authorize' && !draft.product) ||
                (draft.type === 'dispense' && !draft.batch)
              }
            >
              {' '}
              {t('inventory:save_pharmacy_change')}{' '}
            </button>
            <button
              type="button"
              disabled={Boolean(mutation.pending)}
              onClick={() => {
                setDraft(null);
                mutation.clear();
              }}
            >
              {' '}
              {t('inventory:discard_pharmacy_draft')}{' '}
            </button>
          </div>
        </form>
      )}
      {Boolean(visit.pharmacy?.length) && (
        <InventoryHistory
          path={`/api/visits/${visit.id}/inventory/history`}
          refresh={visit.revision}
          prescriptions={visit.prescriptions}
          disabled={blocked}
          onSessionError={onSessionError}
        />
      )}
    </div>
  );
}
