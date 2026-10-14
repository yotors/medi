import { useEffect, useState } from 'react';
import type { Session, RegisteredPatient, PatientPage } from '../../shared/registration';
import {
  careKinds,
  careSchemas,
  canReadCare,
  canWriteCare,
  type CareKind,
  type CareRecord,
  type CarePage,
  type CareEvent,
} from '../../shared/care';
import { request, ApiError } from './api';
import './care.css';
import {
  displayCareTime as displayTime,
  careTimeInput as inputTime,
  careTimePayload,
  hasTimeOffset,
} from '../../shared/care-time';
type Field = {
  key: string;
  label: string;
  type?: 'number' | 'textarea' | 'datetime-local' | 'date' | 'checkbox';
  options?: string[];
  source?: CareKind | 'clinician' | 'staff';
  optional?: boolean;
};
const fields: Record<CareKind, Field[]> = {
  profile: [
    { key: 'name', label: 'Patient name' },
    { key: 'contact', label: 'Contact', optional: true },
    { key: 'dateOfBirth', label: 'Date of birth', type: 'date', optional: true },
    { key: 'sex', label: 'Sex', options: ['unknown', 'female', 'male', 'other'] },
    { key: 'address', label: 'Address', optional: true },
    { key: 'emergencyContact', label: 'Emergency contact', optional: true },
    { key: 'identity', label: 'Identity verification', options: ['provisional', 'verified'] },
    {
      key: 'allergiesStatus',
      label: 'Allergy information',
      options: ['not-entered', 'none-known', 'entered'],
    },
    { key: 'allergies', label: 'Entered allergies', type: 'textarea', optional: true },
  ],
  appointment: [
    { key: 'clinicianId', label: 'Responsible clinician', source: 'clinician' },
    { key: 'service', label: 'Service' },
    { key: 'facility', label: 'Facility' },
    { key: 'start', label: 'Start', type: 'datetime-local' },
    { key: 'end', label: 'End', type: 'datetime-local' },
    {
      key: 'status',
      label: 'Appointment status',
      options: ['booked', 'arrived', 'cancelled', 'no-show'],
    },
  ],
  triage: [
    { key: 'encounterId', label: 'Outpatient encounter ID (optional)', optional: true },
    {
      key: 'urgency',
      label: 'Staff selected urgency',
      options: ['routine', 'urgent', 'emergency'],
    },
    { key: 'symptoms', label: 'Symptoms entered by staff', type: 'textarea' },
    { key: 'eventAt', label: 'Observed at', type: 'datetime-local' },
    ...(
      [
        ['temperatureC', 'Temperature (°C)'],
        ['pulsePerMinute', 'Pulse (beats/min)'],
        ['systolicMmHg', 'Systolic pressure (mmHg)'],
        ['diastolicMmHg', 'Diastolic pressure (mmHg)'],
        ['respiratoryPerMinute', 'Respiratory rate (breaths/min)'],
        ['oxygenPercent', 'Oxygen saturation (%)'],
        ['weightKg', 'Weight (kg)'],
      ] as const
    ).map(([key, label]) => ({ key, label, type: 'number' as const, optional: true })),
  ],
  ward: [
    { key: 'name', label: 'Ward name' },
    { key: 'facility', label: 'Facility' },
    { key: 'active', label: 'Active ward', type: 'checkbox' },
  ],
  bed: [
    { key: 'wardId', label: 'Ward', source: 'ward' },
    { key: 'name', label: 'Bed name' },
    { key: 'active', label: 'Active bed', type: 'checkbox' },
  ],
  admission: [
    { key: 'bedId', label: 'Bed', source: 'bed' },
    { key: 'clinicianId', label: 'Responsible clinician', source: 'clinician' },
    { key: 'reason', label: 'Admission reason', type: 'textarea' },
    {
      key: 'eventAt',
      label: 'Admission / transfer / discharge event time',
      type: 'datetime-local',
    },
    { key: 'status', label: 'Admission status', options: ['active', 'discharged'] },
    { key: 'summary', label: 'Signed discharge summary', type: 'textarea', optional: true },
    { key: 'disposition', label: 'Discharge disposition', optional: true },
    {
      key: 'followUp',
      label: 'Discharge follow-up instructions',
      type: 'textarea',
      optional: true,
    },
  ],
  nursing: [
    { key: 'admissionId', label: 'Admission', source: 'admission' },
    { key: 'eventAt', label: 'Observation event time', type: 'datetime-local' },
    { key: 'shift', label: 'Shift' },
    { key: 'observation', label: 'Signed nursing observation / note', type: 'textarea' },
  ],
  medication: [
    { key: 'admissionId', label: 'Admission', source: 'admission' },
    { key: 'drug', label: 'Product / drug entered by clinician' },
    { key: 'dose', label: 'Entered dose', type: 'number' },
    { key: 'unit', label: 'Dose unit' },
    { key: 'route', label: 'Route' },
    { key: 'scheduledAt', label: 'Scheduled administration time', type: 'datetime-local' },
    { key: 'instructions', label: 'Administration / stop instructions', type: 'textarea' },
    {
      key: 'status',
      label: 'Medication task status',
      options: ['ordered', 'stopped', 'cancelled'],
    },
  ],
  administration: [
    { key: 'medicationId', label: 'Medication administration task', source: 'medication' },
    { key: 'eventAt', label: 'Actual administration event time', type: 'datetime-local' },
    { key: 'outcome', label: 'Accountable outcome', options: ['given', 'withheld', 'refused'] },
    { key: 'reason', label: 'Outcome reason', type: 'textarea', optional: true },
  ],
  referral: [
    { key: 'type', label: 'Referral / follow-up', options: ['referral', 'follow-up'] },
    { key: 'destination', label: 'Service / destination' },
    { key: 'reason', label: 'Referral reason', type: 'textarea' },
    { key: 'dueAt', label: 'Due at', type: 'datetime-local' },
    { key: 'ownerId', label: 'Assigned owner', source: 'staff' },
    { key: 'status', label: 'Follow-up status', options: ['pending', 'completed', 'cancelled'] },
  ],
};
const labels: Record<CareKind, string> = {
  profile: 'Patient profile',
  appointment: 'Appointments',
  triage: 'Triage',
  ward: 'Wards',
  bed: 'Beds',
  admission: 'Admissions',
  nursing: 'Nursing notes',
  medication: 'Medication orders',
  administration: 'Administration outcomes',
  referral: 'Referrals & follow-up',
};
const title = (r: CareRecord) => {
  const d = r.data as Record<string, unknown>;
  return String(
    d.name ??
      d.drug ??
      d.destination ??
      d.service ??
      d.shift ??
      d.urgency ??
      d.outcome ??
      d.reason ??
      'Care record',
  );
};
export function CareWorkspace({
  session,
  onDirtyChange,
  onDirty,
  onPending,
  onSessionError,
}: {
  session: Session;
  onDirtyChange?: (dirty: boolean) => void;
  onDirty?: (dirty: boolean) => void;
  onPending?: (pending: boolean) => void;
  onSessionError?: (error: unknown) => void;
}) {
  const [kind, setKind] = useState<CareKind>('profile'),
    [patient, setPatient] = useState<RegisteredPatient | null>(null),
    [query, setQuery] = useState(''),
    [patients, setPatients] = useState<RegisteredPatient[]>([]),
    [records, setRecords] = useState<CareRecord[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [today, setToday] = useState(false);
  const [selected, setSelected] = useState<CareRecord | null>(null),
    [draft, setDraft] = useState<Record<string, unknown> | null>(null),
    [reason, setReason] = useState(''),
    [events, setEvents] = useState<CareEvent[]>([]),
    [historyPage, setHistoryPage] = useState(1),
    [historyTotal, setHistoryTotal] = useState(0),
    [identity, setIdentity] = useState<{
      identities: {
        id: string;
        name: string;
        recordNumber: string;
        canonicalId?: string;
        linkReason?: string;
      }[];
      visits: {
        id: string;
        patientId: string;
        name: string;
        recordNumber: string;
        openedAt: string;
        status: string;
      }[];
    } | null>(null);
  const [options, setOptions] = useState<Record<string, { id: string; label: string }[]>>({}),
    [staff, setStaff] = useState<{ id: string; name: string; role: string }[]>([]),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState<{ key: string; body: string; path: string } | null>(null),
    [canonicalPatient, setCanonicalPatient] = useState<RegisteredPatient | null>(null),
    [mergeQuery, setMergeQuery] = useState(''),
    [mergePatients, setMergePatients] = useState<RegisteredPatient[]>([]),
    [mergePage, setMergePage] = useState(1),
    [mergeTotal, setMergeTotal] = useState(0),
    [mergeLoading, setMergeLoading] = useState(false),
    [mergeSearched, setMergeSearched] = useState(false);
  const dirty = !!draft || !!pending || !!canonicalPatient || !!mergeQuery || !!reason;
  const role = session.user.role;
  const headers = { 'X-CSRF-Token': session.csrfToken };
  useEffect(() => {
    onDirtyChange?.(dirty);
    onDirty?.(dirty);
    onPending?.(!!pending);
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('beforeunload', leave);
      onDirtyChange?.(false);
      onDirty?.(false);
      onPending?.(false);
    };
  }, [dirty, onDirtyChange, onDirty, onPending, !!pending]);
  useEffect(() => {
    let live = true;
    request<{ staff: typeof staff }>('/api/care/options')
      .then((r) => {
        if (live) setStaff(r.staff);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [session.user.id]);
  async function reload() {
    if (!['ward', 'bed'].includes(kind) && !patient) {
      setRecords([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await request<CarePage>('/api/care/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          kind,
          ...(patient && !['ward', 'bed'].includes(kind) ? { patientId: patient.id } : {}),
          page,
          today: kind === 'appointment' && today,
        }),
      });
      setRecords(result.records);
      setTotal(result.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, [kind, patient?.id, page, today]);
  useEffect(() => {
    if (!patient) {
      setIdentity(null);
      return;
    }
    let live = true;
    request<NonNullable<typeof identity>>(`/api/care/patients/${patient.id}/identity`)
      .then((r) => {
        if (live) setIdentity(r);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [patient?.id]);
  useEffect(() => {
    let live = true;
    const sources = [
      ...new Set(
        fields[kind]
          .map((f) => f.source)
          .filter(
            (s): s is CareKind => !!s && s !== 'staff' && s !== 'clinician' && canReadCare(role, s),
          ),
      ),
    ];
    Promise.all(
      sources.map(async (source) => {
        const r = await request<CarePage>('/api/care/search', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            kind: source,
            ...(patient && ['admission', 'medication'].includes(source)
              ? { patientId: patient.id }
              : {}),
            page: 1,
          }),
        });
        return [
          source,
          r.records.map((v) => ({
            id: v.id,
            label: `${title(v)} · ${(v.data as Record<string, unknown>).status ?? 'configured'} · ${v.id.slice(0, 8)}`,
          })),
        ] as const;
      }),
    )
      .then((values) => {
        if (live) setOptions(Object.fromEntries(values));
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [kind, patient?.id]);
  function depart() {
    return !dirty || (!pending && window.confirm('Discard the unsaved care draft?'));
  }
  function newRecord(r: CareRecord | null) {
    if (!depart()) return;
    setSelected(r);
    setEvents([]);
    setReason('');
    setError('');
    setMessage('');
    const data: Record<string, unknown> = {};
    for (const f of fields[kind])
      data[f.key] = r
        ? ((r.data as Record<string, unknown>)[f.key] ?? '')
        : f.type === 'checkbox'
          ? true
          : (f.options?.[0] ?? '');
    if (!r && kind === 'profile' && patient) {
      data.name = patient.name;
      data.contact = patient.contact;
    }
    setDraft(data);
  }
  async function save() {
    if (!draft && !pending) return;
    setError('');
    let task = pending;
    if (!task) {
      const data = { ...draft };
      for (const f of fields[kind]) {
        if (f.type === 'number') {
          if (data[f.key] === '' && f.optional) delete data[f.key];
          else data[f.key] = Number(data[f.key]);
        }
        if (f.type === 'datetime-local') {
          if (!data[f.key]) {
            setError(`Enter ${f.label.toLowerCase()}.`);
            return;
          }
          data[f.key] = careTimePayload(String(data[f.key]));
        }
        if (f.key === 'dateOfBirth' && !data[f.key]) data[f.key] = null;
        if (f.optional && data[f.key] === '' && ['encounterId'].includes(f.key)) delete data[f.key];
      }
      if (selected && kind === 'appointment' && (selected.data as Record<string, unknown>).visitId)
        data.visitId = (selected.data as Record<string, unknown>).visitId;
      const parsed = careSchemas[kind].safeParse(data);
      if (!parsed.success) {
        setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' '));
        return;
      }
      if (!reason.trim()) {
        setError('Enter a reason for this entry or amendment.');
        return;
      }
      task = {
        key: crypto.randomUUID(),
        path: '/api/care/records',
        body: JSON.stringify({
          kind,
          ...(selected ? { id: selected.id } : {}),
          ...(!['ward', 'bed'].includes(kind) && patient ? { patientId: patient.id } : {}),
          expectedRevision: selected?.revision ?? 0,
          reason,
          data: parsed.data,
        }),
      };
      setPending(task);
    }
    setSaving(true);
    try {
      await request(task.path, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': task.key },
        body: task.body,
      });
      setPending(null);
      setDraft(null);
      setSelected(null);
      setReason('');
      setMessage('Saved with your name and recorded time.');
      await reload();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 401) onSessionError?.(e);
      if (e instanceof ApiError && e.status > 0 && e.status < 500) setPending(null);
    } finally {
      setSaving(false);
    }
  }
  async function history(r: CareRecord, historyIndex = 1) {
    setError('');
    try {
      const result = await request<{ events: CareEvent[]; total: number }>(
        `/api/care/${r.id}/history?page=${historyIndex}`,
      );
      setEvents(result.events);
      setHistoryPage(historyIndex);
      setHistoryTotal(result.total);
      setSelected(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function searchCanonical(nextPage: number) {
    setMergeLoading(true);
    setError('');
    try {
      const r = await request<PatientPage>('/api/patients/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({ q: mergeQuery, page: nextPage }),
      });
      setMergePatients(r.patients.filter((p) => p.id !== patient?.id));
      setMergeTotal(r.total);
      setMergePage(nextPage);
      setMergeSearched(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMergeLoading(false);
    }
  }
  async function merge() {
    if (!patient || !canonicalPatient || !reason.trim()) {
      setError('Select the canonical patient by name and MRN, and enter a resolution reason.');
      return;
    }
    const task = pending ?? {
      key: crypto.randomUUID(),
      path: '/api/care/identity-links',
      body: JSON.stringify({ duplicateId: patient.id, canonicalId: canonicalPatient.id, reason }),
    };
    setPending(task);
    setSaving(true);
    try {
      await request(task.path, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': task.key },
        body: task.body,
      });
      setPending(null);
      setCanonicalPatient(null);
      setMergeQuery('');
      setMergePatients([]);
      setMergeSearched(false);
      setReason('');
      setMessage('Identities linked. Original records and history are retained.');
      setIdentity(await request(`/api/care/patients/${patient.id}/identity`));
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 401) onSessionError?.(e);
      if (e instanceof ApiError && e.status > 0 && e.status < 500) setPending(null);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="care-workspace" aria-labelledby="care-heading">
      <header className="care-heading">
        <div>
          <h1 id="care-heading">Patient care</h1>
          <p>Identity, scheduled visits and accountable inpatient care.</p>
        </div>
        <p className="care-zone">Gregorian dates · Africa/Addis_Ababa (UTC+03:00)</p>
      </header>
      <form
        className="care-search"
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          setError('');
          try {
            const r = await request<PatientPage>('/api/patients/search', {
              method: 'POST',
              headers,
              body: JSON.stringify({ q: query, page: 1 }),
            });
            setPatients(r.patients);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setLoading(false);
          }
        }}
      >
        <label>
          Find a patient
          <input
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, MRN or contact"
            disabled={saving || !!pending}
          />
        </label>
        <button disabled={saving || !!pending}>Search patients</button>
      </form>
      {patients.length > 0 && (
        <ul className="care-patients">
          {patients.map((p) => (
            <li key={p.id}>
              <button
                disabled={saving || !!pending}
                onClick={() => {
                  if (depart()) {
                    setPatient(p);
                    setCanonicalPatient(null);
                    setMergeQuery('');
                    setMergePatients([]);
                    setReason('');
                    setDraft(null);
                    setSelected(null);
                    setPage(1);
                    setPatients([]);
                    setEvents([]);
                  }
                }}
              >
                {p.name} · {p.recordNumber}
              </button>
            </li>
          ))}
        </ul>
      )}
      {patient && (
        <div className="care-identity">
          <strong>{patient.name}</strong>
          <span>
            MRN {patient.recordNumber} · Original registration {displayTime(patient.createdAt)}
          </span>
          {identity && identity.identities.length > 1 && (
            <details>
              <summary>
                Linked identities ({identity.identities.length}) — histories retain original MRNs
              </summary>
              {identity.identities.map((p) => (
                <p key={p.id}>
                  {p.name} · {p.recordNumber}
                  {p.canonicalId ? ' · duplicate linked to canonical identity' : ''} {p.linkReason}
                </p>
              ))}
            </details>
          )}
        </div>
      )}
      <nav className="care-tabs" aria-label="Care workflows">
        {careKinds
          .filter((k) => canReadCare(role, k))
          .map((k) => (
            <button
              key={k}
              aria-current={kind === k ? 'page' : undefined}
              disabled={saving || !!pending}
              onClick={() => {
                if (depart()) {
                  setKind(k);
                  setCanonicalPatient(null);
                  setMergeQuery('');
                  setMergePatients([]);
                  setReason('');
                  setDraft(null);
                  setSelected(null);
                  setEvents([]);
                  setPage(1);
                  setError('');
                }
              }}
            >
              {labels[k]}
            </button>
          ))}
      </nav>
      {error && (
        <p className="care-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="care-success">
          {message}
        </p>
      )}
      {!!pending && (
        <div className="care-retry">
          <p>The save result is unresolved. Your original details and retry key are preserved.</p>
          <button
            disabled={saving}
            onClick={() =>
              pending.path === '/api/care/identity-links' ? void merge() : void save()
            }
          >
            Retry the same save
          </button>
        </div>
      )}
      <div className="care-section-heading">
        <h2>{labels[kind]}</h2>
        {canWriteCare(role, kind, { status: 'active' }) &&
          (patient || ['ward', 'bed'].includes(kind)) && (
            <button disabled={saving || !!pending} onClick={() => newRecord(null)}>
              {kind === 'profile' ? 'Enter patient profile' : 'New entry'}
            </button>
          )}
        {kind === 'appointment' && (
          <label>
            <input
              type="checkbox"
              checked={today}
              disabled={saving || !!pending}
              onChange={(e) => {
                setToday(e.target.checked);
                setPage(1);
              }}
            />
            Today only (Addis Ababa)
          </label>
        )}
      </div>
      {kind === 'triage' && (
        <p>
          Enter observed values and select urgency yourself. Numeric limits protect data
          representation and do not determine urgency or treatment.
        </p>
      )}
      {kind === 'medication' && (
        <p>
          One order creates one administration task. Enter the prescribed dose, unit, route and
          scheduled time explicitly.
        </p>
      )}
      {!patient && !['ward', 'bed'].includes(kind) ? (
        <p className="care-empty">Find and select a patient to view their care records.</p>
      ) : loading ? (
        <p role="status">Loading care records…</p>
      ) : records.length === 0 ? (
        <p className="care-empty">
          No {labels[kind].toLowerCase()} recorded. Authorized staff can create an entry.
        </p>
      ) : (
        <div
          className="care-table"
          role="region"
          aria-label={`${labels[kind]} records`}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Record / original identity</th>
                <th>Status</th>
                <th>Event & recorded time</th>
                <th>Author</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const d = r.data as Record<string, unknown>;
                return (
                  <tr key={r.id}>
                    <td>
                      <strong>{title(r)}</strong>
                      {r.patient && (
                        <span>
                          {r.patient.name} · {r.patient.recordNumber}
                        </span>
                      )}
                      <small>Revision {r.revision}</small>
                      <details>
                        <summary>View entered details</summary>
                        <dl>
                          {Object.entries(d).map(([key, v]) => (
                            <div key={key}>
                              <dt>{fields[kind].find((f) => f.key === key)?.label ?? key}</dt>
                              <dd>{String(v ?? 'Not entered')}</dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    </td>
                    <td>
                      {String(
                        d.status ??
                          d.identity ??
                          d.outcome ??
                          (d.active === undefined ? 'recorded' : d.active ? 'active' : 'inactive'),
                      )}
                    </td>
                    <td>
                      {d.eventAt || d.start || d.scheduledAt || d.dueAt ? (
                        <span>
                          {displayTime(String(d.eventAt ?? d.start ?? d.scheduledAt ?? d.dueAt))}
                        </span>
                      ) : null}
                      <small>Recorded {displayTime(r.updatedAt)}</small>
                    </td>
                    <td>{r.actorName}</td>
                    <td>
                      {canWriteCare(role, r.kind, d) && (
                        <button disabled={saving || !!pending} onClick={() => newRecord(r)}>
                          {['nursing', 'triage', 'administration'].includes(kind)
                            ? 'Amend'
                            : 'Update'}
                        </button>
                      )}
                      {!(role === 'receptionist' && kind === 'admission') && (
                        <button disabled={saving || !!pending} onClick={() => void history(r)}>
                          History
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {total > 25 && (
        <div className="care-pagination">
          <button disabled={page === 1 || saving || !!pending} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} · {total} records
          </span>
          <button
            disabled={page * 25 >= total || saving || !!pending}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
      {draft && (
        <form
          className="care-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3>
            {selected ? 'Amend / update' : 'Create'} {labels[kind].toLowerCase()}
          </h3>
          <p>Signed as {session.user.displayName}. Earlier versions remain in the history.</p>
          <fieldset disabled={saving || !!pending}>
            <div className="care-fields">
              {fields[kind]
                .filter(
                  (f) =>
                    !(
                      role === 'receptionist' &&
                      kind === 'admission' &&
                      ['summary', 'disposition', 'followUp'].includes(f.key)
                    ),
                )
                .map((f) => {
                  const opts =
                    f.source === 'clinician'
                      ? staff
                          .filter((u) => u.role === 'clinician')
                          .map((u) => ({ id: u.id, label: u.name }))
                      : f.source === 'staff'
                        ? staff.map((u) => ({ id: u.id, label: u.name }))
                        : f.source
                          ? (options[f.source] ?? [])
                          : null;
                  return (
                    <div className="care-field" key={f.key}>
                      <label htmlFor={`care-${kind}-${f.key}`}>
                        {f.label}
                        {f.type === 'datetime-local' ? ' (Addis Ababa, Gregorian)' : ''}
                        {f.type === 'date' ? ' (Gregorian)' : ''}
                        {f.optional ? ' (optional)' : ''}
                      </label>
                      {f.options || opts ? (
                        <select
                          id={`care-${kind}-${f.key}`}
                          value={String(draft[f.key] ?? '')}
                          required={!f.optional}
                          disabled={
                            role === 'receptionist' &&
                            kind === 'profile' &&
                            f.key === 'allergiesStatus'
                          }
                          onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                        >
                          {opts && <option value="">Select {f.label.toLowerCase()}</option>}
                          {opts
                            ? opts.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.label}
                                </option>
                              ))
                            : f
                                .options!.filter(
                                  (o) =>
                                    !(
                                      role !== 'clinician' &&
                                      kind === 'admission' &&
                                      o === 'discharged'
                                    ),
                                )
                                .map((o) => <option key={o}>{o}</option>)}
                        </select>
                      ) : f.type === 'textarea' ? (
                        <textarea
                          id={`care-${kind}-${f.key}`}
                          value={String(draft[f.key] ?? '')}
                          maxLength={f.key === 'summary' ? 6000 : 4000}
                          required={!f.optional}
                          disabled={
                            role === 'receptionist' && kind === 'profile' && f.key === 'allergies'
                          }
                          onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                        />
                      ) : f.type === 'checkbox' ? (
                        <input
                          id={`care-${kind}-${f.key}`}
                          type="checkbox"
                          checked={!!draft[f.key]}
                          onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })}
                        />
                      ) : (
                        <input
                          id={`care-${kind}-${f.key}`}
                          type={f.type ?? 'text'}
                          step={
                            f.type === 'number'
                              ? ['pulsePerMinute', 'respiratoryPerMinute'].includes(f.key)
                                ? '1'
                                : 'any'
                              : undefined
                          }
                          min={
                            [
                              'pulsePerMinute',
                              'respiratoryPerMinute',
                              'weightKg',
                              'oxygenPercent',
                            ].includes(f.key)
                              ? 0
                              : undefined
                          }
                          max={f.key === 'oxygenPercent' ? 100 : undefined}
                          required={!f.optional}
                          maxLength={f.type ? undefined : 500}
                          value={
                            f.type === 'datetime-local' && hasTimeOffset(String(draft[f.key]))
                              ? inputTime(draft[f.key])
                              : String(draft[f.key] ?? '')
                          }
                          onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                        />
                      )}
                    </div>
                  );
                })}
              <div className="care-field care-reason">
                <label htmlFor="care-entry-reason">Entry / correction / cancellation reason</label>
                <textarea
                  id="care-entry-reason"
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </div>
            <div className="care-actions">
              <button type="submit">{saving ? 'Saving…' : 'Sign and save'}</button>
              <button
                type="button"
                onClick={() => {
                  if (depart()) {
                    setDraft(null);
                    setSelected(null);
                    setReason('');
                  }
                }}
              >
                Discard draft
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {events.length > 0 && (
        <section className="care-history">
          <h3>Immutable history · {selected && title(selected)}</h3>
          {events.map((e) => (
            <article key={e.id}>
              <h4>
                Revision {e.revision} · {e.actorName}
              </h4>
              <p>
                {displayTime(e.createdAt)} · {e.reason}
              </p>
              <dl>
                {Object.entries(e.data as Record<string, unknown>).map(([key, v]) => (
                  <div key={key}>
                    <dt>{fields[selected!.kind].find((f) => f.key === key)?.label ?? key}</dt>
                    <dd>{String(v ?? 'Not entered')}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
          {historyTotal > 25 && (
            <div className="care-pagination">
              <button
                disabled={historyPage === 1}
                onClick={() => void history(selected!, historyPage - 1)}
              >
                Newer history
              </button>
              <span>History page {historyPage}</span>
              <button
                disabled={historyPage * 25 >= historyTotal}
                onClick={() => void history(selected!, historyPage + 1)}
              >
                Older history
              </button>
            </div>
          )}
        </section>
      )}
      {kind === 'profile' && identity && identity.visits.length > 0 && (
        <details className="care-longitudinal">
          <summary>Longitudinal outpatient history ({identity.visits.length}, latest 100)</summary>
          {identity.visits.map((v) => (
            <p key={v.id}>
              {v.name} · {v.recordNumber} · {v.status} · {displayTime(v.openedAt)} · Encounter{' '}
              {v.id}
            </p>
          ))}
        </details>
      )}
      {kind === 'profile' && role === 'admin' && patient && !draft && (
        <details className="care-merge">
          <summary>Resolve a duplicate patient identity</summary>
          <p>
            Duplicate:{' '}
            <strong>
              {patient.name} · {patient.recordNumber}
            </strong>
            . Select the verified canonical patient. Both original identities and histories remain
            intact.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void searchCanonical(1);
            }}
          >
            <div className="care-field">
              <label htmlFor="care-canonical-search">
                Find canonical patient by name, MRN or contact
              </label>
              <input
                id="care-canonical-search"
                value={mergeQuery}
                maxLength={100}
                disabled={saving || !!pending}
                onChange={(e) => {
                  setMergeQuery(e.target.value);
                  setCanonicalPatient(null);
                  setMergePatients([]);
                  setMergeSearched(false);
                }}
              />
            </div>
            <button disabled={saving || !!pending || mergeLoading || !mergeQuery.trim()}>
              Search canonical patients
            </button>
          </form>
          {mergeLoading && <p role="status">Searching this hospital’s patients…</p>}
          {mergeSearched && !mergeLoading && mergePatients.length === 0 && (
            <p>No other matching patient found in this hospital. Refine the name or MRN.</p>
          )}
          <ul className="care-patients">
            {mergePatients.map((p) => (
              <li key={p.id}>
                <button
                  disabled={saving || !!pending}
                  aria-pressed={canonicalPatient?.id === p.id}
                  onClick={() => setCanonicalPatient(p)}
                >
                  Select canonical: {p.name} · {p.recordNumber}
                </button>
              </li>
            ))}
          </ul>
          {mergeTotal > 25 && (
            <div className="care-pagination">
              <button
                disabled={mergePage === 1 || saving || !!pending || mergeLoading}
                onClick={() => void searchCanonical(mergePage - 1)}
              >
                Previous canonical matches
              </button>
              <span>Page {mergePage}</span>
              <button
                disabled={mergePage * 25 >= mergeTotal || saving || !!pending || mergeLoading}
                onClick={() => void searchCanonical(mergePage + 1)}
              >
                Next canonical matches
              </button>
            </div>
          )}
          {canonicalPatient && (
            <p role="status">
              Canonical:{' '}
              <strong>
                {canonicalPatient.name} · {canonicalPatient.recordNumber}
              </strong>
            </p>
          )}
          <div className="care-field">
            <label htmlFor="care-resolution-reason">Resolution reason</label>
            <textarea
              id="care-resolution-reason"
              maxLength={1000}
              value={reason}
              disabled={saving || !!pending}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <button
            disabled={saving || !!pending || !canonicalPatient || !reason.trim()}
            onClick={() => void merge()}
          >
            Link duplicate to canonical identity
          </button>
        </details>
      )}
    </section>
  );
}
