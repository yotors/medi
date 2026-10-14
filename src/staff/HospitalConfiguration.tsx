import { uiMessage } from '../i18n';
import { presentationLabel } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
import { hospitalDate } from './date';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  configurationCommandSchema,
  formatETB,
  parseETB,
  type ConfigurationCommand,
  type ConfigurationHistory,
  type ConfigurationItem,
  type ConfigurationList,
  type ConfigurationResult,
  type Department,
} from '../../shared/configuration';
import type { Session } from '../../shared/registration';
import { ApiError, request } from './api';
import './configuration.css';
type Kind = 'departments' | 'services';
type Props = {
  session: Session;
  onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void;
  onSessionError: (error: unknown) => void;
};
export default function HospitalConfiguration({
  session,
  onDirty,
  onPending,
  onSessionError,
}: Props) {
  const admin = session.user.role === 'admin';
  const [kind, setKind] = useState<Kind>('services');
  const [list, setList] = useState<ConfigurationList | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [overlaps, setOverlaps] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<ConfigurationItem | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [active, setActive] = useState(true);
  const [price, setPrice] = useState('0.00');
  const [departmentId, setDepartmentId] = useState('');
  const [chosenDepartment, setChosenDepartment] = useState<Department | null>(null);
  const [departmentSearch, setDepartmentSearch] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentError, setDepartmentError] = useState('');
  const [departmentPage, setDepartmentPage] = useState(1);
  const [departmentTotal, setDepartmentTotal] = useState(0);
  const [departmentLoading, setDepartmentLoading] = useState(false);
  const [history, setHistory] = useState<ConfigurationHistory | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [pending, setPending] = useState<{ key: string; command: ConfigurationCommand } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const previousService = selected && 'priceMinor' in selected ? selected : null;
  const dirty =
    editing &&
    (selected
      ? name !== selected.name ||
        active !== selected.active ||
        (kind === 'services' &&
          (price !== formatETB(previousService!.priceMinor) ||
            departmentId !== previousService!.departmentId))
      : Boolean(name || code || departmentId || price !== '0.00'));
  const locked = busy || Boolean(pending);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    onPending(locked);
  }, [locked, onPending]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function failure(error: unknown): string {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.code === 'PASSWORD_CHANGE_REQUIRED')
    )
      onSessionError(error);
    return error instanceof Error
      ? error.message
      : t('configuration:the_request_failed_please_retry');
  }
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    void request<ConfigurationList>(
      `/api/configuration/${kind}?q=${encodeURIComponent(query)}&page=${page}`,
    )
      .then((result) => {
        if (!cancelled) {
          const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
          if (page > lastPage) setPage(lastPage);
          else setList(result);
        }
      })
      .catch((error) => {
        if (!cancelled) setLoadError(failure(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, query, page, refresh]);
  useEffect(() => {
    if (!editing || kind !== 'services') return;
    let cancelled = false;
    const controller = new AbortController();
    setDepartmentError('');
    setDepartmentLoading(true);
    setDepartments([]);
    const timer = window.setTimeout(() => {
      void request<ConfigurationList>(
        `/api/configuration/departments?active=true&q=${encodeURIComponent(departmentSearch)}&page=${departmentPage}`,
        { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) },
      )
        .then((result) => {
          if (!cancelled) {
            setDepartments(result.entries as Department[]);
            setDepartmentTotal(result.total);
          }
        })
        .catch((error) => {
          if (!cancelled) setDepartmentError(failure(error));
        })
        .finally(() => {
          if (!cancelled) setDepartmentLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [editing, kind, departmentSearch, departmentPage, refresh]);
  useEffect(() => {
    setHistory(null);
    setHistoryError('');
    if (!selected || !editing) return;
    let cancelled = false;
    void request<ConfigurationHistory>(
      `/api/configuration/${kind}/${selected.id}/history?page=${historyPage}`,
    )
      .then((result) => {
        if (!cancelled) setHistory(result);
      })
      .catch((error) => {
        if (!cancelled) setHistoryError(failure(error));
      });
    return () => {
      cancelled = true;
    };
  }, [selected, editing, kind, historyPage, historyRefresh]);
  function open(entry: ConfigurationItem | null) {
    setSelected(entry);
    setName(entry?.name ?? '');
    setCode(entry?.code ?? '');
    setActive(entry?.active ?? true);
    setPrice(entry && 'priceMinor' in entry ? formatETB(entry.priceMinor) : '0.00');
    setDepartmentId(entry && 'departmentId' in entry ? entry.departmentId : '');
    setChosenDepartment(
      entry && 'departmentId' in entry
        ? {
            id: entry.departmentId,
            name: entry.departmentName,
            code: entry.departmentCode,
            active: entry.departmentActive,
            revision: 1,
          }
        : null,
    );
    setEditing(true);
    setOverlaps([]);
    setPending(null);
    setError('');
    setNotice('');
    setHistoryPage(1);
    setDepartmentSearch('');
    setDepartmentPage(1);
    setTimeout(() => heading.current?.focus(), 0);
  }
  function close() {
    if (
      locked ||
      (dirty && !window.confirm(t('configuration:discard_unsaved_configuration_details')))
    )
      return;
    setEditing(false);
    setSelected(null);
    setError('');
    setTimeout(() => listHeading.current?.focus(), 0);
  }
  async function reloadRevision() {
    setBusy(true);
    setError('');
    try {
      const { entry } = await request<ConfigurationResult>(
        `/api/configuration/${kind}/${selected!.id}`,
      );
      if (alive.current) {
        const baseline = selected!;
        const conflicts: string[] = [];
        if (name === baseline.name) setName(entry.name);
        else if (entry.name !== baseline.name && name !== entry.name)
          conflicts.push(uiMessage('dynamic:conflict_name', { name: entry.name }));
        if (active === baseline.active) setActive(entry.active);
        else if (entry.active !== baseline.active && active !== entry.active)
          conflicts.push(
            uiMessage(entry.active ? 'dynamic:conflict_active' : 'dynamic:conflict_inactive'),
          );
        if ('priceMinor' in baseline && 'priceMinor' in entry) {
          if (parseETB(price) === baseline.priceMinor) setPrice(formatETB(entry.priceMinor));
          else if (entry.priceMinor !== baseline.priceMinor && parseETB(price) !== entry.priceMinor)
            conflicts.push(
              uiMessage('dynamic:conflict_price', { amount: formatETB(entry.priceMinor) }),
            );
          if (departmentId === baseline.departmentId) {
            setDepartmentId(entry.departmentId);
            setChosenDepartment({
              id: entry.departmentId,
              name: entry.departmentName,
              code: entry.departmentCode,
              active: entry.departmentActive,
              revision: 1,
            });
          } else if (
            entry.departmentId !== baseline.departmentId &&
            departmentId !== entry.departmentId
          )
            conflicts.push(
              uiMessage('dynamic:conflict_department', {
                name: entry.departmentName,
                code: entry.departmentCode,
              }),
            );
        }
        setOverlaps(conflicts);
        setSelected(entry);
        setError(
          t(
            'configuration:current_revision_loaded_your_draft_is_retained_untouched_fields_now_use_current_values_review_b',
          ),
        );
      }
    } catch (error) {
      if (alive.current) setError(failure(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');
    const amount = parseETB(price);
    if (!pending && kind === 'services' && amount === null) {
      setError(
        uiMessage(
          'configuration:enter_an_etb_amount_from_0_00_to_9999999_99_with_at_most_two_decimal_places',
        ),
      );
      return;
    }
    const candidate =
      kind === 'departments'
        ? selected
          ? {
              type: 'department.update',
              id: selected.id,
              expectedRevision: selected.revision,
              name,
              active,
            }
          : { type: 'department.create', name, code }
        : selected
          ? {
              type: 'service.update',
              id: selected.id,
              expectedRevision: selected.revision,
              name,
              active,
              departmentId,
              priceMinor: amount,
            }
          : { type: 'service.create', name, code, departmentId, priceMinor: amount };
    const parsed = configurationCommandSchema.safeParse(pending?.command ?? candidate);
    if (!parsed.success) {
      setError(
        t(
          'configuration:check_the_name_department_and_code_codes_use_2_32_uppercase_letters_digits_hyphens_or_underscor',
        ),
      );
      return;
    }
    const submission = pending ?? { key: crypto.randomUUID(), command: parsed.data };
    setPending(submission);
    setBusy(true);
    try {
      const result = await request<ConfigurationResult>('/api/configuration/commands', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': submission.key },
        body: JSON.stringify(submission.command),
      });
      if (!alive.current) return;
      open(result.entry);
      setNotice(uiMessage('configuration:configuration_saved_earlier_versions_remain_in_history'));
      setRefresh((value) => value + 1);
    } catch (error) {
      if (!alive.current) return;
      setError(failure(error));
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) setPending(null);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="hospital-configuration">
      <div className="staff-section-heading">
        <div>
          <h1 ref={listHeading} tabIndex={-1}>
            {admin ? t('configuration:hospital_configuration') : t('configuration:service_catalog')}
          </h1>
          <p className="muted">
            {session.user.hospital.name} {t('configuration:departments_and_etb_services')}
          </p>
        </div>
        {admin && !editing && (
          <button className="primary" onClick={() => open(null)}>
            {' '}
            {t(
              kind === 'departments' ? 'configuration:add_department' : 'configuration:add_service',
            )}
          </button>
        )}
      </div>
      <p className="notice configuration-scope">
        {' '}
        {t(
          'configuration:prices_apply_to_new_invoices_existing_invoices_keep_their_recorded_prices',
        )}{' '}
      </p>
      {notice && (
        <p role="status" className="notice">
          {interfaceMessage(notice)}
        </p>
      )}
      {editing ? (
        <div className="configuration-editor">
          <form className="panel configuration-form" onSubmit={save}>
            <h2 ref={heading} tabIndex={-1}>
              {t(
                selected
                  ? kind === 'departments'
                    ? 'configuration:edit_department'
                    : 'configuration:edit_service'
                  : kind === 'departments'
                    ? 'configuration:add_department'
                    : 'configuration:add_service',
              )}
            </h2>
            {error && (
              <p role="alert" className="notice error">
                {interfaceMessage(error)}
              </p>
            )}
            {overlaps.length > 0 && (
              <section
                aria-label={t('configuration:current_values_for_overlapping_edits')}
                className="notice warning"
              >
                <h3>{t('configuration:current_values_for_overlapping_edits')}</h3>
                <p>
                  {' '}
                  {t(
                    'configuration:your_edited_fields_are_retained_below_compare_these_current_values_before_saving',
                  )}{' '}
                </p>
                <ul>
                  {overlaps.map((value) => (
                    <li key={value}>{interfaceMessage(value)}</li>
                  ))}
                </ul>
              </section>
            )}
            <fieldset disabled={locked}>
              <legend className="sr-only">{t('configuration:configuration_details')}</legend>
              <label htmlFor="configuration-code">{t('configuration:stable_code')}</label>
              <input
                id="configuration-code"
                value={code}
                required
                minLength={2}
                maxLength={32}
                readOnly={Boolean(selected)}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                aria-describedby="configuration-code-help"
              />
              <p id="configuration-code-help" className="muted">
                {' '}
                {t(
                  'configuration:start_with_a_letter_use_uppercase_letters_digits_hyphens_or_underscores_a_saved_code_cannot_cha',
                )}{' '}
              </p>
              <label htmlFor="configuration-name">
                {kind === 'departments' ? t('configuration:department') : t('common:service')}{' '}
                {t('configuration:name')}{' '}
              </label>
              <input
                id="configuration-name"
                value={name}
                required
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
              {kind === 'services' && (
                <>
                  <label htmlFor="configuration-department-search">
                    {t('configuration:find_department')}
                  </label>
                  <input
                    id="configuration-department-search"
                    type="search"
                    value={departmentSearch}
                    maxLength={120}
                    onChange={(event) => {
                      setDepartmentSearch(event.target.value);
                      setDepartmentPage(1);
                    }}
                    aria-describedby="department-search-help"
                  />
                  <p id="department-search-help" className="muted">
                    {' '}
                    {t(
                      'configuration:search_active_departments_by_name_or_code_browse_25_results_per_page_your_selected_department_s',
                    )}{' '}
                  </p>
                  {departmentError && (
                    <p role="alert">
                      {interfaceMessage(departmentError)}{' '}
                      <button type="button" onClick={() => setRefresh((value) => value + 1)}>
                        {' '}
                        {t('configuration:retry_departments')}{' '}
                      </button>
                    </p>
                  )}
                  <label htmlFor="configuration-department">{t('configuration:department')}</label>
                  <select
                    id="configuration-department"
                    value={departmentId}
                    required
                    disabled={departmentLoading || Boolean(departmentError)}
                    onChange={(event) => {
                      setDepartmentId(event.target.value);
                      setChosenDepartment(
                        event.target.value
                          ? (departments.find((row) => row.id === event.target.value) ??
                              chosenDepartment)
                          : null,
                      );
                    }}
                  >
                    <option value="">{t('configuration:choose_a_department')}</option>
                    {chosenDepartment &&
                      !departments.some((row) => row.id === chosenDepartment.id) && (
                        <option value={chosenDepartment.id}>
                          {chosenDepartment.name} · {chosenDepartment.code}
                          {!chosenDepartment.active ? t('configuration:inactive_2') : ''}
                        </option>
                      )}
                    {departments.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name} · {row.code}
                      </option>
                    ))}
                  </select>
                  <div className="configuration-department-pages">
                    <p role="status" className="muted">
                      {departmentLoading
                        ? t('configuration:loading_departments')
                        : departmentError
                          ? t('configuration:department_results_unavailable')
                          : departmentTotal
                            ? t('dynamic:active_departments', {
                                count: departmentTotal,
                                page: departmentPage,
                                pages: Math.ceil(departmentTotal / 25),
                              })
                            : departmentSearch
                              ? t('configuration:no_active_departments_match_this_search')
                              : t(
                                  'configuration:no_active_departments_are_available_add_or_reactivate_a_department_first',
                                )}
                    </p>
                    <div className="button-row">
                      <button
                        type="button"
                        disabled={departmentLoading || departmentPage === 1}
                        onClick={() => setDepartmentPage((value) => value - 1)}
                      >
                        {' '}
                        {t('configuration:previous_departments')}{' '}
                      </button>
                      <button
                        type="button"
                        disabled={
                          departmentLoading ||
                          Boolean(departmentError) ||
                          departmentPage * 25 >= departmentTotal
                        }
                        onClick={() => setDepartmentPage((value) => value + 1)}
                      >
                        {' '}
                        {t('configuration:next_departments')}{' '}
                      </button>
                    </div>
                  </div>
                  <label htmlFor="configuration-price">{t('configuration:price_etb')}</label>
                  <input
                    id="configuration-price"
                    inputMode="decimal"
                    value={price}
                    required
                    maxLength={10}
                    onChange={(event) => setPrice(event.target.value)}
                    aria-describedby="configuration-price-help"
                  />
                  <p id="configuration-price-help" className="muted">
                    {' '}
                    {t('configuration:0_00_9999999_99_etb_with_at_most_two_decimal_places')}{' '}
                  </p>
                </>
              )}
              {selected && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(event) => setActive(event.target.checked)}
                  />{' '}
                  {t(
                    kind === 'departments'
                      ? 'configuration:active_department'
                      : 'configuration:active_service',
                  )}
                </label>
              )}
              {kind === 'departments' && selected && (
                <p className="muted">
                  {' '}
                  {t(
                    'configuration:an_inactive_department_hides_its_services_from_the_active_catalog_history_is_retained',
                  )}{' '}
                </p>
              )}
            </fieldset>
            {pending && !busy && (
              <p className="notice warning" role="status">
                {' '}
                {t(
                  'configuration:the_save_is_unconfirmed_retry_the_same_details_and_request_key_before_leaving',
                )}{' '}
              </p>
            )}
            <div className="button-row">
              <button className="primary" disabled={busy}>
                {busy
                  ? t('configuration:saving_configuration')
                  : pending
                    ? t('configuration:retry_configuration_save')
                    : t('configuration:save_configuration')}
              </button>
              <button type="button" disabled={locked} onClick={close}>
                {' '}
                {t('configuration:back_to_catalog')}{' '}
              </button>
              {error && selected && !locked && (
                <button type="button" onClick={() => void reloadRevision()}>
                  {' '}
                  {t('common:reload_current_revision')}{' '}
                </button>
              )}
            </div>
          </form>
          {selected && (
            <section
              className="panel configuration-history"
              aria-label={t('configuration:configuration_history')}
            >
              <h2>{t('configuration:change_history')}</h2>
              {historyError ? (
                <>
                  <p role="alert">{interfaceMessage(historyError)}</p>
                  <button onClick={() => setHistoryRefresh((value) => value + 1)}>
                    {' '}
                    {t('common:retry_history')}{' '}
                  </button>
                </>
              ) : !history ? (
                <p role="status">{t('common:loading_history')}</p>
              ) : (
                <>
                  <ol>
                    {history.events.map((event) => (
                      <li key={event.id}>
                        <strong>
                          {' '}
                          {t('common:revision_2')} {event.revision} · {event.snapshot.name}
                        </strong>
                        <p>
                          {event.snapshot.active ? t('common:active') : t('common:inactive')}
                          {'priceMinor' in event.snapshot &&
                            ` · ${formatETB(event.snapshot.priceMinor)} ETB · ${event.snapshot.departmentName} (${event.snapshot.departmentCode})`}
                        </p>
                        <p className="muted">
                          {event.actorName} ·{' '}
                          <time dateTime={event.createdAt}>{hospitalDate(event.createdAt)}</time>
                        </p>
                      </li>
                    ))}
                  </ol>
                  <div className="button-row">
                    <button
                      disabled={historyPage === 1 || locked}
                      onClick={() => setHistoryPage((value) => value - 1)}
                    >
                      {' '}
                      {t('common:newer_history')}{' '}
                    </button>
                    <button
                      disabled={historyPage * 25 >= history.total || locked}
                      onClick={() => setHistoryPage((value) => value + 1)}
                    >
                      {' '}
                      {t('common:older_history')}{' '}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      ) : (
        <section className="panel configuration-directory">
          <nav className="button-row" aria-label={t('configuration:catalog_sections')}>
            <button
              aria-current={kind === 'services' ? 'page' : undefined}
              onClick={() => {
                setKind('services');
                setPage(1);
                setQuery('');
                setSearch('');
              }}
            >
              {' '}
              {t('configuration:services')}{' '}
            </button>
            <button
              aria-current={kind === 'departments' ? 'page' : undefined}
              onClick={() => {
                setKind('departments');
                setPage(1);
                setQuery('');
                setSearch('');
              }}
            >
              {' '}
              {t('configuration:departments')}{' '}
            </button>
          </nav>
          <form
            className="staff-search"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search.trim());
              setPage(1);
              setRefresh((value) => value + 1);
            }}
          >
            <div>
              <label htmlFor="configuration-search">
                {t('common:search')} {presentationLabel(kind)} {t('configuration:by_name_or_code')}
              </label>
              <input
                id="configuration-search"
                type="search"
                value={search}
                maxLength={120}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button disabled={loading}>{t('configuration:search_catalog')}</button>
          </form>
          {loading ? (
            <p role="status">{t('configuration:loading_catalog')}</p>
          ) : loadError ? (
            <>
              <p role="alert">{interfaceMessage(loadError)}</p>
              <button onClick={() => setRefresh((value) => value + 1)}>
                {t('configuration:retry_catalog')}
              </button>
            </>
          ) : !list?.entries.length ? (
            <p>
              {' '}
              {t('common:no')} {presentationLabel(kind)}{' '}
              {query
                ? t('configuration:match_this_search')
                : admin
                  ? t('configuration:have_been_configured_yet')
                  : t('configuration:are_currently_available')}
              {admin && kind === 'services' && !query
                ? t('configuration:add_a_department_first_then_add_its_services')
                : ''}
            </p>
          ) : (
            <>
              <div
                className="table-region"
                role="region"
                aria-label={t('dynamic:catalog_label', { kind: presentationLabel(kind) })}
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>{t('configuration:name_2')}</th>
                      <th>{t('configuration:code')}</th>
                      {kind === 'services' && (
                        <>
                          <th>{t('configuration:department')}</th>
                          <th>{t('configuration:price_etb')}</th>
                        </>
                      )}
                      <th>{t('common:status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          {admin ? (
                            <button className="patient-visit-link" onClick={() => open(entry)}>
                              {entry.name}
                            </button>
                          ) : (
                            entry.name
                          )}
                        </td>
                        <td>{entry.code}</td>
                        {'priceMinor' in entry && (
                          <>
                            <td>{entry.departmentName}</td>
                            <td className="configuration-money">{formatETB(entry.priceMinor)}</td>
                          </>
                        )}
                        <td>
                          {entry.active
                            ? 'departmentActive' in entry && !entry.departmentActive
                              ? t('configuration:department_inactive')
                              : t('common:active')
                            : t('common:inactive')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="staff-pagination">
                <p role="status">
                  {list.total} {presentationLabel(kind)} {t('common:page_2')} {page}
                </p>
                <div className="button-row">
                  <button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
                    {' '}
                    {t('common:previous')}{' '}
                  </button>
                  <button
                    disabled={page * 25 >= list.total}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    {' '}
                    {t('common:next')}{' '}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </section>
  );
}
