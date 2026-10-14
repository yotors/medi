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
  available: 'Available for supply',
  expired: 'Expired',
  expiry_today: 'Expires today — supply blocked',
  quarantined: 'Quarantined',
  inactive: 'Product inactive',
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
      setNotice('Inventory saved.');
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
          else setError('Inventory could not be loaded. Your draft is preserved.');
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
    if (mutation.pending || (draft && !window.confirm('Discard this inventory draft?'))) return;
    setDraft(null);
    setSelected(null);
    setBatches(null);
    setBatchPage(1);
    setNotice('');
    mutation.clear();
  }
  const titles: Record<Draft['type'], string> = {
    'product.create': 'Add product',
    'product.status': draft?.active ? 'Activate product' : 'Deactivate product',
    'batch.create': 'Add batch',
    'batch.status': draft?.quarantined ? 'Quarantine batch' : 'Release quarantine',
    'stock.receive': 'Receive stock',
    'stock.adjust': 'Adjust stock',
  };
  return (
    <div className="inventory-workspace">
      <div className="page-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {selected ? selected.name : 'Pharmacy inventory'}
          </h1>
          <p>
            {selected
              ? `${selected.code} · Base unit: ${selected.unit}`
              : 'Maintain hospital stock, then record supply against an authorized prescription.'}
          </p>
        </div>
        <div className="button-row">
          {selected ? (
            <button disabled={Boolean(mutation.pending)} onClick={leave}>
              Back to products
            </button>
          ) : (
            canWrite && (
              <button
                className="primary"
                disabled={blocked || Boolean(draft)}
                onClick={() => start('product.create')}
              >
                Add product
              </button>
            )
          )}
        </div>
      </div>
      {notice && (
        <p ref={savedNotice} tabIndex={-1} role="status" className="notice success">
          {notice}
        </p>
      )}
      {mutation.error && (
        <p role="alert" className="notice error">
          {mutation.error}
        </p>
      )}
      {mutation.pending && (
        <div className="notice warning" role="status">
          <span>
            {mutation.busy
              ? 'Saving inventory…'
              : 'Save not confirmed. Retry the same details to find or complete the original save.'}
          </span>
          <button disabled={mutation.busy} onClick={mutation.retry}>
            Retry inventory save
          </button>
        </div>
      )}
      {(mutation.conflict || draft?.stale) && draft && (
        <div className="notice warning">
          <span>
            Draft preserved. Review current stock and status before trying again.
            {currentBatch && (
              <>
                {' '}
                Current lot {currentBatch.lot}: {currentBatch.balance} {selected?.unit} ·{' '}
                {eligibilityLabel[currentBatch.eligibility]}.
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
            Use latest inventory version
          </button>
        </div>
      )}
      <section className="panel">
        <div className="section-heading">
          <h2>{selected ? 'Batches and stock' : 'Product catalog'}</h2>
          <button disabled={blocked} onClick={() => setRefresh((value) => value + 1)}>
            Refresh inventory
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
              <label htmlFor="inventory-search">Search product name or code</label>
              <input
                id="inventory-search"
                maxLength={100}
                value={search}
                disabled={Boolean(mutation.pending) || Boolean(draft)}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button disabled={blocked || Boolean(draft)}>Search products</button>
          </form>
        )}
        {loading ? (
          <p role="status">Loading inventory…</p>
        ) : error ? (
          <div>
            <p role="alert">{error}</p>
            <button
              disabled={Boolean(mutation.pending)}
              onClick={() => setRefresh((value) => value + 1)}
            >
              Retry loading inventory
            </button>
          </div>
        ) : selected && batches ? (
          <>
            <p className="inventory-guidance">
              Stock is counted in {selected.unit}. Supply is blocked on the expiry date and
              afterward, using Addis Ababa date {batches.today}. Quarantined and inactive stock
              remains visible.
            </p>
            <div className="button-row">
              {canWrite && (
                <>
                  <button
                    disabled={blocked || Boolean(draft) || !selected.active}
                    onClick={() => start('batch.create')}
                  >
                    Add batch
                  </button>
                  <button
                    disabled={blocked || Boolean(draft)}
                    onClick={() => start('product.status')}
                  >
                    {selected.active ? 'Deactivate product' : 'Activate product'}
                  </button>
                </>
              )}
            </div>
            {!batches.entries.length ? (
              <p className="empty-small">
                No batches yet. Add a lot and expiry date, then receive its opening stock.
              </p>
            ) : (
              <div className="table-region" role="region" aria-label="Product batches" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th>Lot / expiry</th>
                      <th>Stock</th>
                      <th>Supply status</th>
                      {canWrite && <th>Actions</th>}
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
                                Receive stock
                              </button>
                              <button
                                disabled={blocked || Boolean(draft)}
                                onClick={() => start('stock.adjust', batch)}
                              >
                                Adjust stock
                              </button>
                              <button
                                disabled={blocked || Boolean(draft)}
                                onClick={() => start('batch.status', batch)}
                              >
                                {batch.quarantined ? 'Release quarantine' : 'Quarantine batch'}
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
                {batches.total} batches · Page {batchPage}
              </p>
              <div className="button-row">
                <button
                  disabled={blocked || Boolean(draft) || batchPage === 1}
                  onClick={() => setBatchPage(batchPage - 1)}
                >
                  Previous batches
                </button>
                <button
                  disabled={blocked || Boolean(draft) || batchPage * 25 >= batches.total}
                  onClick={() => setBatchPage(batchPage + 1)}
                >
                  Next batches
                </button>
              </div>
            </div>
          </>
        ) : (
          products && (
            <>
              {!products.entries.length ? (
                <p className="empty-small">
                  No matching products. Add your first product with its fixed dispensing unit.
                </p>
              ) : (
                <div
                  className="table-region"
                  role="region"
                  aria-label="Inventory products"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Base unit</th>
                        <th>Status</th>
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
                          <td>{product.active ? 'Active' : 'Inactive'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="staff-pagination">
                <p>
                  {products.total} products · Page {page}
                </p>
                <div className="button-row">
                  <button
                    disabled={blocked || Boolean(draft) || page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous products
                  </button>
                  <button
                    disabled={blocked || Boolean(draft) || page * 25 >= products.total}
                    onClick={() => setPage(page + 1)}
                  >
                    Next products
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
          aria-label="Inventory change"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <h2>{titles[draft.type]}</h2>
          {draft.batch && (
            <p>
              Lot {draft.batch.lot} · Expiry {draft.batch.expiry} · Current stock{' '}
              {draft.batch.balance} {draft.product?.unit}
            </p>
          )}
          {draft.type === 'product.create' && (
            <>
              <label htmlFor="product-code">Product code</label>
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
              <label htmlFor="product-name">Product name, strength and form</label>
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
              <label htmlFor="product-unit">Base dispensing unit</label>
              <input
                id="product-unit"
                required
                maxLength={40}
                placeholder="For example: tablet"
                value={draft.unit}
                disabled={blocked}
                onChange={(event) =>
                  setDraft({ ...draft, unit: event.target.value, confirmed: false })
                }
              />
              <p className="muted">
                Code, name and unit cannot be edited after creation. Quantities are whole base
                units; no pack conversion.
              </p>
            </>
          )}
          {draft.type === 'batch.create' && (
            <>
              <label htmlFor="batch-lot">Lot number</label>
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
              <label htmlFor="batch-expiry">Expiry date</label>
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
                Lot and expiry are immutable. New batches start with zero stock.
              </p>
            </>
          )}
          {['stock.receive', 'stock.adjust'].includes(draft.type) && (
            <>
              <label htmlFor="stock-quantity">
                {draft.type === 'stock.adjust'
                  ? 'Stock change (negative removes units)'
                  : 'Quantity received'}{' '}
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
                  Resulting stock: {draft.batch!.balance + Number(draft.quantity || 0)}{' '}
                  {draft.product?.unit}. Adjustments record stock discrepancies; patient returns are
                  not supported.
                </p>
              )}
            </>
          )}
          {draft.type === 'stock.receive' ? (
            <>
              <label htmlFor="stock-reference">Receipt reference</label>
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
                <label htmlFor="inventory-reason">Reason for inventory change</label>
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
            />
            I checked the product, quantities and details.
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={
                blocked || mutation.conflict || draft.stale || Boolean(error) || !draft.confirmed
              }
            >
              Save inventory change
            </button>
            <button
              type="button"
              disabled={Boolean(mutation.pending)}
              onClick={() => {
                setDraft(null);
                mutation.clear();
              }}
            >
              Discard inventory draft
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
