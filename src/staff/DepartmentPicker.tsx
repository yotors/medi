import { useEffect, useState } from 'react';
import type {
  DepartmentChoice,
  DepartmentSourceQuery,
  DepartmentSources,
} from '../../shared/departments';
import type { Session } from '../../shared/registration';
import { request } from './api';
type Props = {
  label: string;
  kind: DepartmentSourceQuery['kind'];
  session: Session;
  value: string;
  selectedLabel?: string;
  context?: Partial<DepartmentSourceQuery>;
  disabled: boolean;
  required?: boolean;
  onChoose: (choice: DepartmentChoice) => void;
  onError: (error: unknown) => void;
  automatic?: boolean;
};
export default function DepartmentPicker({
  label,
  kind,
  session,
  value,
  selectedLabel,
  context = {},
  disabled,
  required = true,
  onChoose,
  onError,
  automatic = false,
}: Props) {
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0),
    [data, setData] = useState<DepartmentSources | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const contextKey = JSON.stringify(context);
  const ident = `pick-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  useEffect(() => {
    setPage(1);
    setQuery('');
    setSearch('');
    setData(null);
  }, [kind, contextKey, session.csrfToken]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    request<DepartmentSources>('/api/departments/sources', {
      method: 'POST',
      headers: { 'X-CSRF-Token': session.csrfToken },
      body: JSON.stringify({ kind, q: search, page, ...JSON.parse(contextKey) }),
    })
      .then((result) => {
        if (!live) return;
        setData(result);
        if (automatic && result.entries.length === 1 && !value) onChoose(result.entries[0]);
      })
      .catch((err) => {
        if (live) {
          setError(err.message);
          onError(err);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [kind, contextKey, search, page, retry, session.csrfToken]);
  return (
    <fieldset className="department-picker">
      <legend>{label}</legend>
      <div className="department-choice-search">
        <label htmlFor={`${ident}-search`}>
          Find {label.toLowerCase()}
          <input
            id={`${ident}-search`}
            maxLength={100}
            disabled={disabled}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, MRN, code or reference"
          />
        </label>
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => {
            setSearch(query.trim());
            setPage(1);
            setRetry((n) => n + 1);
          }}
        >
          Find choices for {label.toLowerCase()}
        </button>
      </div>
      <label htmlFor={ident}>{label}</label>
      <select
        id={ident}
        required={required}
        disabled={disabled || loading}
        value={value}
        onChange={(e) => {
          const choice = data?.entries.find((c) => c.id === e.target.value);
          if (choice) onChoose(choice);
        }}
      >
        <option value="">Choose {label.toLowerCase()}</option>
        {value && !data?.entries.some((c) => c.id === value) && (
          <option value={value}>
            {selectedLabel ?? 'Previously selected record — refresh and review'}
          </option>
        )}
        {data?.entries.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
      {loading && <p role="status">Loading {label.toLowerCase()} choices…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !data?.entries.length && (
        <p>No eligible matching {label.toLowerCase()} found.</p>
      )}
      <div className="button-row">
        <span>
          Page {page} · {data?.total ?? 0} choices
        </span>
        <button
          type="button"
          disabled={disabled || loading || page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous {label.toLowerCase()} choices
        </button>
        <button
          type="button"
          disabled={disabled || loading || !data || page * 25 >= data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Next {label.toLowerCase()} choices
        </button>
        <button type="button" disabled={disabled || loading} onClick={() => setRetry((n) => n + 1)}>
          Refresh {label.toLowerCase()} choices
        </button>
      </div>
    </fieldset>
  );
}
