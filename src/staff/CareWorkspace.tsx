import { uiMessage } from '../i18n';
import { presentationLabel } from '../i18n';
import { interfaceMessage } from '../i18n';
import { t } from '../i18n';
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
    {
      key: 'name',
      get label() {
        return t('care:patient_name');
      },
    },
    {
      key: 'contact',
      get label() {
        return t('common:contact');
      },
      optional: true,
    },
    {
      key: 'dateOfBirth',
      get label() {
        return t('care:date_of_birth');
      },
      type: 'date',
      optional: true,
    },
    {
      key: 'sex',
      get label() {
        return t('care:sex');
      },
      options: ['unknown', 'female', 'male', 'other'],
    },
    {
      key: 'address',
      get label() {
        return t('care:address');
      },
      optional: true,
    },
    {
      key: 'emergencyContact',
      get label() {
        return t('care:emergency_contact');
      },
      optional: true,
    },
    {
      key: 'identity',
      get label() {
        return t('care:identity_verification');
      },
      options: ['provisional', 'verified'],
    },
    {
      key: 'allergiesStatus',
      get label() {
        return t('care:allergy_information');
      },
      options: ['not-entered', 'none-known', 'entered'],
    },
    {
      key: 'allergies',
      get label() {
        return t('care:entered_allergies');
      },
      type: 'textarea',
      optional: true,
    },
  ],
  appointment: [
    {
      key: 'clinicianId',
      get label() {
        return t('care:responsible_clinician');
      },
      source: 'clinician',
    },
    {
      key: 'service',
      get label() {
        return t('common:service');
      },
    },
    {
      key: 'facility',
      get label() {
        return t('care:facility');
      },
    },
    {
      key: 'start',
      get label() {
        return t('care:start');
      },
      type: 'datetime-local',
    },
    {
      key: 'end',
      get label() {
        return t('care:end');
      },
      type: 'datetime-local',
    },
    {
      key: 'status',
      get label() {
        return t('care:appointment_status');
      },
      options: ['booked', 'arrived', 'cancelled', 'no-show'],
    },
  ],
  triage: [
    {
      key: 'encounterId',
      get label() {
        return t('care:outpatient_encounter_id_optional');
      },
      optional: true,
    },
    {
      key: 'urgency',
      get label() {
        return t('care:staff_selected_urgency');
      },
      options: ['routine', 'urgent', 'emergency'],
    },
    {
      key: 'symptoms',
      get label() {
        return t('care:symptoms_entered_by_staff');
      },
      type: 'textarea',
    },
    {
      key: 'eventAt',
      get label() {
        return t('care:observed_at');
      },
      type: 'datetime-local',
    },
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
    {
      key: 'name',
      get label() {
        return t('care:ward_name');
      },
    },
    {
      key: 'facility',
      get label() {
        return t('care:facility');
      },
    },
    {
      key: 'active',
      get label() {
        return t('care:active_ward');
      },
      type: 'checkbox',
    },
  ],
  bed: [
    {
      key: 'wardId',
      get label() {
        return t('care:ward');
      },
      source: 'ward',
    },
    {
      key: 'name',
      get label() {
        return t('care:bed_name');
      },
    },
    {
      key: 'active',
      get label() {
        return t('care:active_bed');
      },
      type: 'checkbox',
    },
  ],
  admission: [
    {
      key: 'bedId',
      get label() {
        return t('care:bed');
      },
      source: 'bed',
    },
    {
      key: 'clinicianId',
      get label() {
        return t('care:responsible_clinician');
      },
      source: 'clinician',
    },
    {
      key: 'reason',
      get label() {
        return t('care:admission_reason');
      },
      type: 'textarea',
    },
    {
      key: 'eventAt',
      get label() {
        return t('care:admission_transfer_discharge_event_time');
      },
      type: 'datetime-local',
    },
    {
      key: 'status',
      get label() {
        return t('care:admission_status');
      },
      options: ['active', 'discharged'],
    },
    {
      key: 'summary',
      get label() {
        return t('care:signed_discharge_summary');
      },
      type: 'textarea',
      optional: true,
    },
    {
      key: 'disposition',
      get label() {
        return t('care:discharge_disposition');
      },
      optional: true,
    },
    {
      key: 'followUp',
      get label() {
        return t('care:discharge_follow_up_instructions');
      },
      type: 'textarea',
      optional: true,
    },
  ],
  nursing: [
    {
      key: 'admissionId',
      get label() {
        return t('care:admission');
      },
      source: 'admission',
    },
    {
      key: 'eventAt',
      get label() {
        return t('care:observation_event_time');
      },
      type: 'datetime-local',
    },
    {
      key: 'shift',
      get label() {
        return t('care:shift');
      },
    },
    {
      key: 'observation',
      get label() {
        return t('care:signed_nursing_observation_note');
      },
      type: 'textarea',
    },
  ],
  medication: [
    {
      key: 'admissionId',
      get label() {
        return t('care:admission');
      },
      source: 'admission',
    },
    {
      key: 'drug',
      get label() {
        return t('care:product_drug_entered_by_clinician');
      },
    },
    {
      key: 'dose',
      get label() {
        return t('care:entered_dose');
      },
      type: 'number',
    },
    {
      key: 'unit',
      get label() {
        return t('care:dose_unit');
      },
    },
    {
      key: 'route',
      get label() {
        return t('care:route');
      },
    },
    {
      key: 'scheduledAt',
      get label() {
        return t('care:scheduled_administration_time');
      },
      type: 'datetime-local',
    },
    {
      key: 'instructions',
      get label() {
        return t('care:administration_stop_instructions');
      },
      type: 'textarea',
    },
    {
      key: 'status',
      get label() {
        return t('care:medication_task_status');
      },
      options: ['ordered', 'stopped', 'cancelled'],
    },
  ],
  administration: [
    {
      key: 'medicationId',
      get label() {
        return t('care:medication_administration_task');
      },
      source: 'medication',
    },
    {
      key: 'eventAt',
      get label() {
        return t('care:actual_administration_event_time');
      },
      type: 'datetime-local',
    },
    {
      key: 'outcome',
      get label() {
        return t('care:accountable_outcome');
      },
      options: ['given', 'withheld', 'refused'],
    },
    {
      key: 'reason',
      get label() {
        return t('care:outcome_reason');
      },
      type: 'textarea',
      optional: true,
    },
  ],
  referral: [
    {
      key: 'type',
      get label() {
        return t('care:referral_follow_up');
      },
      options: ['referral', 'follow-up'],
    },
    {
      key: 'destination',
      get label() {
        return t('care:service_destination');
      },
    },
    {
      key: 'reason',
      get label() {
        return t('care:referral_reason');
      },
      type: 'textarea',
    },
    {
      key: 'dueAt',
      get label() {
        return t('care:due_at');
      },
      type: 'datetime-local',
    },
    {
      key: 'ownerId',
      get label() {
        return t('care:assigned_owner');
      },
      source: 'staff',
    },
    {
      key: 'status',
      get label() {
        return t('care:follow_up_status');
      },
      options: ['pending', 'completed', 'cancelled'],
    },
  ],
};
const labels: Record<CareKind, string> = {
  get profile() {
    return t('labels:patient_profile');
  },
  get appointment() {
    return t('labels:appointments');
  },
  get triage() {
    return t('labels:triage');
  },
  get ward() {
    return t('labels:wards');
  },
  get bed() {
    return t('labels:beds');
  },
  get admission() {
    return t('labels:admissions');
  },
  get nursing() {
    return t('labels:nursing_notes');
  },
  get medication() {
    return t('labels:medication_orders');
  },
  get administration() {
    return t('labels:administration_outcomes');
  },
  get referral() {
    return t('labels:referrals_follow_up');
  },
};
const title = (r: CareRecord) => {
  const d = r.data as Record<string, unknown>;
  return String(
    d.name ??
      d.drug ??
      d.destination ??
      d.service ??
      d.shift ??
      (d.urgency ? presentationLabel(d.urgency) : undefined) ??
      (d.outcome ? presentationLabel(d.outcome) : undefined) ??
      d.reason ??
      t('care:care_record'),
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
  const [options, setOptions] = useState<
      Record<string, { id: string; label: string; status?: string; identifier?: string }[]>
    >({}),
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
            label: title(v),
            status: String((v.data as Record<string, unknown>).status ?? 'configured'),
            identifier: v.id.slice(0, 8),
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
    return !dirty || (!pending && window.confirm(t('care:discard_the_unsaved_care_draft')));
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
            setError(uiMessage('dynamic:enter_field', { label: f.label }));
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
        setError(uiMessage('errors:INVALID_REQUEST'));
        return;
      }
      if (!reason.trim()) {
        setError(uiMessage('care:enter_a_reason_for_this_entry_or_amendment'));
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
      setMessage(t('common:saved_named'));
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
      setError(
        uiMessage(
          'care:select_the_canonical_patient_by_name_and_mrn_and_enter_a_resolution_reason',
        ),
      );
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
      setMessage(t('common:identities_linked'));
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
          <h1 id="care-heading">{t('care:patient_care')}</h1>
          <p>{t('care:identity_scheduled_visits_and_accountable_inpatient_care')}</p>
        </div>
        <p className="care-zone">{t('care:gregorian_dates_africa_addis_ababa_utc_03_00')}</p>
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
          {' '}
          {t('care:find_a_patient')}{' '}
          <input
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('care:name_mrn_or_contact')}
            disabled={saving || !!pending}
          />
        </label>
        <button disabled={saving || !!pending}>{t('common:search_patients')}</button>
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
            MRN {patient.recordNumber} {t('care:original_registration')}{' '}
            {displayTime(patient.createdAt)}
          </span>
          {identity && identity.identities.length > 1 && (
            <details>
              <summary>
                {' '}
                {t('care:linked_identities')}
                {identity.identities.length}
                {t('care:histories_retain_original_mrns')}{' '}
              </summary>
              {identity.identities.map((p) => (
                <p key={p.id}>
                  {p.name} · {p.recordNumber}
                  {p.canonicalId ? t('care:duplicate_linked_to_canonical_identity') : ''}{' '}
                  {p.linkReason}
                </p>
              ))}
            </details>
          )}
        </div>
      )}
      <nav className="care-tabs" aria-label={t('care:care_workflows')}>
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
          {interfaceMessage(error)}
        </p>
      )}
      {message && (
        <p role="status" className="care-success">
          {interfaceMessage(message)}
        </p>
      )}
      {!!pending && (
        <div className="care-retry">
          <p>
            {t(
              'care:the_save_result_is_unresolved_your_original_details_and_retry_key_are_preserved',
            )}
          </p>
          <button
            disabled={saving}
            onClick={() =>
              pending.path === '/api/care/identity-links' ? void merge() : void save()
            }
          >
            {' '}
            {t('care:retry_the_same_save')}{' '}
          </button>
        </div>
      )}
      <div className="care-section-heading">
        <h2>{labels[kind]}</h2>
        {canWriteCare(role, kind, { status: 'active' }) &&
          (patient || ['ward', 'bed'].includes(kind)) && (
            <button disabled={saving || !!pending} onClick={() => newRecord(null)}>
              {kind === 'profile' ? t('care:enter_patient_profile') : t('care:new_entry')}
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
            />{' '}
            {t('care:today_only_addis_ababa')}{' '}
          </label>
        )}
      </div>
      {kind === 'triage' && (
        <p>
          {' '}
          {t(
            'care:enter_observed_values_and_select_urgency_yourself_numeric_limits_protect_data_representation_an',
          )}{' '}
        </p>
      )}
      {kind === 'medication' && (
        <p>
          {' '}
          {t(
            'care:one_order_creates_one_administration_task_enter_the_prescribed_dose_unit_route_and_scheduled_ti',
          )}{' '}
        </p>
      )}
      {!patient && !['ward', 'bed'].includes(kind) ? (
        <p className="care-empty">
          {t('care:find_and_select_a_patient_to_view_their_care_records')}
        </p>
      ) : loading ? (
        <p role="status">{t('care:loading_care_records')}</p>
      ) : records.length === 0 ? (
        <p className="care-empty">
          {' '}
          {t('common:no')} {labels[kind].toLowerCase()}{' '}
          {t('care:recorded_authorized_staff_can_create_an_entry')}{' '}
        </p>
      ) : (
        <div
          className="care-table"
          role="region"
          aria-label={t('dynamic:records_label', { label: labels[kind] })}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>{t('care:record_original_identity')}</th>
                <th>{t('common:status')}</th>
                <th>{t('care:event_recorded_time')}</th>
                <th>{t('care:author')}</th>
                <th>{t('common:actions')}</th>
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
                      <small>
                        {t('common:revision_2')} {r.revision}
                      </small>
                      <details>
                        <summary>{t('care:view_entered_details')}</summary>
                        <dl>
                          {Object.entries(d).map(([key, v]) => (
                            <div key={key}>
                              <dt>{fields[kind].find((f) => f.key === key)?.label ?? key}</dt>
                              <dd>
                                {[
                                  'status',
                                  'sex',
                                  'identity',
                                  'allergiesStatus',
                                  'urgency',
                                ].includes(key)
                                  ? presentationLabel(v)
                                  : String(v ?? t('care:not_entered'))}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    </td>
                    <td>
                      {presentationLabel(
                        d.status ??
                          d.identity ??
                          (d.outcome ? presentationLabel(d.outcome) : undefined) ??
                          (d.active === undefined ? 'recorded' : d.active ? 'active' : 'inactive'),
                      )}
                    </td>
                    <td>
                      {d.eventAt || d.start || d.scheduledAt || d.dueAt ? (
                        <span>
                          {displayTime(String(d.eventAt ?? d.start ?? d.scheduledAt ?? d.dueAt))}
                        </span>
                      ) : null}
                      <small>
                        {t('common:recorded')} {displayTime(r.updatedAt)}
                      </small>
                    </td>
                    <td>{r.actorName}</td>
                    <td>
                      {canWriteCare(role, r.kind, d) && (
                        <button disabled={saving || !!pending} onClick={() => newRecord(r)}>
                          {['nursing', 'triage', 'administration'].includes(kind)
                            ? t('care:amend')
                            : t('care:update')}
                        </button>
                      )}
                      {!(role === 'receptionist' && kind === 'admission') && (
                        <button disabled={saving || !!pending} onClick={() => void history(r)}>
                          {' '}
                          {t('common:history')}{' '}
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
            {' '}
            {t('common:previous')}{' '}
          </button>
          <span>
            {' '}
            {t('common:page')} {page} · {total} {t('care:records')}{' '}
          </span>
          <button
            disabled={page * 25 >= total || saving || !!pending}
            onClick={() => setPage(page + 1)}
          >
            {' '}
            {t('common:next')}{' '}
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
            {selected ? t('care:amend_update') : t('care:create')} {labels[kind].toLowerCase()}
          </h3>
          <p>
            {t('care:signed_as')} {session.user.displayName}
            {t('care:earlier_versions_remain_in_the_history')}
          </p>
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
                        {interfaceMessage(f.label)}
                        {f.type === 'datetime-local' ? t('care:addis_ababa_gregorian') : ''}
                        {f.type === 'date' ? t('care:gregorian') : ''}
                        {f.optional ? t('common:optional') : ''}
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
                          {opts && (
                            <option value="">
                              {t('common:select')} {f.label.toLowerCase()}
                            </option>
                          )}
                          {opts
                            ? opts.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.label}
                                  {'status' in o && <> · {presentationLabel(o.status)}</>}
                                  {'identifier' in o && <> · {o.identifier}</>}
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
                                .map((o) => (
                                  <option key={o} value={o}>
                                    {presentationLabel(o)}
                                  </option>
                                ))}
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
                <label htmlFor="care-entry-reason">
                  {t('care:entry_correction_cancellation_reason')}
                </label>
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
              <button type="submit">{saving ? t('common:saving') : t('care:sign_and_save')}</button>
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
                {' '}
                {t('common:discard_draft')}{' '}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {events.length > 0 && (
        <section className="care-history">
          <h3>
            {t('care:immutable_history')} {selected && title(selected)}
          </h3>
          {events.map((e) => (
            <article key={e.id}>
              <h4>
                {' '}
                {t('common:revision_2')} {e.revision} · {e.actorName}
              </h4>
              <p>
                {displayTime(e.createdAt)} · {e.reason}
              </p>
              <dl>
                {Object.entries(e.data as Record<string, unknown>).map(([key, v]) => (
                  <div key={key}>
                    <dt>{fields[selected!.kind].find((f) => f.key === key)?.label ?? key}</dt>
                    <dd>
                      {['status', 'sex', 'identity', 'allergiesStatus', 'urgency'].includes(key)
                        ? presentationLabel(v)
                        : String(v ?? t('care:not_entered'))}
                    </dd>
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
                {' '}
                {t('common:newer_history')}{' '}
              </button>
              <span>
                {t('care:history_page_2')} {historyPage}
              </span>
              <button
                disabled={historyPage * 25 >= historyTotal}
                onClick={() => void history(selected!, historyPage + 1)}
              >
                {' '}
                {t('common:older_history')}{' '}
              </button>
            </div>
          )}
        </section>
      )}
      {kind === 'profile' && identity && identity.visits.length > 0 && (
        <details className="care-longitudinal">
          <summary>
            {t('care:longitudinal_outpatient_history')}
            {identity.visits.length}
            {t('care:latest_100')}
          </summary>
          {identity.visits.map((v) => (
            <p key={v.id}>
              {v.name} · {v.recordNumber} · {presentationLabel(v.status)} ·{' '}
              {displayTime(v.openedAt)} {t('care:encounter')} {v.id}
            </p>
          ))}
        </details>
      )}
      {kind === 'profile' && role === 'admin' && patient && !draft && (
        <details className="care-merge">
          <summary>{t('care:resolve_a_duplicate_patient_identity')}</summary>
          <p>
            {' '}
            {t('care:duplicate')}{' '}
            <strong>
              {patient.name} · {patient.recordNumber}
            </strong>{' '}
            {t(
              'care:select_the_verified_canonical_patient_both_original_identities_and_histories_remain_intact',
            )}{' '}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void searchCanonical(1);
            }}
          >
            <div className="care-field">
              <label htmlFor="care-canonical-search">
                {' '}
                {t('care:find_canonical_patient_by_name_mrn_or_contact')}{' '}
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
              {' '}
              {t('care:search_canonical_patients')}{' '}
            </button>
          </form>
          {mergeLoading && <p role="status">{t('care:searching_this_hospital_s_patients')}</p>}
          {mergeSearched && !mergeLoading && mergePatients.length === 0 && (
            <p>
              {t('care:no_other_matching_patient_found_in_this_hospital_refine_the_name_or_mrn')}
            </p>
          )}
          <ul className="care-patients">
            {mergePatients.map((p) => (
              <li key={p.id}>
                <button
                  disabled={saving || !!pending}
                  aria-pressed={canonicalPatient?.id === p.id}
                  onClick={() => setCanonicalPatient(p)}
                >
                  {' '}
                  {t('care:select_canonical')} {p.name} · {p.recordNumber}
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
                {' '}
                {t('care:previous_canonical_matches')}{' '}
              </button>
              <span>
                {t('common:page')} {mergePage}
              </span>
              <button
                disabled={mergePage * 25 >= mergeTotal || saving || !!pending || mergeLoading}
                onClick={() => void searchCanonical(mergePage + 1)}
              >
                {' '}
                {t('care:next_canonical_matches')}{' '}
              </button>
            </div>
          )}
          {canonicalPatient && (
            <p role="status">
              {' '}
              {t('care:canonical')}{' '}
              <strong>
                {canonicalPatient.name} · {canonicalPatient.recordNumber}
              </strong>
            </p>
          )}
          <div className="care-field">
            <label htmlFor="care-resolution-reason">{t('care:resolution_reason')}</label>
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
            {' '}
            {t('care:link_duplicate_to_canonical_identity')}{' '}
          </button>
        </details>
      )}
    </section>
  );
}
