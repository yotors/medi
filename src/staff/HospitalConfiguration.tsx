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
    return error instanceof Error ? error.message : 'The request failed. Please retry.';
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
    if (locked || (dirty && !window.confirm('Discard unsaved configuration details?'))) return;
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
          conflicts.push(`Name: ${entry.name}`);
        if (active === baseline.active) setActive(entry.active);
        else if (entry.active !== baseline.active && active !== entry.active)
          conflicts.push(`Availability: ${entry.active ? 'Active' : 'Inactive'}`);
        if ('priceMinor' in baseline && 'priceMinor' in entry) {
          if (parseETB(price) === baseline.priceMinor) setPrice(formatETB(entry.priceMinor));
          else if (entry.priceMinor !== baseline.priceMinor && parseETB(price) !== entry.priceMinor)
            conflicts.push(`Price: ${formatETB(entry.priceMinor)} ETB`);
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
            conflicts.push(`Department: ${entry.departmentName} (${entry.departmentCode})`);
        }
        setOverlaps(conflicts);
        setSelected(entry);
        setError(
          'Current revision loaded. Your draft is retained; untouched fields now use current values. Review before saving.',
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
      setError('Enter an ETB amount from 0.00 to 9999999.99 with at most two decimal places.');
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
        'Check the name, department and code. Codes use 2–32 uppercase letters, digits, hyphens or underscores and start with a letter.',
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
      setNotice('Configuration saved. Earlier versions remain in history.');
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
            {admin ? 'Hospital configuration' : 'Service catalog'}
          </h1>
          <p className="muted">{session.user.hospital.name} · Departments and ETB services</p>
        </div>
        {admin && !editing && (
          <button className="primary" onClick={() => open(null)}>
            Add {kind === 'departments' ? 'department' : 'service'}
          </button>
        )}
      </div>
      <p className="notice configuration-scope">
        Prices apply to new invoices. Existing invoices keep their recorded prices.
      </p>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {editing ? (
        <div className="configuration-editor">
          <form className="panel configuration-form" onSubmit={save}>
            <h2 ref={heading} tabIndex={-1}>
              {selected ? 'Edit' : 'Add'} {kind === 'departments' ? 'department' : 'service'}
            </h2>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            {overlaps.length > 0 && (
              <section aria-label="Current values for overlapping edits" className="notice warning">
                <h3>Current values for overlapping edits</h3>
                <p>
                  Your edited fields are retained below. Compare these current values before saving.
                </p>
                <ul>
                  {overlaps.map((value) => (
                    <li key={value}>{value}</li>
                  ))}
                </ul>
              </section>
            )}
            <fieldset disabled={locked}>
              <legend className="sr-only">Configuration details</legend>
              <label htmlFor="configuration-code">Stable code</label>
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
                Start with a letter; use uppercase letters, digits, hyphens or underscores. A saved
                code cannot change.
              </p>
              <label htmlFor="configuration-name">
                {kind === 'departments' ? 'Department' : 'Service'} name
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
                  <label htmlFor="configuration-department-search">Find department</label>
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
                    Search active departments by name or code. Browse 25 results per page; your
                    selected department stays selected.
                  </p>
                  {departmentError && (
                    <p role="alert">
                      {departmentError}{' '}
                      <button type="button" onClick={() => setRefresh((value) => value + 1)}>
                        Retry departments
                      </button>
                    </p>
                  )}
                  <label htmlFor="configuration-department">Department</label>
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
                    <option value="">Choose a department</option>
                    {chosenDepartment &&
                      !departments.some((row) => row.id === chosenDepartment.id) && (
                        <option value={chosenDepartment.id}>
                          {chosenDepartment.name} · {chosenDepartment.code}
                          {!chosenDepartment.active ? ' (inactive)' : ''}
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
                        ? 'Loading departments…'
                        : departmentError
                          ? 'Department results unavailable.'
                          : departmentTotal
                            ? `${departmentTotal} active department${departmentTotal === 1 ? '' : 's'} · Page ${departmentPage} of ${Math.ceil(departmentTotal / 25)}`
                            : departmentSearch
                              ? 'No active departments match this search.'
                              : 'No active departments are available. Add or reactivate a department first.'}
                    </p>
                    <div className="button-row">
                      <button
                        type="button"
                        disabled={departmentLoading || departmentPage === 1}
                        onClick={() => setDepartmentPage((value) => value - 1)}
                      >
                        Previous departments
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
                        Next departments
                      </button>
                    </div>
                  </div>
                  <label htmlFor="configuration-price">Price (ETB)</label>
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
                    0.00–9999999.99 ETB, with at most two decimal places.
                  </p>
                </>
              )}
              {selected && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(event) => setActive(event.target.checked)}
                  />
                  Active {kind === 'departments' ? 'department' : 'service'}
                </label>
              )}
              {kind === 'departments' && selected && (
                <p className="muted">
                  An inactive department hides its services from the active catalog. History is
                  retained.
                </p>
              )}
            </fieldset>
            {pending && !busy && (
              <p className="notice warning" role="status">
                The save is unconfirmed. Retry the same details and request key before leaving.
              </p>
            )}
            <div className="button-row">
              <button className="primary" disabled={busy}>
                {busy
                  ? 'Saving configuration…'
                  : pending
                    ? 'Retry configuration save'
                    : 'Save configuration'}
              </button>
              <button type="button" disabled={locked} onClick={close}>
                Back to catalog
              </button>
              {error && selected && !locked && (
                <button type="button" onClick={() => void reloadRevision()}>
                  Reload current revision
                </button>
              )}
            </div>
          </form>
          {selected && (
            <section className="panel configuration-history" aria-label="Configuration history">
              <h2>Change history</h2>
              {historyError ? (
                <>
                  <p role="alert">{historyError}</p>
                  <button onClick={() => setHistoryRefresh((value) => value + 1)}>
                    Retry history
                  </button>
                </>
              ) : !history ? (
                <p role="status">Loading history…</p>
              ) : (
                <>
                  <ol>
                    {history.events.map((event) => (
                      <li key={event.id}>
                        <strong>
                          Revision {event.revision} · {event.snapshot.name}
                        </strong>
                        <p>
                          {event.snapshot.active ? 'Active' : 'Inactive'}
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
                      Newer history
                    </button>
                    <button
                      disabled={historyPage * 25 >= history.total || locked}
                      onClick={() => setHistoryPage((value) => value + 1)}
                    >
                      Older history
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      ) : (
        <section className="panel configuration-directory">
          <nav className="button-row" aria-label="Catalog sections">
            <button
              aria-current={kind === 'services' ? 'page' : undefined}
              onClick={() => {
                setKind('services');
                setPage(1);
                setQuery('');
                setSearch('');
              }}
            >
              Services
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
              Departments
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
              <label htmlFor="configuration-search">Search {kind} by name or code</label>
              <input
                id="configuration-search"
                type="search"
                value={search}
                maxLength={120}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button disabled={loading}>Search catalog</button>
          </form>
          {loading ? (
            <p role="status">Loading catalog…</p>
          ) : loadError ? (
            <>
              <p role="alert">{loadError}</p>
              <button onClick={() => setRefresh((value) => value + 1)}>Retry catalog</button>
            </>
          ) : !list?.entries.length ? (
            <p>
              No {kind}{' '}
              {query
                ? 'match this search.'
                : admin
                  ? 'have been configured yet.'
                  : 'are currently available.'}
              {admin && kind === 'services' && !query
                ? ' Add a department first, then add its services.'
                : ''}
            </p>
          ) : (
            <>
              <div
                className="table-region"
                role="region"
                aria-label={`${kind} catalog`}
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Code</th>
                      {kind === 'services' && (
                        <>
                          <th>Department</th>
                          <th>Price (ETB)</th>
                        </>
                      )}
                      <th>Status</th>
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
                              ? 'Department inactive'
                              : 'Active'
                            : 'Inactive'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="staff-pagination">
                <p role="status">
                  {list.total} {kind} · Page {page}
                </p>
                <div className="button-row">
                  <button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
                    Previous
                  </button>
                  <button
                    disabled={page * 25 >= list.total}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next
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
