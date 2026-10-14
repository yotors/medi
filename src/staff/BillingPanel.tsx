import { useEffect, useRef, useState } from 'react';
import type { Session } from '../../shared/registration';
import { billingCommandSchema, type BillingCommand, type BillingDetail, type BillingPage, type BillingResult } from '../../shared/billing';
import { MAX_PRICE_MINOR, formatETB, parseETB, type ConfigurationList, type ConfigurationResult, type Service } from '../../shared/configuration';
import { ApiError, request } from './api';
import './billing.css';

type DraftLine = { service: Service; quantity: number };
type Pending = { key: string; command: BillingCommand; uncertain: boolean };
const money = (value: number) => `${formatETB(value)} ETB`;
const when = (value: string) => new Date(value).toLocaleString();
const failure = (error: unknown) => error instanceof Error ? error.message : 'Billing could not be loaded. Please retry.';

export default function BillingPanel({ visitId, session, disabled, externalRefresh, onDirty, onPending, onSaved, onSessionError }: {
  visitId: string; session: Session; disabled: boolean; externalRefresh: number; onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void; onSaved: () => void; onSessionError: (error: unknown) => void;
}) {
  const [page, setPage] = useState(1); const [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<BillingPage | null>(null); const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null); const [detail, setDetail] = useState<BillingDetail | null>(null);
  const [historyPage, setHistoryPage] = useState(1); const [detailLoading, setDetailLoading] = useState(false);
  const [readError, setReadError] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [preparing, setPreparing] = useState(false); const [lines, setLines] = useState<DraftLine[]>([]);
  const [query, setQuery] = useState(''); const [catalogPage, setCatalogPage] = useState(1);
  const [catalog, setCatalog] = useState<ConfigurationList | null>(null); const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(''); const [pricesStale, setPricesStale] = useState(false);
  const [amount, setAmount] = useState(''); const [method, setMethod] = useState<'cash' | 'manual_transfer'>('cash');
  const [reference, setReference] = useState(''); const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false); const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [voidConfirmed, setVoidConfirmed] = useState(false); const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false); const [pricesLoading, setPricesLoading] = useState(false);
  const mounted = useRef(false); const inflight = useRef(false); const title = useRef<HTMLHeadingElement>(null);
  const dirty = Boolean(lines.length || amount || reference || reason);
  const locked = disabled || Boolean(pending) || busy || pricesLoading;
  const readsBlocked = loading || detailLoading || Boolean(readError);
  const total = lines.reduce((sum, line) => sum + line.service.priceMinor * line.quantity, 0);
  const validTotal = total <= MAX_PRICE_MINOR;
  const invoice = detail?.invoice;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { onPending(Boolean(pending)); }, [pending, onPending]);
  useEffect(() => { setPaymentConfirmed(false); setVoidConfirmed(false); }, [invoice?.revision]);
  useEffect(() => { if (preparing || selected) title.current?.focus(); }, [preparing, selected]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setReadError('');
    void request<BillingPage>(`/api/visits/${visitId}/billing?page=${page}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(value => {
      if (controller.signal.aborted) return;
      if (!value.invoices.length && page > 1) { setPage(Math.max(1, Math.ceil(value.total / value.pageSize))); return; }
      setList(value);
    }).catch(e => { if (!controller.signal.aborted) { if (e instanceof ApiError && e.status === 401) onSessionError(e); else setReadError(failure(e)); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [visitId, page, refresh, externalRefresh]);
  useEffect(() => {
    if (!selected) { setDetail(null); setDetailLoading(false); return; }
    const controller = new AbortController(); setDetailLoading(true);
    void request<BillingDetail>(`/api/billing/invoices/${selected}?page=${historyPage}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(value => {
      if (!controller.signal.aborted && value.invoice.id === selected) setDetail(value);
    }).catch(e => { if (!controller.signal.aborted) { if (e instanceof ApiError && e.status === 401) onSessionError(e); else setReadError(failure(e)); } }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selected, historyPage, refresh, externalRefresh]);
  useEffect(() => {
    if (!preparing) return;
    const controller = new AbortController(); setCatalogLoading(true); setCatalogError('');
    const timer = window.setTimeout(() => {
      void request<ConfigurationList>(`/api/configuration/services?active=true&q=${encodeURIComponent(query.trim())}&page=${catalogPage}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(value => { if (!controller.signal.aborted) setCatalog(value); })
        .catch(e => { if (!controller.signal.aborted) { if (e instanceof ApiError && e.status === 401) onSessionError(e); else setCatalogError(failure(e)); } })
        .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [preparing, query, catalogPage, refresh]);

  function clearDrafts() { setLines([]); setAmount(''); setMethod('cash'); setReference(''); setReason(''); setConfirmed(false); setPaymentConfirmed(false); setVoidConfirmed(false); setPricesStale(false); }
  function changeView(id: string | null, prepare = false) {
    if (locked || (dirty && !window.confirm('Discard these unsaved billing drafts?'))) return;
    clearDrafts(); setDetail(null); setSelected(id); setHistoryPage(1); setPreparing(prepare); setNotice(''); setError(''); setReadError(''); setRefresh(n => n + 1);
  }
  async function refreshPrices() {
    if (locked || !lines.length) return;
    setPricesLoading(true); setError('');
    try {
      const results = await Promise.allSettled(lines.map(async line => {
        try {
          const value = await request<ConfigurationResult>(`/api/configuration/services/${line.service.id}`);
          return { ...line, service: value.entry as Service };
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return { ...line, service: { ...line.service, active: false } };
          throw e;
        }
      }));
      if (!mounted.current) return;
      const failed = results.find(result => result.status === 'rejected');
      const endedSession = results.find(result => result.status === 'rejected' && result.reason instanceof ApiError && result.reason.status === 401);
      if (endedSession?.status === 'rejected') { onSessionError(endedSession.reason); return; }
      setLines(results.map((result, index) => result.status === 'fulfilled' ? result.value : lines[index]));
      setConfirmed(false); setPricesStale(Boolean(failed));
      if (failed) setError('Some prices could not be refreshed. Successful updates are retained; retry before issuing.');
      else setNotice('Current catalog prices loaded. Review every line and the total again. Remove any unavailable service.');
    } catch (e) { if (mounted.current) { if (e instanceof ApiError && e.status === 401) onSessionError(e); else setError(failure(e)); } }
    finally { if (mounted.current) setPricesLoading(false); }
  }
  async function submit(submission: Pending) {
    if (inflight.current || disabled || pricesLoading) return;
    inflight.current = true; setBusy(true); setPending(submission); onPending(true); setError(''); setNotice('');
    try {
      const result = await request<BillingResult>(`/api/visits/${visitId}/billing/commands`, { method: 'POST', headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': submission.key }, body: JSON.stringify(submission.command) });
      if (!mounted.current) return;
      // Acknowledgement is final even if the separate refresh fails. Never resubmit an acknowledged payment.
      setPending(null); onPending(false);
      if (submission.command.type === 'invoice.issue') { setLines([]); setConfirmed(false); setPricesStale(false); }
      if (submission.command.type === 'payment.record') { setAmount(''); setReference(''); setMethod('cash'); setPaymentConfirmed(false); }
      if (submission.command.type === 'invoice.void') { setReason(''); setVoidConfirmed(false); }
      setPreparing(false); setSelected(result.invoiceId); setHistoryPage(1); setDetail(null);
      setNotice(result.receiptNumber ? `Payment recorded. Receipt ${result.receiptNumber}.` : submission.command.type === 'invoice.void' ? 'Invoice voided. Its original lines and history are retained.' : 'Invoice issued.');
      setRefresh(n => n + 1); onSaved();
    } catch (e) {
      if (!mounted.current) return;
      const uncertain = !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || (submission.uncertain && e.status === 429);
      if (uncertain) setPending({ ...submission, uncertain: true });
      else { setPending(null); onPending(false); }
      if (e instanceof ApiError && e.status === 401) onSessionError(e);
      else {
        setError(failure(e));
        if (!uncertain && e instanceof ApiError && e.status === 409) {
          setConfirmed(false); setPaymentConfirmed(false); setVoidConfirmed(false);
          if (submission.command.type === 'invoice.issue') setPricesStale(true);
          setRefresh(n => n + 1);
        }
      }
    } finally { inflight.current = false; if (mounted.current) setBusy(false); }
  }
  function send(command: BillingCommand) {
    if (locked || readsBlocked) return;
    const parsed = billingCommandSchema.safeParse(command);
    if (!parsed.success) { setError('Check the amounts, quantities and required reference or reason before saving.'); return; }
    void submit({ key: crypto.randomUUID(), command: parsed.data, uncertain: false });
  }
  const amountMinor = parseETB(amount.trim());
  return <section className="billing-workspace" aria-label="Visit billing">
    <div className="section-heading"><div><h2 ref={title} tabIndex={-1}>{preparing ? 'Prepare invoice' : invoice ? `Invoice ${invoice.number}` : 'Invoices and payments'}</h2><p>ETB · Billing is separate from clinical completion.</p></div><div className="button-row">
      {(selected || preparing) && <button disabled={locked} onClick={() => changeView(null)}>All invoices</button>}
      {!preparing && list?.permissions.issue && <button disabled={locked} onClick={() => changeView(null, true)}>Prepare invoice</button>}
      <button disabled={locked || loading || detailLoading} onClick={() => setRefresh(n => n + 1)}>Refresh billing</button>
    </div></div>
    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {pending && <div className="notice warning" role="status"><span>{busy ? 'Saving billing record…' : 'This save is not yet confirmed. Retry the same request to find or finish the original record.'}</span><button disabled={busy || disabled} onClick={() => void submit(pending)}>{busy ? 'Saving…' : 'Retry billing save'}</button></div>}
    {readError && <div className="notice error" role="alert"><span>{readError} Saved records have not changed.</span><button disabled={locked || loading || detailLoading} onClick={() => setRefresh(n => n + 1)}>Retry loading billing</button></div>}
    {loading && <p role="status" className="empty-small">Loading billing…</p>}
    {list && <dl className="billing-summary"><div><dt>Financial status</dt><dd>{list.summary.state === 'unbilled' ? 'Not yet billed' : list.summary.state === 'settled' ? 'Settled' : 'Payment outstanding'}</dd></div><div><dt>Invoiced</dt><dd>{money(list.summary.totalMinor)}</dd></div><div><dt>Paid</dt><dd>{money(list.summary.paidMinor)}</dd></div><div><dt>Balance</dt><dd>{money(list.summary.balanceMinor)}</dd></div></dl>}
    {dirty && <div className="notice warning"><span>Unsaved billing draft.</span><button disabled={locked} onClick={clearDrafts}>Discard billing draft</button></div>}
    {preparing && <>
      <div className="billing-catalog"><label htmlFor="billing-service-search">Find a service by name or code</label><input id="billing-service-search" type="search" maxLength={120} value={query} disabled={locked} onChange={e => { setQuery(e.target.value); setCatalogPage(1); }} />
        {catalogLoading ? <p role="status">Loading services…</p> : catalogError ? <div role="alert"><p>{catalogError}</p><button disabled={locked} onClick={() => setRefresh(n => n + 1)}>Retry loading services</button></div> : catalog && <>
          {catalog.entries.length ? <ul className="billing-services">{(catalog.entries as Service[]).map(service => <li key={service.id}><div><strong>{service.name}</strong><small>{service.code} · {service.departmentName}</small></div><span>{money(service.priceMinor)}</span><button disabled={locked || lines.length >= 20 || lines.some(line => line.service.id === service.id)} aria-label={`Add ${service.name} to invoice`} onClick={() => { setLines(previous => [...previous, { service, quantity: 1 }]); setConfirmed(false); }}>Add</button></li>)}</ul> : <p className="empty-small">No active services match. An administrator can configure services and prices in Hospital settings.</p>}
          <div className="staff-pagination"><p>Services · Page {catalog.page} of {Math.max(1, Math.ceil(catalog.total / catalog.pageSize))}</p><div className="button-row"><button disabled={locked || catalogPage === 1} onClick={() => setCatalogPage(n => n - 1)}>Previous services</button><button disabled={locked || catalog.page * catalog.pageSize >= catalog.total} onClick={() => setCatalogPage(n => n + 1)}>Next services</button></div></div>
        </>}
      </div>
      <form onSubmit={e => { e.preventDefault(); if (confirmed && validTotal && !pricesStale) send({ type: 'invoice.issue', lines: lines.map(line => ({ serviceId: line.service.id, serviceRevision: line.service.revision, quantity: line.quantity })) }); }}>
        <h3>Invoice lines</h3><p>Review the selected service versions, quantities and total before issuing. Issued lines cannot be edited.</p>
        {!lines.length && <p className="empty-small">Add the services provided during this visit. No charges are added automatically.</p>}
        <ul className="billing-draft-lines">{lines.map(line => <li key={line.service.id}><div><strong>{line.service.name}</strong><small>{line.service.code} · Version {line.service.revision} · {money(line.service.priceMinor)} each</small>{(!line.service.active || !line.service.departmentActive) && <p className="billing-invalid">Unavailable. Remove this service before issuing.</p>}</div><div><label htmlFor={`qty-${line.service.id}`}>Quantity for {line.service.name}</label><input id={`qty-${line.service.id}`} type="number" min="1" max="100" step="1" required disabled={locked} value={line.quantity || ''} onChange={e => { const quantity = Number(e.target.value); setLines(previous => previous.map(item => item.service.id === line.service.id ? { ...item, quantity } : item)); setConfirmed(false); }} /></div><span>{line.service.priceMinor * line.quantity >= 0 && line.service.priceMinor * line.quantity <= MAX_PRICE_MINOR && Number.isSafeInteger(line.service.priceMinor * line.quantity) ? money(line.service.priceMinor * line.quantity) : 'Check quantity'}</span><button type="button" disabled={locked} aria-label={`Remove ${line.service.name}`} onClick={() => { setLines(previous => previous.filter(item => item.service.id !== line.service.id)); setConfirmed(false); }}>Remove</button></li>)}</ul>
        {lines.length > 0 && <><div className="invoice-total"><strong>Invoice total</strong><strong>{validTotal && Number.isSafeInteger(total) && total >= 0 ? money(total) : 'Total exceeds the permitted amount'}</strong></div>
          <div className="button-row"><button type="button" disabled={locked} onClick={() => void refreshPrices()}>{pricesLoading ? 'Loading prices…' : 'Refresh selected prices'}</button></div>
          {pricesStale && <p className="notice warning">The catalog or visit changed. Refresh selected prices and review the invoice again.</p>}
          <label className="billing-confirm"><input type="checkbox" checked={confirmed} disabled={locked || pricesStale} onChange={e => setConfirmed(e.target.checked)} />I reviewed these invoice lines and the total.</label>
          <button className="primary" disabled={locked || readsBlocked || !confirmed || !validTotal || pricesStale || lines.some(line => !line.service.active || !line.service.departmentActive || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100)}>Issue invoice</button></>}
      </form>
    </>}
    {!preparing && !selected && list && !loading && <>
      {list.invoices.length ? <div role="region" aria-label="Invoices" tabIndex={0} className="table-region"><table><thead><tr><th>Invoice</th><th>Status</th><th>Total</th><th>Paid</th><th>Balance</th></tr></thead><tbody>{list.invoices.map(item => <tr key={item.id}><td><button disabled={locked} className="patient-visit-link" onClick={() => changeView(item.id)}>{item.number}</button><small>{when(item.issuedAt)}</small></td><td>{item.status === 'void' ? 'Void' : item.balanceMinor ? 'Payment outstanding' : 'Settled'}</td><td>{money(item.totalMinor)}</td><td>{money(item.paidMinor)}</td><td>{money(item.balanceMinor)}</td></tr>)}</tbody></table></div> : <p className="empty-small">No invoices issued. Prepare an invoice from the hospital’s service catalog when the charges are ready.</p>}
      <div className="staff-pagination"><p>{list.total} invoices · Page {list.page} of {Math.max(1, Math.ceil(list.total / list.pageSize))}</p><div className="button-row"><button disabled={locked || page === 1} onClick={() => setPage(n => n - 1)}>Previous invoices</button><button disabled={locked || list.page * list.pageSize >= list.total} onClick={() => setPage(n => n + 1)}>Next invoices</button></div></div>
    </>}
    {detailLoading && <p role="status">Loading invoice…</p>}
    {!preparing && selected && detail && invoice && <>
      <p>Issued {when(invoice.issuedAt)} by {invoice.actorName}. <strong>{invoice.status === 'void' ? 'Void' : invoice.balanceMinor ? 'Payment outstanding' : 'Settled'}</strong></p>
      <div className="invoice">{detail.lines.map(line => <div key={line.id}><span>{line.name}<small>{line.code} · {line.quantity} × {money(line.unitPriceMinor)} · Version {line.serviceRevision}</small></span><strong>{money(line.totalMinor)}</strong></div>)}<div className="invoice-total"><strong>Invoice total</strong><strong>{money(invoice.totalMinor)}</strong></div><div><span>Paid</span><strong>{money(invoice.paidMinor)}</strong></div><div><strong>Balance</strong><strong>{money(invoice.balanceMinor)}</strong></div></div>
      {list?.permissions.pay && invoice.status === 'issued' && invoice.balanceMinor > 0 && <form className="billing-payment-form" onSubmit={e => { e.preventDefault(); if (paymentConfirmed && amountMinor !== null) send({ type: 'payment.record', invoiceId: invoice.id, expectedRevision: invoice.revision, amountMinor, method, reference: reference.trim() }); }}><h3>Record a payment</h3><p>Record money already received. A manual transfer record does not verify or move funds.</p><div className="billing-form-grid"><div><label htmlFor="billing-amount">Amount received (ETB)</label><input id="billing-amount" inputMode="decimal" required maxLength={10} value={amount} disabled={locked} onChange={e => { setAmount(e.target.value); setPaymentConfirmed(false); }} /></div><div><label htmlFor="billing-method">Payment method</label><select id="billing-method" value={method} disabled={locked} onChange={e => { setMethod(e.target.value as typeof method); setPaymentConfirmed(false); }}><option value="cash">Cash</option><option value="manual_transfer">Manual transfer</option></select></div><div><label htmlFor="billing-reference">{method === 'manual_transfer' ? 'Transfer reference (required)' : 'Reference (optional)'}</label><input id="billing-reference" required={method === 'manual_transfer'} maxLength={200} value={reference} disabled={locked} onChange={e => { setReference(e.target.value); setPaymentConfirmed(false); }} /></div></div>
        {amount && (amountMinor === null || amountMinor <= 0 || amountMinor > invoice.balanceMinor) && <p className="billing-invalid">Enter a positive amount up to {money(invoice.balanceMinor)}, with no more than two decimal places.</p>}
        <label className="billing-confirm"><input type="checkbox" disabled={locked} checked={paymentConfirmed} onChange={e => setPaymentConfirmed(e.target.checked)} />I confirm this money was received and the details are correct.</label><button className="primary" disabled={locked || readsBlocked || !paymentConfirmed || amountMinor === null || amountMinor <= 0 || amountMinor > invoice.balanceMinor || (method === 'manual_transfer' && !reference.trim())}>Record payment</button>
      </form>}
      {list?.permissions.void && invoice.status === 'issued' && invoice.paidMinor === 0 && <form className="billing-void-form" onSubmit={e => { e.preventDefault(); if (voidConfirmed) send({ type: 'invoice.void', invoiceId: invoice.id, expectedRevision: invoice.revision, reason: reason.trim() }); }}><h3>Void unpaid invoice</h3><p>The invoice and reason remain in the financial history.</p><label htmlFor="billing-void-reason">Reason for voiding</label><input id="billing-void-reason" required maxLength={200} value={reason} disabled={locked} onChange={e => { setReason(e.target.value); setVoidConfirmed(false); }} /><label className="billing-confirm"><input type="checkbox" disabled={locked} checked={voidConfirmed} onChange={e => setVoidConfirmed(e.target.checked)} />I confirm this unpaid invoice should be voided.</label><button disabled={locked || readsBlocked || !reason.trim() || !voidConfirmed}>Void invoice</button></form>}
      {((invoice.status === 'void' || invoice.balanceMinor === 0) && (amount || reference) || (invoice.status === 'void' || invoice.paidMinor > 0) && reason) && <div className="notice warning"><p>The invoice changed. These unsaved details cannot be recorded here. Copy them or discard the billing draft explicitly.</p>{(invoice.status === 'void' || invoice.balanceMinor === 0) && (amount || reference) && <p className="preserve">Unsaved payment: {amount || 'No amount'} ETB · {method === 'cash' ? 'Cash' : 'Manual transfer'} · {reference || 'No reference'}</p>}{(invoice.status === 'void' || invoice.paidMinor > 0) && reason && <p className="preserve">Unsaved void reason: {reason}</p>}</div>}
      <h3>Financial history</h3><ul className="timeline">{detail.events.map(event => <li key={event.id}><strong>{event.action === 'invoice.issue' ? 'Invoice issued' : event.action === 'invoice.void' ? 'Invoice voided' : 'Payment recorded'}</strong><small>{when(event.createdAt)} · {event.actorName}</small>{event.reason && <p className="preserve">{event.reason}</p>}{event.payment && <div><p><strong>Receipt {event.payment.receiptNumber}</strong> · {money(event.payment.amountMinor)} · {event.payment.method === 'cash' ? 'Cash' : 'Manual transfer'}</p>{event.payment.reference && <p className="preserve">Reference: {event.payment.reference}</p>}</div>}</li>)}</ul>
      <div className="staff-pagination"><p>History · Page {detail.page} of {Math.max(1, Math.ceil(detail.total / detail.pageSize))}</p><div className="button-row"><button disabled={locked || detailLoading || historyPage === 1} onClick={() => setHistoryPage(n => n - 1)}>Previous billing history</button><button disabled={locked || detailLoading || detail.page * detail.pageSize >= detail.total} onClick={() => setHistoryPage(n => n + 1)}>Next billing history</button></div></div>
    </>}
  </section>;
}
