// Explicit reviewed export projection. Authentication material and request replay caches are excluded.
import type { exportTables } from '../shared/hospital.ts';
export const exportColumns: Record<(typeof exportTables)[number], string> = {
  staff_users: 'id,hospital_id,username,display_name,role,active',
  patients: 'id,hospital_id,record_number,name,normalized_name,age,contact,created_at',
  audit_events:
    'id,hospital_id,actor_id,patient_id,action,created_at,visit_id,visit_revision,detail,subject_type,subject_id,transition_from,transition_to',
  outpatient_visits: 'id,hospital_id,patient_id,revision,status,opened_at,data',
  staff_administration_events:
    'id,hospital_id,actor_id,account_id,action,revision,role,active,created_at',
  hospital_departments: 'id,hospital_id,code,name,active,revision',
  hospital_services: 'id,hospital_id,code,revision',
  hospital_service_versions:
    'hospital_id,service_id,revision,name,active,department_id,department_code,department_name,price_minor,currency,actor_id,actor_name,effective_at',
  hospital_configuration_events:
    'id,hospital_id,actor_id,actor_name,department_id,service_id,revision,action,snapshot,created_at',
  billing_invoices:
    'id,hospital_id,visit_id,number,total_minor,line_count,currency,actor_id,actor_name,issued_at',
  billing_lines:
    'id,hospital_id,invoice_id,position,service_id,service_revision,code,name,quantity,unit_price_minor,total_minor',
  billing_payments:
    'id,hospital_id,invoice_id,amount_minor,method,reference,actor_id,actor_name,created_at',
  billing_receipts: 'id,hospital_id,payment_id,number',
  billing_events:
    'id,hospital_id,invoice_id,revision,action,actor_id,actor_name,created_at,payment_id,reason',
  clinical_amendments: 'id,hospital_id,visit_id,kind,subject_id,body,reason',
  clinical_events:
    'id,hospital_id,visit_id,kind,subject_id,amendment_id,version,action,actor_id,actor_name,created_at,owner_id,owner_name,reason',
  inventory_products: 'id,hospital_id,code,name,unit,active,revision',
  inventory_batches: 'id,hospital_id,product_id,lot,expiry,quarantined,revision',
  inventory_authorizations:
    'id,hospital_id,visit_id,prescription_id,product_id,quantity,actor_id,actor_name,created_at',
  inventory_events:
    'id,hospital_id,action,product_id,batch_id,visit_id,prescription_id,actor_id,actor_name,created_at,snapshot',
  inventory_movements: 'id,hospital_id,batch_id,kind,quantity',
  inventory_dispenses: 'id,hospital_id,authorization_id,movement_id,kind,quantity,visit_revision',
  care_records:
    'id,hospital_id,kind,patient_id,parent_id,responsible_id,encounter_id,revision,data,actor_id,actor_name,created_at,updated_at',
  care_events: 'id,hospital_id,record_id,revision,actor_id,actor_name,reason,data,created_at',
  care_identity_links:
    'hospital_id,duplicate_id,canonical_id,actor_id,actor_name,reason,created_at',
  department_records: 'id,hospital_id,kind,revision,data',
  department_events: 'id,hospital_id,entity_id,action,actor_id,actor_name,created_at,snapshot',
  department_finance:
    'id,hospital_id,invoice_id,payment_id,kind,amount_minor,reason,actor_id,actor_name,authority_id,method,reference,created_at',
  department_allocations: 'hospital_id,shift_id,payment_id,refund_id,amount_minor',
  department_links:
    'hospital_id,record_id,visit_id,product_id,batch_id,dispense_id,supplier_id,clinician_id',
  hospital_profiles: 'hospital_id,revision,settings',
  hospital_facilities: 'id,hospital_id,code,name,address,active,revision',
  hospital_record_requests:
    'id,hospital_id,patient_id,requester,purpose,identity_verification,status,revision,created_at',
  hospital_record_holds: 'id,hospital_id,patient_id,reason,active,revision',
  hospital_governance_events: 'id,hospital_id,actor_id,action,entity_id,reason,snapshot,created_at',
};
export function exportOrder(table: keyof typeof exportColumns) {
  return exportColumns[table]
    .split(',')
    .map((c) => `r.${c}`)
    .join(',');
}
