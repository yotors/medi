import { uiMessage } from '../i18n';
import { presentationLabel } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
import { formatHospitalDate, type HospitalAppearance } from '../../shared/hospital-format';
import { useEffect, useState } from 'react';
import type { Session, PatientPage } from '../../shared/registration';
import { exportTables, type HospitalCommand, type HospitalOverview } from '../../shared/hospital';
import { ApiError, request } from './api';
type Props = {
  session: Session;
  onSessionError: (error: unknown) => void;
  onDirty: (value: boolean) => void;
  onPending: (value: boolean) => void;
};
export default function HospitalWorkspace({ session, onSessionError, onDirty, onPending }: Props) {
  const [overview, setOverview] = useState<HospitalOverview | null>(null),
    [tab, setTab] = useState('Facilities'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(''),
    [pending, setPending] = useState<{ key: string; command: HospitalCommand } | null>(null);
  const [patients, setPatients] = useState<PatientPage['patients']>([]),
    [search, setSearch] = useState(''),
    [patient, setPatient] = useState(''),
    [table, setTable] = useState<(typeof exportTables)[number]>('patients'),
    [page, setPage] = useState('1'),
    [facility, setFacility] = useState('');
  const admin = session.user.role === 'admin';
  const appearance = overview?.profile.settings as Partial<HospitalAppearance> | undefined;
  const change = (key: string, value: string) => setFields((f) => ({ ...f, [key]: value }));
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) onSessionError(e);
    else
      setError(
        e instanceof Error ? e.message : t('configuration:the_action_could_not_be_completed'),
      );
  };
  async function load() {
    try {
      setOverview(await request<HospitalOverview>('/api/hospital'));
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      onDirty(false);
      onPending(false);
    };
  }, [session.csrfToken]);
  useEffect(() => {
    onDirty(
      Object.values(fields).some(Boolean) || Boolean(reason) || Boolean(patient) || Boolean(search),
    );
    onPending(Boolean(pending));
  }, [fields, reason, pending, patient, search]);
  async function save(command: HospitalCommand) {
    setBusy(true);
    setError('');
    setNotice('');
    const operation = pending ?? { key: crypto.randomUUID(), command };
    setPending(operation);
    try {
      await request('/api/hospital/commands', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': operation.key },
        body: JSON.stringify(operation.command),
      });
      setPending(null);
      setFacility('');
      setFields({});
      setPatient('');
      setSearch('');
      setReason('');
      setNotice(uiMessage('configuration:saved_the_action_is_recorded_in_hospital_history'));
      window.dispatchEvent(new Event('hospital-appearance-changed'));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status > 0 && e.status < 500) setPending(null);
      if (e instanceof ApiError && e.status === 409) await load();
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  function switchTab(next: string) {
    if (pending) return;
    if (
      (reason || patient || search || Object.values(fields).some(Boolean)) &&
      !window.confirm(t('configuration:discard_the_changes_in_this_form'))
    )
      return;
    setFields({});
    setFacility('');
    setPatient('');
    setSearch('');
    setReason('');
    setError('');
    setNotice('');
    setTab(next);
  }
  const input = (key: string, label: string, required = true, type = 'text') => (
    <div>
      <label htmlFor={'hospital-' + key}>{t(label)}</label>
      <input
        id={'hospital-' + key}
        type={type}
        value={fields[key] ?? ''}
        onChange={(e) => change(key, e.target.value)}
        required={required}
        maxLength={
          key === 'address' || key === 'purpose' || key === 'verification'
            ? 500
            : key === 'code'
              ? 32
              : key === 'name'
                ? 120
                : key === 'phone'
                  ? 100
                  : 150
        }
        min={type === 'number' ? 5 : undefined}
        max={type === 'number' ? 240 : undefined}
        disabled={busy || Boolean(pending)}
      />
    </div>
  );
  const reasonField = (
    <div>
      <label htmlFor="hospital-reason">{t('configuration:reason_2')}</label>
      <textarea
        id="hospital-reason"
        required
        maxLength={500}
        value={reason}
        disabled={busy || Boolean(pending)}
        onChange={(e) => setReason(e.target.value)}
      />
    </div>
  );
  const saveButton = (
    <button className="primary" disabled={busy}>
      {busy
        ? t('common:saving')
        : pending
          ? t('configuration:retry_unchanged_request')
          : t('configuration:save')}
    </button>
  );
  function download(data: unknown, label: string) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'medi-' + label + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportData(path: string, body: unknown, label: string) {
    setBusy(true);
    setError('');
    try {
      let next = 1;
      let more = true;
      while (more) {
        const data = await request<{ hasMore?: boolean | Record<string, boolean> }>(path, {
          method: 'POST',
          headers: { 'X-CSRF-Token': session.csrfToken },
          body: JSON.stringify({
            ...(body as object),
            ...(path.endsWith('record-export') ? { page: next } : {}),
          }),
        });
        download(data, label + '-' + next);
        more =
          path.endsWith('record-export') &&
          typeof data.hasMore === 'object' &&
          Object.values(data.hasMore).some(Boolean);
        next++;
      }
      setNotice(
        uiMessage('configuration:export_downloaded_keep_it_in_an_approved_secure_location'),
      );
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  if (!overview)
    return (
      <section className="panel">
        <h1>{t('configuration:hospital_management')}</h1>
        {error ? (
          <>
            <p role="alert">{interfaceMessage(error)}</p>
            <button onClick={() => void load()}>{t('common:retry_loading')}</button>
          </>
        ) : (
          <p role="status">{t('configuration:loading_hospital_settings')}</p>
        )}
      </section>
    );
  return (
    <section aria-labelledby="hospital-heading">
      <h1 id="hospital-heading">{t('configuration:hospital_management')}</h1>
      <p className="muted">
        {t('configuration:facilities_governed_record_requests_and_approved_support_access')}
      </p>
      <nav
        className="staff-navigation"
        aria-label={t('configuration:hospital_management_sections')}
      >
        {[
          'Facilities',
          'Organization',
          'Record requests',
          'Record holds',
          'Support access',
          'Exports',
        ].map((t) => (
          <button
            key={t}
            aria-pressed={tab === t}
            disabled={busy || Boolean(pending)}
            onClick={() => switchTab(t)}
          >
            {interfaceMessage(t)}
          </button>
        ))}
      </nav>
      {error && (
        <p className="notice error" role="alert">
          {interfaceMessage(error)}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {interfaceMessage(notice)}
        </p>
      )}
      {pending && !busy && (
        <div className="notice warning">
          <p>
            {t(
              'configuration:the_save_is_uncertain_retry_the_original_request_before_changing_this_form',
            )}
          </p>
          <button onClick={() => void save(pending.command)}>
            {t('configuration:retry_original_request')}
          </button>
        </div>
      )}
      {tab === 'Facilities' && (
        <>
          <section className="panel">
            <h2>{t('configuration:facilities')}</h2>
            {overview.facilities.length ? (
              overview.facilities.map((f) => (
                <div className="order-card" key={f.id}>
                  <h3>{f.name}</h3>
                  <p>
                    {f.code} · {f.address || t('configuration:address_not_entered')} ·{' '}
                    {f.active ? t('common:active') : t('common:inactive')}
                  </p>
                  {admin && (
                    <button
                      disabled={busy || Boolean(pending)}
                      onClick={() => {
                        setFacility(f.id);
                        setFields({ name: f.name, address: f.address, active: String(f.active) });
                      }}
                    >
                      {' '}
                      {t('configuration:edit_facility')}{' '}
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p className="empty-small">{t('configuration:no_facilities_configured')}</p>
            )}
          </section>
          {admin && (
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                const current = overview.facilities.find((f) => f.id === facility);
                void save(
                  current
                    ? {
                        type: 'facility.update',
                        id: current.id,
                        expectedRevision: current.revision,
                        name: fields.name ?? '',
                        address: fields.address ?? '',
                        active: fields.active !== 'false',
                        reason,
                      }
                    : {
                        type: 'facility.create',
                        code: fields.code ?? '',
                        name: fields.name ?? '',
                        address: fields.address ?? '',
                        reason,
                      },
                );
              }}
            >
              <h2>
                {facility ? t('configuration:edit_facility') : t('configuration:add_facility')}
              </h2>
              {!facility && input('code', 'labels:facility_code')}
              {facility && (
                <>
                  <label htmlFor="hospital-facility-active">
                    {t('configuration:facility_availability')}
                  </label>
                  <select
                    id="hospital-facility-active"
                    disabled={busy || Boolean(pending)}
                    value={fields.active ?? 'true'}
                    onChange={(e) => change('active', e.target.value)}
                  >
                    <option value="true">{t('common:active')}</option>
                    <option value="false">{t('common:inactive')}</option>
                  </select>
                </>
              )}
              {input('name', 'labels:facility_name')}
              {input('address', 'labels:address', false)}
              {reasonField}
              {saveButton}
            </form>
          )}
        </>
      )}
      {tab === 'Organization' && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void save({
              type: 'profile.update',
              expectedRevision: overview.profile.revision,
              name: fields.name ?? overview.profile.name,
              phone: fields.phone ?? overview.profile.settings.phone ?? '',
              address: fields.address ?? overview.profile.settings.address ?? '',
              locale: (fields.locale ?? overview.profile.settings.locale ?? 'en-ET') as
                'en-ET' | 'am-ET',
              calendar: (fields.calendar ?? overview.profile.settings.calendar ?? 'gregory') as
                'gregory' | 'ethiopic',
              timezone: 'Africa/Addis_Ababa',
              reason,
            });
          }}
        >
          <h2>{t('configuration:organization_settings')}</h2>
          <p>
            {t('configuration:current_name')} {overview.profile.name}
          </p>
          {admin ? (
            <>
              {
                <div>
                  <label htmlFor="hospital-name">{t('configuration:organization_name')}</label>
                  <input
                    id="hospital-name"
                    required
                    maxLength={100}
                    value={fields.name ?? overview.profile.name}
                    disabled={busy || Boolean(pending)}
                    onChange={(e) => change('name', e.target.value)}
                  />
                </div>
              }
              {input('phone', 'labels:telephone', false)}
              {input('address', 'labels:address', false)}
              <label htmlFor="hospital-locale">{t('configuration:preferred_record_locale')}</label>
              <select
                disabled={busy || Boolean(pending)}
                id="hospital-locale"
                value={fields.locale ?? overview.profile.settings.locale ?? 'en-ET'}
                onChange={(e) => change('locale', e.target.value)}
              >
                <option value="en-ET">{t('configuration:english_ethiopia')}</option>
                <option value="am-ET">{t('configuration:amharic_ethiopia')}</option>
              </select>
              <label htmlFor="hospital-calendar">{t('configuration:display_calendar')}</label>
              <select
                disabled={busy || Boolean(pending)}
                id="hospital-calendar"
                value={fields.calendar ?? overview.profile.settings.calendar ?? 'gregory'}
                onChange={(e) => change('calendar', e.target.value)}
              >
                <option value="gregory">{t('configuration:gregorian_2')}</option>
                <option value="ethiopic">{t('configuration:ethiopian')}</option>
              </select>
              <p className="muted">
                {' '}
                {t(
                  'configuration:timezone_africa_addis_ababa_date_entry_controls_use_gregorian_dates_exports_keep_original_iso_t',
                )}{' '}
              </p>
              {reasonField}
              {saveButton}
            </>
          ) : (
            <p>{t('configuration:organization_changes_require_an_administrator')}</p>
          )}
        </form>
      )}
      {['Record requests', 'Record holds'].includes(tab) && (
        <>
          <section className="panel">
            <h2>{interfaceMessage(tab)}</h2>
            {(tab === 'Record requests' ? overview.requests : overview.holds).map((r) => (
              <div className="order-card" key={r.id}>
                {'requester' in r ? (
                  <>
                    <h3>{r.requester}</h3>
                    <p>
                      {r.purpose} · {presentationLabel(r.status)}
                    </p>
                    <p>
                      {t('configuration:identity_and_authority_verification')}{' '}
                      {r.identity_verification}
                    </p>
                    <p>
                      {t('configuration:requested')} {formatHospitalDate(r.created_at, appearance)}
                    </p>
                    {admin &&
                      r.status === 'pending' &&
                      ['approved', 'denied'].map((status) => (
                        <button
                          key={status}
                          disabled={busy || Boolean(pending)}
                          onClick={() => {
                            const why = window.prompt(t('common:decision_reason'));
                            if (why)
                              void save({
                                type: 'record.decide',
                                id: r.id,
                                expectedRevision: r.revision,
                                status: status as 'approved' | 'denied',
                                reason: why,
                              });
                          }}
                        >
                          {status === 'approved'
                            ? t('configuration:approve')
                            : t('configuration:deny')}
                        </button>
                      ))}
                    {admin && ['approved', 'fulfilled'].includes(r.status) && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void exportData(
                            '/api/hospital/record-export',
                            {
                              requestId: r.id,
                              get reason() {
                                return t('labels:approved_record_request_fulfillment');
                              },
                            },
                            'patient-record',
                          )
                        }
                      >
                        {' '}
                        {t('configuration:download_approved_record')}{' '}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <h3>{t('configuration:record_hold')}</h3>
                    <p>
                      {r.reason} · {r.active ? t('common:active') : t('configuration:released')}
                    </p>
                    {admin && r.active && (
                      <button
                        onClick={() => {
                          const why = window.prompt(t('common:release_hold_reason'));
                          if (why)
                            void save({
                              type: 'hold.release',
                              id: r.id,
                              expectedRevision: r.revision,
                              reason: why,
                            });
                        }}
                      >
                        {' '}
                        {t('configuration:release_hold')}{' '}
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
            {!(tab === 'Record requests' ? overview.requests : overview.holds).length && (
              <p className="empty-small">{t('configuration:no_records_in_this_list')}</p>
            )}
          </section>
          {admin && (
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                void save(
                  tab === 'Record requests'
                    ? {
                        type: 'record.request',
                        patientId: patient,
                        requester: fields.requester ?? '',
                        purpose: fields.purpose ?? '',
                        identityVerification: fields.verification ?? '',
                        reason,
                      }
                    : { type: 'hold.place', patientId: patient, reason },
                );
              }}
            >
              <h2>
                {tab === 'Record requests'
                  ? t('configuration:new_record_request')
                  : t('configuration:place_retention_hold')}
              </h2>
              <label htmlFor="hospital-patient-search">{t('configuration:find_patient')}</label>
              <div className="button-row">
                <input
                  disabled={busy || Boolean(pending)}
                  id="hospital-patient-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  maxLength={100}
                />
                <button
                  type="button"
                  onClick={() => {
                    void request<PatientPage>('/api/patients/search', {
                      method: 'POST',
                      headers: { 'X-CSRF-Token': session.csrfToken },
                      body: JSON.stringify({ q: search, page: 1 }),
                    })
                      .then((r) => setPatients(r.patients))
                      .catch(fail);
                  }}
                >
                  {' '}
                  {t('common:search_patients')}{' '}
                </button>
              </div>
              <label htmlFor="hospital-patient">{t('common:patient')}</label>
              <select
                disabled={busy || Boolean(pending)}
                id="hospital-patient"
                required
                value={patient}
                onChange={(e) => setPatient(e.target.value)}
              >
                <option value="">{t('configuration:select_a_verified_patient')}</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.recordNumber}
                  </option>
                ))}
              </select>
              {tab === 'Record requests' && (
                <>
                  {input('requester', 'labels:requester_name')}
                  {input('purpose', 'labels:purpose_of_request')}
                  {input(
                    'verification',
                    'labels:how_requester_identity_and_authority_were_verified',
                  )}
                </>
              )}
              {reasonField}
              {saveButton}
            </form>
          )}
        </>
      )}
      {tab === 'Support access' && (
        <>
          <section className="panel">
            <h2>{t('configuration:approved_support_sessions')}</h2>
            <p>
              {' '}
              {t(
                'configuration:use_a_separate_named_auditor_account_approval_is_limited_to_four_hours_and_requires_authenticat',
              )}{' '}
            </p>
            {overview.support.map((g) => (
              <div className="order-card" key={g.user_id}>
                <h3>{g.username}</h3>
                <p>
                  {g.purpose} ·{' '}
                  {g.revoked
                    ? t('configuration:revoked')
                    : 'Expires ' + formatHospitalDate(g.expires_at, appearance)}
                </p>
                {admin && !g.revoked && (
                  <button
                    disabled={busy || Boolean(pending)}
                    onClick={() => {
                      const why = window.prompt(t('common:revoke_support_reason'));
                      if (why)
                        void save({ type: 'support.revoke', accountId: g.user_id, reason: why });
                    }}
                  >
                    {' '}
                    {t('configuration:revoke_access')}{' '}
                  </button>
                )}
              </div>
            ))}
          </section>
          {admin && (
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                void save({
                  type: 'support.grant',
                  accountId: fields.account ?? '',
                  durationMinutes: Number(fields.duration ?? 60),
                  reason,
                });
              }}
            >
              <h2>{t('configuration:approve_named_support_access')}</h2>
              <label htmlFor="hospital-support-account">{t('configuration:auditor_account')}</label>
              <select
                disabled={busy || Boolean(pending)}
                id="hospital-support-account"
                required
                value={fields.account ?? ''}
                onChange={(e) => change('account', e.target.value)}
              >
                <option value="">{t('configuration:select_an_account')}</option>
                {overview.staff.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName} · {a.username}
                  </option>
                ))}
              </select>
              {input('duration', 'labels:minutes_5_240', false, 'number')}
              {reasonField}
              {saveButton}
            </form>
          )}
        </>
      )}
      {tab === 'Exports' && (
        <section className="panel">
          <h2>{t('configuration:organization_data_export')}</h2>
          <p>
            {' '}
            {t(
              'configuration:authorized_exports_contain_sensitive_records_each_download_is_audited_download_each_page_while_',
            )}{' '}
          </p>
          {admin ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void exportData(
                  '/api/hospital/export',
                  { table, page: Number(page), purpose: reason },
                  'organization-data',
                );
              }}
            >
              <label htmlFor="hospital-export-table">{t('common:record_collection')}</label>
              <select
                id="hospital-export-table"
                value={table}
                onChange={(e) => setTable(e.target.value as typeof table)}
              >
                {exportTables.map((t) => (
                  <option key={t} value={t}>
                    {presentationLabel(t)}
                  </option>
                ))}
              </select>
              <label htmlFor="hospital-export-page">
                {t('configuration:page_250_records_per_page')}
              </label>
              <input
                id="hospital-export-page"
                type="number"
                min="1"
                max="100000"
                required
                value={page}
                onChange={(e) => setPage(e.target.value)}
              />
              {reasonField}
              <button className="primary" disabled={busy}>
                {' '}
                {t('configuration:download_records')}{' '}
              </button>
            </form>
          ) : (
            <p>{t('configuration:exports_require_an_administrator')}</p>
          )}
        </section>
      )}
    </section>
  );
}
