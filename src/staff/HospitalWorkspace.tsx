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
    else setError(e instanceof Error ? e.message : 'The action could not be completed.');
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
      setNotice('Saved. The action is recorded in hospital history.');
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
      !window.confirm('Discard the changes in this form?')
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
      <label htmlFor={'hospital-' + key}>{label}</label>
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
      <label htmlFor="hospital-reason">Reason</label>
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
      {busy ? 'Saving…' : pending ? 'Retry unchanged request' : 'Save'}
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
      setNotice('Export downloaded. Keep it in an approved secure location.');
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
        <h1>Hospital management</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => void load()}>Retry loading</button>
          </>
        ) : (
          <p role="status">Loading hospital settings…</p>
        )}
      </section>
    );
  return (
    <section aria-labelledby="hospital-heading">
      <h1 id="hospital-heading">Hospital management</h1>
      <p className="muted">Facilities, governed record requests and approved support access.</p>
      <nav className="staff-navigation" aria-label="Hospital management sections">
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
            {t}
          </button>
        ))}
      </nav>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {pending && !busy && (
        <div className="notice warning">
          <p>The save is uncertain. Retry the original request before changing this form.</p>
          <button onClick={() => void save(pending.command)}>Retry original request</button>
        </div>
      )}
      {tab === 'Facilities' && (
        <>
          <section className="panel">
            <h2>Facilities</h2>
            {overview.facilities.length ? (
              overview.facilities.map((f) => (
                <div className="order-card" key={f.id}>
                  <h3>{f.name}</h3>
                  <p>
                    {f.code} · {f.address || 'Address not entered'} ·{' '}
                    {f.active ? 'Active' : 'Inactive'}
                  </p>
                  {admin && (
                    <button
                      disabled={busy || Boolean(pending)}
                      onClick={() => {
                        setFacility(f.id);
                        setFields({ name: f.name, address: f.address, active: String(f.active) });
                      }}
                    >
                      Edit facility
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p className="empty-small">No facilities configured.</p>
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
              <h2>{facility ? 'Edit facility' : 'Add facility'}</h2>
              {!facility && input('code', 'Facility code')}
              {facility && (
                <>
                  <label htmlFor="hospital-facility-active">Facility availability</label>
                  <select
                    id="hospital-facility-active"
                    disabled={busy || Boolean(pending)}
                    value={fields.active ?? 'true'}
                    onChange={(e) => change('active', e.target.value)}
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </>
              )}
              {input('name', 'Facility name')}
              {input('address', 'Address', false)}
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
          <h2>Organization settings</h2>
          <p>Current name: {overview.profile.name}</p>
          {admin ? (
            <>
              {
                <div>
                  <label htmlFor="hospital-name">Organization name</label>
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
              {input('phone', 'Telephone', false)}
              {input('address', 'Address', false)}
              <label htmlFor="hospital-locale">Preferred record locale</label>
              <select
                disabled={busy || Boolean(pending)}
                id="hospital-locale"
                value={fields.locale ?? overview.profile.settings.locale ?? 'en-ET'}
                onChange={(e) => change('locale', e.target.value)}
              >
                <option value="en-ET">English (Ethiopia)</option>
                <option value="am-ET">Amharic (Ethiopia)</option>
              </select>
              <label htmlFor="hospital-calendar">Display calendar</label>
              <select
                disabled={busy || Boolean(pending)}
                id="hospital-calendar"
                value={fields.calendar ?? overview.profile.settings.calendar ?? 'gregory'}
                onChange={(e) => change('calendar', e.target.value)}
              >
                <option value="gregory">Gregorian</option>
                <option value="ethiopic">Ethiopian</option>
              </select>
              <p className="muted">
                Timezone: Africa/Addis_Ababa. Date-entry controls use Gregorian dates; exports keep
                original ISO timestamps.
              </p>
              {reasonField}
              {saveButton}
            </>
          ) : (
            <p>Organization changes require an administrator.</p>
          )}
        </form>
      )}
      {['Record requests', 'Record holds'].includes(tab) && (
        <>
          <section className="panel">
            <h2>{tab}</h2>
            {(tab === 'Record requests' ? overview.requests : overview.holds).map((r) => (
              <div className="order-card" key={r.id}>
                {'requester' in r ? (
                  <>
                    <h3>{r.requester}</h3>
                    <p>
                      {r.purpose} · {r.status}
                    </p>
                    <p>Identity and authority verification: {r.identity_verification}</p>
                    <p>Requested {formatHospitalDate(r.created_at, appearance)}</p>
                    {admin &&
                      r.status === 'pending' &&
                      ['approved', 'denied'].map((status) => (
                        <button
                          key={status}
                          disabled={busy || Boolean(pending)}
                          onClick={() => {
                            const why = window.prompt('Reason for this decision');
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
                          {status === 'approved' ? 'Approve' : 'Deny'}
                        </button>
                      ))}
                    {admin && ['approved', 'fulfilled'].includes(r.status) && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void exportData(
                            '/api/hospital/record-export',
                            { requestId: r.id, reason: 'Approved record request fulfillment' },
                            'patient-record',
                          )
                        }
                      >
                        Download approved record
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <h3>Record hold</h3>
                    <p>
                      {r.reason} · {r.active ? 'Active' : 'Released'}
                    </p>
                    {admin && r.active && (
                      <button
                        onClick={() => {
                          const why = window.prompt('Reason for releasing this hold');
                          if (why)
                            void save({
                              type: 'hold.release',
                              id: r.id,
                              expectedRevision: r.revision,
                              reason: why,
                            });
                        }}
                      >
                        Release hold
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
            {!(tab === 'Record requests' ? overview.requests : overview.holds).length && (
              <p className="empty-small">No records in this list.</p>
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
              <h2>{tab === 'Record requests' ? 'New record request' : 'Place retention hold'}</h2>
              <label htmlFor="hospital-patient-search">Find patient</label>
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
                  Search patients
                </button>
              </div>
              <label htmlFor="hospital-patient">Patient</label>
              <select
                disabled={busy || Boolean(pending)}
                id="hospital-patient"
                required
                value={patient}
                onChange={(e) => setPatient(e.target.value)}
              >
                <option value="">Select a verified patient</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.recordNumber}
                  </option>
                ))}
              </select>
              {tab === 'Record requests' && (
                <>
                  {input('requester', 'Requester name')}
                  {input('purpose', 'Purpose of request')}
                  {input('verification', 'How requester identity and authority were verified')}
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
            <h2>Approved support sessions</h2>
            <p>
              Use a separate named auditor account. Approval is limited to four hours and requires
              authenticator sign-in. Revocation ends current sessions.
            </p>
            {overview.support.map((g) => (
              <div className="order-card" key={g.user_id}>
                <h3>{g.username}</h3>
                <p>
                  {g.purpose} ·{' '}
                  {g.revoked
                    ? 'Revoked'
                    : 'Expires ' + formatHospitalDate(g.expires_at, appearance)}
                </p>
                {admin && !g.revoked && (
                  <button
                    disabled={busy || Boolean(pending)}
                    onClick={() => {
                      const why = window.prompt('Reason for revoking named support access');
                      if (why)
                        void save({ type: 'support.revoke', accountId: g.user_id, reason: why });
                    }}
                  >
                    Revoke access
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
              <h2>Approve named support access</h2>
              <label htmlFor="hospital-support-account">Auditor account</label>
              <select
                disabled={busy || Boolean(pending)}
                id="hospital-support-account"
                required
                value={fields.account ?? ''}
                onChange={(e) => change('account', e.target.value)}
              >
                <option value="">Select an account</option>
                {overview.staff.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName} · {a.username}
                  </option>
                ))}
              </select>
              {input('duration', 'Minutes (5–240)', false, 'number')}
              {reasonField}
              {saveButton}
            </form>
          )}
        </>
      )}
      {tab === 'Exports' && (
        <section className="panel">
          <h2>Organization data export</h2>
          <p>
            Authorized exports contain sensitive records. Each download is audited. Download each
            page while more records remain. These live chunks are not a point-in-time recovery
            snapshot.
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
              <label htmlFor="hospital-export-table">Record collection</label>
              <select
                id="hospital-export-table"
                value={table}
                onChange={(e) => setTable(e.target.value as typeof table)}
              >
                {exportTables.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <label htmlFor="hospital-export-page">Page (250 records per page)</label>
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
                Download records
              </button>
            </form>
          ) : (
            <p>Exports require an administrator.</p>
          )}
        </section>
      )}
    </section>
  );
}
