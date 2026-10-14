import { choiceLabel } from './choice-label';
import { interfaceMessage } from '../i18n';
import { t, formatNumber } from '../i18n';
import { useEffect, useState, useId } from 'react';
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
  const ident = useId();
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
          {' '}
          {t('departments:find_label', { label: label.toLowerCase() })}
          <input
            id={`${ident}-search`}
            maxLength={100}
            disabled={disabled}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('departments:name_mrn_code_or_reference')}
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
          {' '}
          {t('departments:find_choices_label', { label: label.toLowerCase() })}
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
        <option value="">{t('departments:choose_label', { label: label.toLowerCase() })}</option>
        {value && !data?.entries.some((c) => c.id === value) && (
          <option value={value}>
            {selectedLabel ?? t('departments:previously_selected_record_refresh_and_review')}
          </option>
        )}
        {data?.entries.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choiceLabel(choice)}
          </option>
        ))}
      </select>
      {loading && (
        <p role="status">{t('departments:loading_label', { label: label.toLowerCase() })}</p>
      )}
      {error && <p role="alert">{interfaceMessage(error)}</p>}
      {!loading && !error && !data?.entries.length && (
        <p>{t('departments:no_choices_label', { label: label.toLowerCase() })}</p>
      )}
      <div className="button-row">
        <span>
          {' '}
          {t('departments:choices_page', {
            page: formatNumber(page),
            total: formatNumber(data?.total ?? 0),
          })}{' '}
        </span>
        <button
          type="button"
          disabled={disabled || loading || page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          {' '}
          {t('departments:previous_label', { label: label.toLowerCase() })}{' '}
        </button>
        <button
          type="button"
          disabled={disabled || loading || !data || page * 25 >= data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          {' '}
          {t('departments:next_label', { label: label.toLowerCase() })}{' '}
        </button>
        <button type="button" disabled={disabled || loading} onClick={() => setRetry((n) => n + 1)}>
          {' '}
          {t('departments:refresh_label', { label: label.toLowerCase() })}{' '}
        </button>
      </div>
    </fieldset>
  );
}
