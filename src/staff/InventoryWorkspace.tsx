import { uiMessage } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../shared/registration';
import type {
  InventoryBatch,
  InventoryBatches,
  InventoryCommand,
  InventoryPage,
  InventoryProduct,
} from '../../shared/inventory';
import { ApiError, request } from './api';
import { useInventoryMutation } from './useInventoryMutation';
import InventoryHistory from './InventoryHistory';
import './inventory.css';
export const eligibilityLabel: Record<InventoryBatch['eligibility'], string> = {
  get available() {
    return t('labels:available_for_supply');
  },
  get expired() {
    return t('labels:expired');
  },
  get expiry_today() {
    return t('labels:expires_today_supply_blocked');
  },
  get quarantined() {
    return t('labels:quarantined');
  },
  get inactive() {
    return t('labels:product_inactive');
  },
};
type Draft = {
  type: InventoryCommand['type'];
  product?: InventoryProduct;
  batch?: InventoryBatch;
  code: string;
  name: string;
  unit: string;
  lot: string;
  expiry: string;
  quantity: string;
  reason: string;
  reference: string;
  active?: boolean;
  quarantined?: boolean;
  confirmed: boolean;
  stale?: boolean;
};
export default function InventoryWorkspace({
  session,
  onDirty,
  onPending,
  onSessionError,
}: {
  session: Session;
  onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void;
  onSessionError: (error: unknown) => void;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [products, setProducts] = useState<InventoryPage<InventoryProduct> | null>(null);
  const [selected, setSelected] = useState<InventoryProduct | null>(null);
  const [batchPage, setBatchPage] = useState(1);
  const [batches, setBatches] = useState<InventoryBatches | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const savedNotice = useRef<HTMLParagraphElement>(null);
  const canWrite = ['admin', 'pharmacist'].includes(session.user.role);
  const mutation = useInventoryMutation(
    session,
    onPending,
    onSessionError,
    () => {
      setDraft(null);
      onDirty(false);
      setNotice(uiMessage('inventory:inventory_saved'));
      setRefresh((value) => value + 1);
    },
    () => setRefresh((value) => value + 1),
  );
  useEffect(() => {
    heading.current?.focus();
  }, [selected?.id]);
  useEffect(() => {
    if (notice && !draft) savedNotice.current?.focus();
  }, [notice, draft]);
  useEffect(() => {
    onDirty(Boolean(draft));
  }, [draft, onDirty]);
  useEffect(() => {
    if (draft) form.current?.querySelector<HTMLInputElement>('input,textarea')?.focus();
  }, [draft?.type, draft?.batch?.id]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const path = selected
      ? `/api/inventory/products/${selected.id}/batches?page=${batchPage}${draft?.batch ? `&selectedBatchId=${draft.batch.id}` : ''}`
      : `/api/inventory/products?page=${page}&q=${encodeURIComponent(query)}`;
    void request<InventoryBatches | InventoryPage<InventoryProduct>>(path)
      .then((data) => {
        if (!cancelled) {
          if ('product' in data) {
            setBatches(data);
            setSelected(data.product);
            setDraft((current) => {
              if (!current || mutation.pending) return current;
              const latest =
                data.selectedBatch ?? data.entries.find((entry) => entry.id === current.batch?.id);
              return (current.product && current.product.revision !== data.product.revision) ||
                (current.batch &&
                  latest &&
                  (latest.revision !== current.batch.revision ||
                    latest.balance !== current.batch.balance ||
                    latest.eligibility !== current.batch.eligibility))
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
            setError(uiMessage('inventory:inventory_could_not_be_loaded_your_draft_is_preserved'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, batchPage, page, query, refresh]);
  const blocked = Boolean(mutation.pending) || loading;
  const currentBatch =
    batches?.selectedBatch?.id === draft?.batch?.id
      ? batches?.selectedBatch
      : batches?.entries.find((entry) => entry.id === draft?.batch?.id);
  function start(type: Draft['type'], batch?: InventoryBatch) {
    if (blocked || draft) return;
    mutation.clear();
    setNotice('');
    setDraft({
      type,
      product: selected ?? undefined,
      batch,
      code: '',
      name: '',
      unit: '',
      lot: '',
      expiry: '',
      quantity: '',
      reason: '',
      reference: '',
      active: selected ? !selected.active : undefined,
      quarantined: batch ? !batch.quarantined : undefined,
      confirmed: false,
    });
  }
  function save() {
    if (!draft || blocked || mutation.conflict || draft.stale || Boolean(error) || !draft.confirmed)
      return;
    let command: InventoryCommand;
    switch (draft.type) {
      case 'product.create':
        command = {
          type: draft.type,
          code: draft.code.trim(),
          name: draft.name.trim(),
          unit: draft.unit.trim(),
        };
        break;
      case 'product.status':
        command = {
          type: draft.type,
          productId: draft.product!.id,
          expectedRevision: draft.product!.revision,
          active: draft.active!,
          reason: draft.reason.trim(),
        };
        break;
      case 'batch.create':
        command = {
          type: draft.type,
          productId: draft.product!.id,
          lot: draft.lot.trim(),
          expiry: draft.expiry,
        };
        break;
      case 'batch.status':
        command = {
          type: draft.type,
          batchId: draft.batch!.id,
          expectedRevision: draft.batch!.revision,
          quarantined: draft.quarantined!,
          reason: draft.reason.trim(),
        };
        break;
      case 'stock.receive':
        command = {
          type: draft.type,
          batchId: draft.batch!.id,
          expectedRevision: draft.batch!.revision,
          quantity: Number(draft.quantity),
          reference: draft.reference.trim(),
        };
        break;
      case 'stock.adjust':
        command = {
          type: draft.type,
          batchId: draft.batch!.id,
          expectedRevision: draft.batch!.revision,
          quantity: Number(draft.quantity),
          reason: draft.reason.trim(),
        };
        break;
    }
    mutation.save('/api/inventory/commands', command);
  }
  function leave() {
    if (mutation.pending || (draft && !window.confirm(t('inventory:discard_this_inventory_draft'))))
      return;
    setDraft(null);
    setSelected(null);
    setBatches(null);
    setBatchPage(1);
    setNotice('');
    mutation.clear();
  }
  const titles: Record<Draft['type'], string> = {
    get 'product.create'() {
      return t('labels:add_product');
    },
    'product.status': draft?.active
      ? t('inventory:activate_product')
      : t('inventory:deactivate_product'),
    get 'batch.create'() {
      return t('labels:add_batch');
    },
    'batch.status': draft?.quarantined
      ? t('inventory:quarantine_batch')
      : t('inventory:release_quarantine'),
    get 'stock.receive'() {
      return t('labels:receive_stock');
    },
    get 'stock.adjust'() {
      return t('labels:adjust_stock');
    },
  };
  return (
    <div className="inventory-workspace">
      <div className="page-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {selected ? selected.name : t('inventory:pharmacy_inventory')}
          </h1>
          <p>
            {selected
              ? t('dynamic:product_unit', { code: selected.code, unit: selected.unit })
              : t(
                  'inventory:maintain_hospital_stock_then_record_supply_against_an_authorized_prescription',
                )}
          </p>
        </div>
        <div className="button-row">
          {selected ? (
            <button disabled={Boolean(mutation.pending)} onClick={leave}>
              {' '}
              {t('inventory:back_to_products')}{' '}
            </button>
          ) : (
            canWrite && (
              <button
                className="primary"
                disabled={blocked || Boolean(draft)}
                onClick={() => start('product.create')}
              >
                {' '}
                {t('inventory:add_product')}{' '}
              </button>
            )
          )}
        </div>
      </div>
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
              ? t('inventory:saving_inventory')
              : t(
                  'inventory:save_not_confirmed_retry_the_same_details_to_find_or_complete_the_original_save',
                )}
          </span>
          <button disabled={mutation.busy} onClick={mutation.retry}>
            {' '}
            {t('inventory:retry_inventory_save')}{' '}
          </button>
        </div>
      )}
      {(mutation.conflict || draft?.stale) && draft && (
        <div className="notice warning">
          <span>
            {' '}
            {t(
              'inventory:draft_preserved_review_current_stock_and_status_before_trying_again',
            )}{' '}
            {currentBatch && (
              <>
                {' '}
                {t('inventory:current_lot')} {currentBatch.lot}: {currentBatch.balance}{' '}
                {selected?.unit} · {eligibilityLabel[currentBatch.eligibility]}.
              </>
            )}
          </span>
          <button
            disabled={blocked || Boolean(error) || Boolean(draft.batch && !currentBatch)}
            onClick={() => {
              setDraft({
                ...draft,
                product: selected ?? draft.product,
                batch: currentBatch ?? draft.batch,
                stale: false,
                confirmed: false,
              });
              mutation.clear();
            }}
          >
            {' '}
            {t('inventory:use_latest_inventory_version')}{' '}
          </button>
        </div>
      )}
      <section className="panel">
        <div className="section-heading">
          <h2>{selected ? t('inventory:batches_and_stock') : t('inventory:product_catalog')}</h2>
          <button disabled={blocked} onClick={() => setRefresh((value) => value + 1)}>
            {' '}
            {t('inventory:refresh_inventory')}{' '}
          </button>
        </div>
        {!selected && (
          <form
            className="staff-search"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setQuery(search.trim());
              setRefresh((value) => value + 1);
            }}
          >
            <div>
              <label htmlFor="inventory-search">{t('inventory:search_product_name_or_code')}</label>
              <input
                id="inventory-search"
                maxLength={100}
                value={search}
                disabled={Boolean(mutation.pending) || Boolean(draft)}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button disabled={blocked || Boolean(draft)}>{t('inventory:search_products')}</button>
          </form>
        )}
        {loading ? (
          <p role="status">{t('inventory:loading_inventory')}</p>
        ) : error ? (
          <div>
            <p role="alert">{interfaceMessage(error)}</p>
            <button
              disabled={Boolean(mutation.pending)}
              onClick={() => setRefresh((value) => value + 1)}
            >
              {' '}
              {t('inventory:retry_loading_inventory')}{' '}
            </button>
          </div>
        ) : selected && batches ? (
          <>
            <p className="inventory-guidance">
              {' '}
              {t('inventory:stock_is_counted_in')} {selected.unit}
              {t(
                'inventory:supply_is_blocked_on_the_expiry_date_and_afterward_using_addis_ababa_date',
              )}{' '}
              {batches.today}
              {t('inventory:quarantined_and_inactive_stock_remains_visible')}{' '}
            </p>
            <div className="button-row">
              {canWrite && (
                <>
                  <button
                    disabled={blocked || Boolean(draft) || !selected.active}
                    onClick={() => start('batch.create')}
                  >
                    {' '}
                    {t('inventory:add_batch')}{' '}
                  </button>
                  <button
                    disabled={blocked || Boolean(draft)}
                    onClick={() => start('product.status')}
                  >
                    {selected.active
                      ? t('inventory:deactivate_product')
                      : t('inventory:activate_product')}
                  </button>
                </>
              )}
            </div>
            {!batches.entries.length ? (
              <p className="empty-small">
                {' '}
                {t(
                  'inventory:no_batches_yet_add_a_lot_and_expiry_date_then_receive_its_opening_stock',
                )}{' '}
              </p>
            ) : (
              <div
                className="table-region"
                role="region"
                aria-label={t('inventory:product_batches')}
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>{t('inventory:lot_expiry')}</th>
                      <th>{t('inventory:stock')}</th>
                      <th>{t('inventory:supply_status')}</th>
                      {canWrite && <th>{t('common:actions')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {batches.entries.map((batch) => (
                      <tr key={batch.id}>
                        <td>
                          <strong>{batch.lot}</strong>
                          <small>{batch.expiry}</small>
                        </td>
                        <td>
                          {batch.balance} {selected.unit}
                        </td>
                        <td>{eligibilityLabel[batch.eligibility]}</td>
                        {canWrite && (
                          <td>
                            <div className="button-row">
                              <button
                                disabled={blocked || Boolean(draft)}
                                onClick={() => start('stock.receive', batch)}
                              >
                                {' '}
                                {t('inventory:receive_stock')}{' '}
                              </button>
                              <button
                                disabled={blocked || Boolean(draft)}
                                onClick={() => start('stock.adjust', batch)}
                              >
                                {' '}
                                {t('inventory:adjust_stock')}{' '}
                              </button>
                              <button
                                disabled={blocked || Boolean(draft)}
                                onClick={() => start('batch.status', batch)}
                              >
                                {batch.quarantined
                                  ? t('inventory:release_quarantine')
                                  : t('inventory:quarantine_batch')}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="staff-pagination">
              <p>
                {batches.total} {t('inventory:batches_page')} {batchPage}
              </p>
              <div className="button-row">
                <button
                  disabled={blocked || Boolean(draft) || batchPage === 1}
                  onClick={() => setBatchPage(batchPage - 1)}
                >
                  {' '}
                  {t('inventory:previous_batches')}{' '}
                </button>
                <button
                  disabled={blocked || Boolean(draft) || batchPage * 25 >= batches.total}
                  onClick={() => setBatchPage(batchPage + 1)}
                >
                  {' '}
                  {t('inventory:next_batches')}{' '}
                </button>
              </div>
            </div>
          </>
        ) : (
          products && (
            <>
              {!products.entries.length ? (
                <p className="empty-small">
                  {' '}
                  {t(
                    'inventory:no_matching_products_add_your_first_product_with_its_fixed_dispensing_unit',
                  )}{' '}
                </p>
              ) : (
                <div
                  className="table-region"
                  role="region"
                  aria-label={t('inventory:inventory_products')}
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>{t('inventory:product')}</th>
                        <th>{t('inventory:base_unit')}</th>
                        <th>{t('common:status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.entries.map((product) => (
                        <tr key={product.id}>
                          <td>
                            <button
                              className="patient-visit-link"
                              disabled={Boolean(mutation.pending) || Boolean(draft)}
                              onClick={() => {
                                setSelected(product);
                                setBatchPage(1);
                                setNotice('');
                              }}
                            >
                              {product.name}
                            </button>
                            <small>{product.code}</small>
                          </td>
                          <td>{product.unit}</td>
                          <td>{product.active ? t('common:active') : t('common:inactive')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="staff-pagination">
                <p>
                  {products.total} {t('common:products_page')} {page}
                </p>
                <div className="button-row">
                  <button
                    disabled={blocked || Boolean(draft) || page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    {' '}
                    {t('inventory:previous_products')}{' '}
                  </button>
                  <button
                    disabled={blocked || Boolean(draft) || page * 25 >= products.total}
                    onClick={() => setPage(page + 1)}
                  >
                    {' '}
                    {t('inventory:next_products')}{' '}
                  </button>
                </div>
              </div>
            </>
          )
        )}
      </section>
      {draft && (
        <form
          ref={form}
          className="panel inventory-editor"
          aria-label={t('inventory:inventory_change')}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <h2>{titles[draft.type]}</h2>
          {draft.batch && (
            <p>
              {' '}
              {t('inventory:lot')} {draft.batch.lot} {t('inventory:expiry')} {draft.batch.expiry}{' '}
              {t('inventory:current_stock')} {draft.batch.balance} {draft.product?.unit}
            </p>
          )}
          {draft.type === 'product.create' && (
            <>
              <label htmlFor="product-code">{t('inventory:product_code')}</label>
              <input
                id="product-code"
                required
                pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
                maxLength={40}
                value={draft.code}
                disabled={blocked}
                onChange={(event) =>
                  setDraft({ ...draft, code: event.target.value, confirmed: false })
                }
              />
              <label htmlFor="product-name">{t('inventory:product_name_strength_and_form')}</label>
              <input
                id="product-name"
                required
                maxLength={200}
                value={draft.name}
                disabled={blocked}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value, confirmed: false })
                }
              />
              <label htmlFor="product-unit">{t('inventory:base_dispensing_unit')}</label>
              <input
                id="product-unit"
                required
                maxLength={40}
                placeholder={t('inventory:for_example_tablet')}
                value={draft.unit}
                disabled={blocked}
                onChange={(event) =>
                  setDraft({ ...draft, unit: event.target.value, confirmed: false })
                }
              />
              <p className="muted">
                {' '}
                {t(
                  'inventory:code_name_and_unit_cannot_be_edited_after_creation_quantities_are_whole_base_units_no_pack_conv',
                )}{' '}
              </p>
            </>
          )}
          {draft.type === 'batch.create' && (
            <>
              <label htmlFor="batch-lot">{t('inventory:lot_number')}</label>
              <input
                id="batch-lot"
                required
                maxLength={100}
                value={draft.lot}
                disabled={blocked}
                onChange={(event) =>
                  setDraft({ ...draft, lot: event.target.value, confirmed: false })
                }
              />
              <label htmlFor="batch-expiry">{t('inventory:expiry_date')}</label>
              <input
                id="batch-expiry"
                type="date"
                required
                min="2000-01-01"
                max="2199-12-31"
                value={draft.expiry}
                disabled={blocked}
                onChange={(event) =>
                  setDraft({ ...draft, expiry: event.target.value, confirmed: false })
                }
              />
              <p className="muted">
                {' '}
                {t('inventory:lot_and_expiry_are_immutable_new_batches_start_with_zero_stock')}{' '}
              </p>
            </>
          )}
          {['stock.receive', 'stock.adjust'].includes(draft.type) && (
            <>
              <label htmlFor="stock-quantity">
                {draft.type === 'stock.adjust'
                  ? t('inventory:stock_change_negative_removes_units')
                  : t('inventory:quantity_received')}{' '}
                · {draft.product?.unit}
              </label>
              <input
                id="stock-quantity"
                type="number"
                required
                step="1"
                min={draft.type === 'stock.adjust' ? -1000000 : 1}
                max="1000000"
                value={draft.quantity}
                disabled={blocked}
                onChange={(event) =>
                  setDraft({ ...draft, quantity: event.target.value, confirmed: false })
                }
              />
              {draft.type === 'stock.adjust' && (
                <p>
                  {' '}
                  {t('inventory:resulting_stock')}{' '}
                  {draft.batch!.balance + Number(draft.quantity || 0)} {draft.product?.unit}
                  {t(
                    'inventory:adjustments_record_stock_discrepancies_patient_returns_are_not_supported',
                  )}{' '}
                </p>
              )}
            </>
          )}
          {draft.type === 'stock.receive' ? (
            <>
              <label htmlFor="stock-reference">{t('inventory:receipt_reference_2')}</label>
              <input
                id="stock-reference"
                required
                maxLength={200}
                value={draft.reference}
                disabled={blocked}
                onChange={(event) =>
                  setDraft({ ...draft, reference: event.target.value, confirmed: false })
                }
              />
            </>
          ) : (
            ['stock.adjust', 'batch.status', 'product.status'].includes(draft.type) && (
              <>
                <label htmlFor="inventory-reason">
                  {t('inventory:reason_for_inventory_change')}
                </label>
                <textarea
                  id="inventory-reason"
                  required
                  maxLength={500}
                  value={draft.reason}
                  disabled={blocked}
                  onChange={(event) =>
                    setDraft({ ...draft, reason: event.target.value, confirmed: false })
                  }
                />
              </>
            )
          )}
          <label className="checkbox inventory-confirm">
            <input
              type="checkbox"
              required
              checked={draft.confirmed}
              disabled={blocked}
              onChange={(event) => setDraft({ ...draft, confirmed: event.target.checked })}
            />{' '}
            {t('inventory:i_checked_the_product_quantities_and_details')}{' '}
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={
                blocked || mutation.conflict || draft.stale || Boolean(error) || !draft.confirmed
              }
            >
              {' '}
              {t('inventory:save_inventory_change')}{' '}
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
              {t('inventory:discard_inventory_draft')}{' '}
            </button>
          </div>
        </form>
      )}
      {selected && (
        <div className="panel inventory-editor">
          <InventoryHistory
            path={`/api/inventory/history?productId=${selected.id}`}
            refresh={refresh}
            disabled={Boolean(mutation.pending)}
            onSessionError={onSessionError}
          />
        </div>
      )}
    </div>
  );
}
