import { interfaceMessage } from '../i18n';
import { presentationLabel } from '../i18n';
import { t } from '../i18n';
import { request, ApiError } from './api';
import type { DepartmentSources, DepartmentChoice } from '../../shared/departments';
import { hospitalDate } from './date';
import { useEffect, useState } from 'react';
import type { Session } from '../../shared/registration';
import BillingPanel from './BillingPanel';
import ClinicalHistory from './ClinicalHistory';
import PharmacyPanel from './PharmacyPanel';
import ClinicalCorrections from './ClinicalCorrections';
import type { VisitAction, VisitCommand, VisitSection, VisitView } from '../../shared/outpatient';

const money = (amount: number) => `${(amount / 100).toFixed(2)} ETB`;
const date = (value: string) => hospitalDate(value);
export default function VisitPanel({
  visit,
  disabled,
  onCommand,
  onDirty,
  saved,
  session,
  billingRefresh,
  billingPending,
  clinicalPending,
  pharmacyPending,
  onPharmacyPending,
  onClinicalPending,
  onBillingPending,
  onBillingSaved,
  onSessionError,
}: {
  visit: VisitView;
  disabled: boolean;
  onCommand: (command: VisitCommand) => void;
  onDirty: (dirty: boolean) => void;
  pharmacyPending: boolean;
  onPharmacyPending: (value: boolean) => void;
  clinicalPending: boolean;
  onClinicalPending: (value: boolean) => void;
  session: Session;
  billingRefresh: number;
  billingPending: boolean;
  onBillingPending: (value: boolean) => void;
  onBillingSaved: () => void;
  onSessionError: (error: unknown) => void;
  saved: { sequence: number; command?: VisitCommand };
}) {
  const clinicalDisabled = disabled || billingPending || clinicalPending || pharmacyPending;
  const [noteCorrectionDirty, setNoteCorrectionDirty] = useState(false);
  const [resultCorrectionDirty, setResultCorrectionDirty] = useState(false);
  const [pharmacyDirty, setPharmacyDirty] = useState(false);
  const [billingDirty, setBillingDirty] = useState(false);
  const [section, setSection] = useState<VisitSection | undefined>(visit.sections[0]);
  const [note, setNote] = useState('');
  const [instruction, setInstruction] = useState('');
  const [test, setTest] = useState('');
  const [tests, setTests] = useState<DepartmentChoice[]>([]);
  const [testPage, setTestPage] = useState(1);
  const [testTotal, setTestTotal] = useState(0);
  const [testQuery, setTestQuery] = useState('');
  const [testSearch, setTestSearch] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState('');
  useEffect(() => {
    if (visit.financialMode !== 'catalog' || !visit.allowedActions.includes('order')) return;
    let live = true;
    setTestLoading(true);
    setTestError('');
    request<DepartmentSources>('/api/departments/sources', {
      method: 'POST',
      headers: { 'X-CSRF-Token': session.csrfToken },
      body: JSON.stringify({ kind: 'catalog', q: testSearch, page: testPage }),
    })
      .then((result) => {
        if (live) {
          setTests(result.entries);
          setTestTotal(result.total);
        }
      })
      .catch((error) => {
        if (live) {
          setTestError(error.message);
          if (error instanceof ApiError && [401, 403].includes(error.status)) onSessionError(error);
        }
      })
      .finally(() => {
        if (live) setTestLoading(false);
      });
    return () => {
      live = false;
    };
  }, [visit.id, visit.financialMode, session.csrfToken, testSearch, testPage]);
  const [results, setResults] = useState<Record<string, string>>({});
  const dirty = Boolean(note || instruction || Object.values(results).some(Boolean));
  useEffect(() => {
    onDirty(dirty || billingDirty || noteCorrectionDirty || resultCorrectionDirty || pharmacyDirty);
  }, [dirty, billingDirty, noteCorrectionDirty, resultCorrectionDirty, pharmacyDirty, onDirty]);
  useEffect(() => {
    if (saved.command?.type === 'note') setNote('');
    if (saved.command?.type === 'prescribe') setInstruction('');
    if (saved.command?.type === 'advanceOrder' && saved.command.next === 'released') {
      const id = saved.command.orderId;
      setResults((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    }
  }, [saved]);
  const can = (action: VisitAction) =>
    visit.status === 'active' && visit.allowedActions.includes(action);
  const preservedResults = Object.entries(results).filter(
    ([id, value]) =>
      value &&
      !(
        can('release') &&
        visit.orders?.some(
          (order) => order.id === id && !order.catalogId && order.status === 'collected',
        )
      ),
  );
  function discardResult(id: string) {
    setResults((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }
  return (
    <>
      {dirty && (
        <div className="notice warning">
          <span>{t('common:you_have_unsaved_visit_drafts')}</span>
          <button
            disabled={clinicalDisabled}
            onClick={() => {
              setNote('');
              setInstruction('');
              setResults({});
            }}
          >
            {' '}
            {t('common:discard_unsaved_drafts')}{' '}
          </button>
        </div>
      )}
      {(preservedResults.length > 0 ||
        (note && !can('note')) ||
        (instruction && !can('prescribe'))) && (
        <section className="panel visit-overview" aria-label={t('common:preserved_unsaved_drafts')}>
          <h2>{t('common:preserved_unsaved_drafts')}</h2>
          <p>
            {' '}
            {t(
              'common:the_visit_changed_and_these_drafts_cannot_be_saved_here_select_the_text_to_copy_it_or_discard_i',
            )}{' '}
          </p>
          {note && !can('note') && (
            <>
              <label htmlFor="preserved-note">{t('common:unsaved_consultation_note')}</label>
              <textarea
                id="preserved-note"
                readOnly
                value={note}
                onFocus={(e) => e.currentTarget.select()}
              />
            </>
          )}
          {instruction && !can('prescribe') && (
            <>
              <label htmlFor="preserved-prescription">
                {t('common:unsaved_prescription_instructions')}
              </label>
              <textarea
                id="preserved-prescription"
                readOnly
                value={instruction}
                onFocus={(e) => e.currentTarget.select()}
              />
            </>
          )}
          {preservedResults.map(([id, value]) => (
            <div key={id}>
              <label htmlFor={`preserved-${id}`}>
                {' '}
                {t('common:unsaved')}{' '}
                {visit.orders?.find((order) => order.id === id)?.test ?? t('common:investigation')}{' '}
                {t('common:result_draft')}{' '}
              </label>
              <textarea
                id={`preserved-${id}`}
                readOnly
                value={value}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button disabled={clinicalDisabled} onClick={() => discardResult(id)}>
                {' '}
                {t('common:discard_result_draft')}{' '}
              </button>
            </div>
          ))}
        </section>
      )}
      <section className="panel visit-overview" aria-label={t('common:visit_summary')}>
        <div>
          <span className={`badge ${visit.status === 'closed' ? 'neutral' : 'teal'}`}>
            {presentationLabel(visit.stage)}
          </span>
          <p>
            {' '}
            {t('common:opened')} {date(visit.openedAt)}
            {visit.closedAt && (
              <>
                {' '}
                {t('common:closed')} {date(visit.closedAt)}
              </>
            )}
          </p>
        </div>
        <dl>
          <div>
            <dt>{t('common:corrections_to_review')}</dt>
            <dd>{visit.pendingClinicalReviews}</dd>
          </div>
          <div>
            <dt>{t('common:investigations_pending')}</dt>
            <dd>{visit.pendingInvestigations}</dd>
          </div>
          <div>
            <dt>{t('common:prescriptions_pending')}</dt>
            <dd>{visit.pendingPrescriptions}</dd>
          </div>
          <div>
            <dt>
              {visit.financialMode === 'catalog'
                ? t('common:financial_status')
                : t('common:outstanding_balance')}
            </dt>
            <dd>
              {visit.billing?.state === 'unbilled'
                ? t('common:not_yet_billed')
                : visit.billing?.state === 'settled'
                  ? t('common:settled')
                  : money(visit.balance)}
            </dd>
          </div>
        </dl>
        {visit.pendingClinicalReviews > 0 && (
          <p className="notice warning">
            {visit.pendingClinicalReviews} {t('common:corrected_result')}{' '}
            {visit.pendingClinicalReviews === 1 ? t('common:requires') : t('common:s_require')}{' '}
            {t('common:clinician_review')}{' '}
            {visit.sections.includes('Diagnostics')
              ? t('common:open_diagnostics_to_review_the_latest_correction')
              : t('common:the_assigned_clinician_must_review_the_latest_correction')}
          </p>
        )}
        {visit.status === 'closed' ? (
          <p className="notice success">
            {visit.financialMode === 'catalog'
              ? t(
                  'common:clinical_visit_closed_original_clinical_records_remain_unchanged_corrections_and_billing_remain',
                )
              : t(
                  'common:this_visit_is_closed_original_records_remain_unchanged_corrections_remain_available',
                )}
          </p>
        ) : (
          <div className="closure">
            <div>
              <h2>{t('common:visit_completion')}</h2>
              {visit.blockers.length ? (
                <ul>
                  {visit.blockers.map((reason) => (
                    <li key={reason}>{interfaceMessage(reason)}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  {visit.financialMode === 'catalog'
                    ? t(
                        'common:clinical_work_is_complete_closing_the_clinical_visit_does_not_settle_its_billing',
                      )
                    : t('common:all_required_work_is_complete_this_visit_can_be_closed')}
                </p>
              )}
            </div>
            {can('close') && (
              <button
                disabled={clinicalDisabled || visit.blockers.length > 0}
                onClick={() => onCommand({ type: 'close' })}
              >
                {' '}
                {t('common:close_visit')}{' '}
              </button>
            )}
          </div>
        )}
      </section>
      {visit.sections.length > 0 && (
        <section className="panel visit-detail">
          <div role="tablist" className="detail-tabs" aria-label={t('common:visit_sections')}>
            {visit.sections.map((item) => (
              <button
                key={item}
                disabled={clinicalDisabled}
                role="tab"
                id={`visit-tab-${item}`}
                aria-controls="visit-section-panel"
                aria-selected={section === item}
                tabIndex={section === item ? 0 : -1}
                onKeyDown={(event) => {
                  if (clinicalDisabled) return;
                  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
                  if (!keys.includes(event.key)) return;
                  event.preventDefault();
                  const items = visit.sections;
                  const index = items.indexOf(item);
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? items.length - 1
                        : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) %
                          items.length;
                  setSection(items[next]);
                  document.getElementById(`visit-tab-${items[next]}`)?.focus();
                }}
                onClick={() => setSection(item)}
              >
                {presentationLabel(item)}
              </button>
            ))}
          </div>
          <div
            className="detail-content"
            role="tabpanel"
            id="visit-section-panel"
            aria-labelledby={`visit-tab-${section}`}
            tabIndex={0}
          >
            {section === 'Consultation' && visit.notes && (
              <section aria-labelledby="consultation-title">
                <h2 id="consultation-title">{t('common:consultation_notes')}</h2>
                {visit.notes.length ? (
                  visit.notes.map((item) => (
                    <article className="note" key={item.id}>
                      <small>{date(item.at)}</small>
                      {visit.clinical?.records.some((record) => record.subjectId === item.id) && (
                        <p className="notice warning">
                          {' '}
                          {t('common:original_note_amended')}{' '}
                          <button
                            onClick={() =>
                              document.getElementById(`note-amendment-subject-${item.id}`)?.focus()
                            }
                          >
                            {' '}
                            {t('common:read_latest_amendment_for_note')}{' '}
                            {visit.notes!.findIndex((note) => note.id === item.id) + 1}
                          </button>
                        </p>
                      )}
                      <p className="preserve">{item.body}</p>
                    </article>
                  ))
                ) : (
                  <p className="empty-small">{t('common:no_consultation_notes_saved')}</p>
                )}
                {can('note') && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      onCommand({ type: 'note', body: note.trim() });
                    }}
                  >
                    <label htmlFor="visit-note">{t('common:consultation_note')}</label>
                    <textarea
                      id="visit-note"
                      required
                      maxLength={4000}
                      value={note}
                      disabled={clinicalDisabled}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <button className="primary" disabled={clinicalDisabled || !note.trim()}>
                      {' '}
                      {t('common:save_note')}{' '}
                    </button>
                  </form>
                )}
              </section>
            )}
            {section === 'Diagnostics' && visit.orders && (
              <section aria-labelledby="diagnostics-title">
                <h2 id="diagnostics-title">{t('common:investigations')}</h2>
                {can('order') && (
                  <form
                    className="visit-order-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (visit.financialMode === 'catalog') {
                        const choice = tests.find((t) => t.id === test);
                        if (choice)
                          onCommand({
                            type: 'order',
                            catalogId: choice.id,
                            test: choice.data!.name,
                          });
                      } else if (test) onCommand({ type: 'order', test });
                    }}
                  >
                    {visit.financialMode === 'catalog' && (
                      <div>
                        <label htmlFor="visit-test-search">
                          {t('common:find_a_configured_investigation')}
                        </label>
                        <input
                          id="visit-test-search"
                          maxLength={100}
                          value={testQuery}
                          disabled={clinicalDisabled}
                          onChange={(e) => setTestQuery(e.target.value)}
                        />
                        <button
                          type="button"
                          disabled={clinicalDisabled || testLoading}
                          onClick={() => {
                            setTestSearch(testQuery.trim());
                            setTestPage(1);
                            setTest('');
                          }}
                        >
                          {' '}
                          {t('common:find_tests')}{' '}
                        </button>
                      </div>
                    )}
                    <div>
                      <label htmlFor="visit-investigation">{t('common:investigation')}</label>
                      <select
                        id="visit-investigation"
                        required
                        value={test}
                        disabled={clinicalDisabled || testLoading}
                        onChange={(e) => setTest(e.target.value)}
                      >
                        <option value="">{t('common:choose_an_investigation')}</option>
                        {visit.financialMode === 'catalog'
                          ? tests.map((choice) => (
                              <option key={choice.id} value={choice.id}>
                                {choice.label}
                              </option>
                            ))
                          : ['Blood count', 'Urinalysis', 'Blood glucose'].map((name) => (
                              <option key={name}>{name}</option>
                            ))}
                      </select>
                      {testLoading && <p role="status">{t('common:loading_configured_tests')}</p>}
                      {testError && <p role="alert">{interfaceMessage(testError)}</p>}
                      {visit.financialMode === 'catalog' && !testLoading && !tests.length && (
                        <p>
                          {' '}
                          {t(
                            'common:no_matching_hospital_tests_configured_an_administrator_must_configure_the_laboratory_catalog_be',
                          )}{' '}
                        </p>
                      )}
                      {visit.financialMode === 'catalog' && (
                        <div className="button-row">
                          <button
                            type="button"
                            disabled={clinicalDisabled || testLoading || testPage === 1}
                            onClick={() => {
                              setTestPage((p) => p - 1);
                              setTest('');
                            }}
                          >
                            {' '}
                            {t('common:previous_tests')}{' '}
                          </button>
                          <button
                            type="button"
                            disabled={clinicalDisabled || testLoading || testPage * 25 >= testTotal}
                            onClick={() => {
                              setTestPage((p) => p + 1);
                              setTest('');
                            }}
                          >
                            {' '}
                            {t('common:next_tests')}{' '}
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      className="primary"
                      disabled={
                        clinicalDisabled ||
                        testLoading ||
                        !test ||
                        visit.orders.some((order) =>
                          visit.financialMode === 'catalog'
                            ? order.catalogId === test
                            : order.test === test,
                        )
                      }
                    >
                      {' '}
                      {t('common:request_investigation')}{' '}
                    </button>
                  </form>
                )}
                {!visit.orders.length && (
                  <p className="empty-small">{t('common:no_investigations_requested')}</p>
                )}
                {visit.orders.map((order) => (
                  <article
                    className="order-card"
                    key={order.id}
                    aria-label={t('dynamic:investigation_label', { test: order.test })}
                  >
                    <div className="section-heading">
                      <h3>{order.test}</h3>
                      <span className="badge neutral">
                        {visit.clinical?.records.some((record) => record.subjectId === order.id)
                          ? t('dynamic:original_status', {
                              status: presentationLabel(order.status),
                            })
                          : presentationLabel(order.status)}
                      </span>
                    </div>
                    {order.result && (
                      <div className="result">
                        <h4>
                          {visit.clinical?.records.some((record) => record.subjectId === order.id)
                            ? t('common:original_released_result')
                            : t('common:released_result')}
                        </h4>
                        <p className="preserve">{order.result}</p>
                        {visit.clinical?.records.some(
                          (record) => record.subjectId === order.id,
                        ) && (
                          <p className="notice warning">
                            {' '}
                            {t('common:this_original_result_has_been_corrected')}{' '}
                            <button
                              onClick={() =>
                                document
                                  .getElementById(`result-correction-subject-${order.id}`)
                                  ?.focus()
                              }
                            >
                              {' '}
                              {t('common:read_latest')} {order.test} {t('common:correction')}{' '}
                            </button>
                          </p>
                        )}
                      </div>
                    )}
                    {order.catalogId && ['requested', 'collected'].includes(order.status) && (
                      <p className="notice">
                        {' '}
                        {t('common:use')}{' '}
                        <strong>{t('common:department_operations_laboratory_specimens')}</strong>{' '}
                        {t(
                          'common:to_register_the_accession_collect_and_receive_the_specimen_and_release_its_result_the_configure',
                        )}{' '}
                      </p>
                    )}
                    <div className="button-row">
                      {can('collect') && !order.catalogId && order.status === 'requested' && (
                        <button
                          disabled={clinicalDisabled}
                          onClick={() =>
                            onCommand({
                              type: 'advanceOrder',
                              orderId: order.id,
                              next: 'collected',
                            })
                          }
                        >
                          {' '}
                          {t('common:mark_collected')}{' '}
                        </button>
                      )}
                      {can('review') && order.status === 'released' && (
                        <button
                          disabled={clinicalDisabled}
                          onClick={() =>
                            onCommand({ type: 'advanceOrder', orderId: order.id, next: 'reviewed' })
                          }
                        >
                          {' '}
                          {t('common:mark_reviewed')}{' '}
                        </button>
                      )}
                      {can('cancelOrder') && ['requested', 'collected'].includes(order.status) && (
                        <button
                          disabled={clinicalDisabled}
                          onClick={() =>
                            onCommand({
                              type: 'advanceOrder',
                              orderId: order.id,
                              next: 'cancelled',
                            })
                          }
                        >
                          {' '}
                          {t('common:cancel_investigation')}{' '}
                        </button>
                      )}
                    </div>
                    {can('release') && !order.catalogId && order.status === 'collected' && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          onCommand({
                            type: 'advanceOrder',
                            orderId: order.id,
                            next: 'released',
                            result: (results[order.id] ?? '').trim(),
                          });
                        }}
                      >
                        <label htmlFor={`result-${order.id}`}>
                          {order.test} {t('common:result')}
                        </label>
                        <textarea
                          id={`result-${order.id}`}
                          required
                          maxLength={4000}
                          value={results[order.id] ?? ''}
                          disabled={clinicalDisabled}
                          onChange={(e) =>
                            setResults((previous) => ({ ...previous, [order.id]: e.target.value }))
                          }
                        />
                        <p className="muted visit-form-help">
                          {' '}
                          {t(
                            'common:released_results_remain_unchanged_corrections_are_appended_with_a_reason_and_a_new_review',
                          )}{' '}
                        </p>
                        <button
                          className="primary"
                          disabled={clinicalDisabled || !results[order.id]?.trim()}
                        >
                          {' '}
                          {t('common:release_result')}{' '}
                        </button>
                      </form>
                    )}
                  </article>
                ))}
              </section>
            )}
            {visit.prescriptions && (
              <section hidden={section !== 'Pharmacy'} aria-labelledby="pharmacy-title">
                <h2 id="pharmacy-title">{t('common:prescriptions')}</h2>
                {can('prescribe') && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      onCommand({ type: 'prescribe', instruction: instruction.trim() });
                    }}
                  >
                    <label htmlFor="visit-prescription">
                      {t('common:prescription_instructions')}
                    </label>
                    <textarea
                      id="visit-prescription"
                      required
                      maxLength={4000}
                      value={instruction}
                      disabled={clinicalDisabled}
                      onChange={(e) => setInstruction(e.target.value)}
                    />
                    <button className="primary" disabled={clinicalDisabled || !instruction.trim()}>
                      {' '}
                      {t('common:add_prescription')}{' '}
                    </button>
                  </form>
                )}
                <PharmacyPanel
                  visit={visit}
                  session={session}
                  disabled={clinicalDisabled}
                  onDirty={setPharmacyDirty}
                  onPending={onPharmacyPending}
                  onSaved={onBillingSaved}
                  onSessionError={onSessionError}
                  onCommand={onCommand}
                />
              </section>
            )}
            {visit.financialMode === 'catalog' && visit.sections.includes('Billing') && (
              <div hidden={section !== 'Billing'}>
                <BillingPanel
                  visitId={visit.id}
                  session={session}
                  externalRefresh={billingRefresh}
                  disabled={disabled || clinicalPending || pharmacyPending}
                  onDirty={setBillingDirty}
                  onPending={onBillingPending}
                  onSaved={onBillingSaved}
                  onSessionError={onSessionError}
                />
              </div>
            )}
            {visit.clinical && visit.sections.includes('Consultation') && (
              <div hidden={section !== 'Consultation'}>
                <ClinicalCorrections
                  visit={visit}
                  kind="note"
                  session={session}
                  disabled={clinicalDisabled}
                  onDirty={setNoteCorrectionDirty}
                  onPending={onClinicalPending}
                  onSaved={onBillingSaved}
                  onSessionError={onSessionError}
                />
              </div>
            )}
            {visit.clinical && visit.sections.includes('Diagnostics') && (
              <div hidden={section !== 'Diagnostics'}>
                <ClinicalCorrections
                  visit={visit}
                  kind="result"
                  session={session}
                  disabled={clinicalDisabled}
                  onDirty={setResultCorrectionDirty}
                  onPending={onClinicalPending}
                  onSaved={onBillingSaved}
                  onSessionError={onSessionError}
                />
              </div>
            )}
            {visit.financialMode !== 'catalog' &&
              section === 'Billing' &&
              visit.charges &&
              visit.payments && (
                <section aria-labelledby="billing-title">
                  <h2 id="billing-title">{t('common:charges_and_payments')}</h2>
                  <p>
                    {' '}
                    {t(
                      'common:invented_demonstration_prices_recording_settlement_does_not_process_a_real_payment',
                    )}{' '}
                  </p>
                  <div className="invoice">
                    {visit.charges.map((charge) => (
                      <div key={charge.id}>
                        <span>
                          {charge.label}
                          <small>
                            {charge.reversed
                              ? t('common:reversed')
                              : charge.paid
                                ? t('common:paid')
                                : t('common:unpaid')}
                          </small>
                        </span>
                        <span className={charge.reversed ? 'struck' : ''}>
                          {money(charge.amount)}
                        </span>
                      </div>
                    ))}
                    <div className="invoice-total">
                      <strong>{t('common:outstanding_balance')}</strong>
                      <strong>{money(visit.balance)}</strong>
                    </div>
                  </div>
                  {can('settle') && (
                    <button
                      className="primary"
                      disabled={clinicalDisabled || visit.balance <= 0}
                      onClick={() => onCommand({ type: 'settle' })}
                    >
                      {' '}
                      {t('common:record_demo_settlement')}{' '}
                    </button>
                  )}
                  <h3 className="visit-payments-title">{t('common:recorded_payments')}</h3>
                  {visit.payments.length ? (
                    <ul className="timeline">
                      {visit.payments.map((payment) => (
                        <li key={payment.id}>
                          <strong>{money(payment.amount)}</strong>
                          <small>{date(payment.at)}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty-small">{t('common:no_payments_recorded')}</p>
                  )}
                </section>
              )}
            {section === 'History' && visit.history && (
              <section aria-labelledby="history-title">
                <h2 id="history-title">{t('common:visit_history')}</h2>
                <ul className="timeline">
                  {visit.history.map((event) => (
                    <li key={event.id}>
                      <strong>{event.detail}</strong>
                      <small>
                        {date(event.at)} · {event.actor}
                      </small>
                    </li>
                  ))}
                </ul>
                <ClinicalHistory
                  visitId={visit.id}
                  version={billingRefresh}
                  disabled={clinicalDisabled}
                  onSessionError={onSessionError}
                />
              </section>
            )}
          </div>
        </section>
      )}
    </>
  );
}
