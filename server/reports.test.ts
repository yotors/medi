import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { EventEmitter } from 'node:events';
import { withReportBudget } from './report-budget.ts';
import { randomBytes,randomUUID } from 'node:crypto';
import { after,before,beforeEach,test } from 'node:test';
import pg from 'pg';
import { buildApp } from './app.ts';
import { digest } from './auth.ts';
import { migrate } from './db.ts';
import type { StaffRole } from '../shared/registration.ts';
import type { OperationalReport } from '../shared/reports.ts';
import type { VisitView } from '../shared/outpatient.ts';
const connectionString=process.env.TEST_DATABASE_URL??process.env.DATABASE_URL;if(!connectionString)throw Error('Reports tests require a database.');
const schema=`reports_test_${randomUUID().replaceAll('-','')}`;const database=new pg.Pool({connectionString});const pool=new pg.Pool({connectionString,options:`-c search_path=${schema} -c application_name=${schema}`});const origin='http://127.0.0.1:5173';let app=buildApp({pool,origin});
type Auth={id:string;hospital:string;cookie:string;csrf:string};let users:Record<StaffRole,Auth>;let other:Auth;const roles:StaffRole[]=['admin','clinician','pharmacist','cashier','auditor','lab','receptionist'];
async function actor(hospital:string,role:StaffRole):Promise<Auth>{const id=randomUUID(),token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');await pool.query('INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES($1,$2,$6,$3,$4,$5)',[id,hospital,`Fictional ${role}`,role,'unused-test-hash',id]);await pool.query("INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",[digest(token),id,csrf]);return{id,hospital,cookie:`staff_session=${token}`,csrf};}
const headers=(user:Auth,key:string=randomUUID())=>({origin,cookie:user.cookie,'x-csrf-token':user.csrf,'idempotency-key':key});
const get=(user:Auth,path:string)=>app.inject({url:path,headers:{cookie:user.cookie}});
const post=(user:Auth,path:string,value:object,key:string=randomUUID())=>app.inject({method:'POST',url:path,headers:headers(user,key),payload:value});
async function ok(user:Auth,path:string,value:object,key?:string){const response=await post(user,path,value,key);assert.equal(response.statusCode,200,response.body);return response.json();}
const stock=(value:object,user?:Auth,key?:string)=>ok(user??users.pharmacist,'/api/inventory/commands',value,key);
const supply=(v:VisitView,value:object,user?:Auth,key?:string)=>ok(user??users.pharmacist,`/api/visits/${v.id}/inventory/commands`,value,key);
async function current(v:Pick<VisitView,'id'>):Promise<VisitView>{return(await get(users.admin,`/api/visits/${v.id}`)).json().visit;}
async function visit(){const p=await post(users.admin,'/api/patients',{name:`Fictional inventory ${randomUUID()}`,contact:''});assert.equal(p.statusCode,201,p.body);const response=await post(users.admin,`/api/patients/${p.json().patient.id}/visits`,{});assert.equal(response.statusCode,201,response.body);let v:VisitView=response.json().visit;v=(await ok(users.clinician,`/api/visits/${v.id}/commands`,{expectedRevision:v.revision,command:{type:'note',body:'Fictional note'}})).visit;v=(await ok(users.clinician,`/api/visits/${v.id}/commands`,{expectedRevision:v.revision,command:{type:'prescribe',instruction:'Fictional instructions; explicit authorization follows.'}})).visit;return current(v);}
async function dates(){return(await pool.query("SELECT to_char((clock_timestamp() AT TIME ZONE 'Africa/Addis_Ababa')::date-1,'YYYY-MM-DD') AS yesterday,to_char(clock_timestamp() AT TIME ZONE 'Africa/Addis_Ababa','YYYY-MM-DD') AS today,to_char((clock_timestamp() AT TIME ZONE 'Africa/Addis_Ababa')::date+1,'YYYY-MM-DD') AS tomorrow")).rows[0];}
async function catalog(quantity=10,expiry?:string){const product=await stock({type:'product.create',code:'FICTION',name:'Fictional item tablet',unit:'tablet'});const batch=await stock({type:'batch.create',productId:product.productId,lot:'LOT-A',expiry:expiry??(await dates()).tomorrow});if(quantity)await stock({type:'stock.receive',batchId:batch.batchId,expectedRevision:1,quantity,reference:'Fictional receipt'});return{productId:product.productId,batchId:batch.batchId};}
async function batches(productId:string){const response=await get(users.pharmacist,`/api/inventory/products/${productId}/batches`);assert.equal(response.statusCode,200,response.body);return response.json();}
async function allocated(quantity=4,stockQuantity=10){const c=await catalog(stockQuantity);let v=await visit();await supply(v,{type:'authorize',prescriptionId:v.prescriptions![0].id,expectedVisitRevision:v.revision,productId:c.productId,quantity},users.clinician);v=await current(v);return{...c,v,prescriptionId:v.prescriptions![0].id};}
before(async()=>{await database.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
beforeEach(async()=>{await pool.query('TRUNCATE hospitals CASCADE');const alpha=randomUUID(),beta=randomUUID();await pool.query("INSERT INTO hospitals(id,code,name) VALUES($1,'alpha','Fictional Alpha'),($2,'beta','Fictional Beta')",[alpha,beta]);users={}as Record<StaffRole,Auth>;for(const role of roles)users[role]=await actor(alpha,role);other=await actor(beta,'admin');});
after(async()=>{await app.close();await pool.end();await database.query(`DROP SCHEMA ${schema} CASCADE`);await database.end();});

const url=(from='2026-10-01',to='2026-10-31',page=1)=>`/api/reports/operational?from=${from}&to=${to}&inventoryPage=${page}`;
async function report(user=users.admin,from='2026-10-01',to='2026-10-31',page=1):Promise<OperationalReport>{const response=await get(user,url(from,to,page));assert.equal(response.statusCode,200,response.body);return response.json();}
async function apply(v:VisitView,command:object){return(await ok(users.admin,`/api/visits/${v.id}/commands`,{expectedRevision:v.revision,command})).visit as VisitView;}
async function clockDefault<T>(table:string,instant:string,work:()=>Promise<T>){await pool.query(`ALTER TABLE ${table} ALTER COLUMN created_at SET DEFAULT '${instant}'::timestamptz`);try{return await work();}finally{await pool.query(`ALTER TABLE ${table} ALTER COLUMN created_at SET DEFAULT clock_timestamp()`);}}
async function billing(v:VisitView,command:object){return ok(users.admin,`/api/visits/${v.id}/billing/commands`,command);}
async function service(price=10000){const dep=await ok(users.admin,'/api/configuration/commands',{type:'department.create',code:`D${randomUUID().slice(0,8).toUpperCase()}`,name:'Fictional department'});return(await ok(users.admin,'/api/configuration/commands',{type:'service.create',departmentId:dep.entry.id,code:`S${randomUUID().slice(0,8).toUpperCase()}`,name:'Fictional service',priceMinor:price})).entry.id;}
async function invoice(v:VisitView,serviceId:string){return(await billing(v,{type:'invoice.issue',lines:[{serviceId,serviceRevision:1,quantity:1}]})).invoiceId;}

test('strict Gregorian ranges include leap day and independent half-open Addis/year boundaries',async()=>{
  for(const query of ['', '?from=2026-02-30&to=2026-03-01','?from=2026-10-02&to=2026-10-01','?from=2024-01-01&to=2025-01-01','?from=2026-01-01&to=2026-01-01&inventoryPage=0','?from=2026-01-01&to=2026-01-01&hospitalId=x','?from=0000-01-01&to=0000-01-01'])assert.equal((await get(users.admin,`/api/reports/operational${query}`)).statusCode,400);
  const leap=await report(users.admin,'2024-01-01','2024-12-31');assert.equal(leap.range.start,'2023-12-31T21:00:00.000Z');assert.equal(leap.range.endExclusive,'2024-12-31T21:00:00.000Z');
  assert.equal((await report(users.admin,'2024-02-29','2024-02-29')).range.endExclusive,'2024-02-29T21:00:00.000Z');assert.equal((await report(users.admin,'1999-12-31','2000-01-01')).range.start,'1999-12-30T21:00:00.000Z');
  for(const date of ['0001-01-01','9999-12-31'])assert.equal((await get(users.admin,url(date,date))).statusCode,200);
});
test('empty report is zero-valued, role-projected, immutable audited and omits protected source data',async()=>{
  const r=await report();assert.deepEqual(r.operations,{period:{visitsOpened:0,visitsClosed:0,noteAmendments:0,resultCorrections:0},current:{activeVisits:0,pendingInvestigations:0,pendingPrescriptions:0,pendingCorrectedResultReviews:0}});
  assert.equal(r.finance!.period.collectedMinor,'0');assert.equal(r.finance!.period.byMethod.manual_transfer.receiptCount,0);assert.deepEqual(r.inventory!.entries,[]);
  const event=(await pool.query('SELECT * FROM report_access_events WHERE id=$1',[r.auditId])).rows[0];assert.equal(event.actor_id,users.admin.id);assert.equal(event.generated_at.toISOString(),r.generatedAt);assert.deepEqual(event.authorized_sections,r.authorizedSections);assert.equal(event.product_row_count,0);
  await assert.rejects(pool.query('UPDATE report_access_events SET actor_name=actor_name WHERE id=$1',[r.auditId]),/immutable/);await assert.rejects(pool.query('DELETE FROM report_access_events WHERE id=$1',[r.auditId]),/immutable/);
  const expected={admin:['operations','finance','inventory'],auditor:['operations','finance','inventory'],clinician:['operations'],cashier:['finance'],pharmacist:['inventory']};
  for(const [role,sections]of Object.entries(expected)){const result=await report(users[role as StaffRole]);assert.deepEqual(result.authorizedSections,sections);for(const key of ['operations','finance','inventory'])assert.equal(Object.hasOwn(result,key),sections.includes(key));}
  const before=(await pool.query('SELECT count(*) FROM report_access_events')).rows[0].count;
  for(const role of ['lab','receptionist']as const)assert.equal((await get(users[role],url())).statusCode,403);assert.equal((await app.inject({url:url()})).statusCode,401);assert.equal((await pool.query('SELECT count(*) FROM report_access_events')).rows[0].count,before);
});
test('opened-outside closed-inside uses closure time and exact start/end boundaries, without changing visits',async()=>{
  let v=await visit();v=await apply(v,{type:'fulfill',prescriptionId:v.prescriptions![0].id,next:'cancelled'});
  await pool.query("UPDATE outpatient_visits SET status='closed',opened_at=$2::timestamptz,data=jsonb_set(jsonb_set(jsonb_set(data,'{openedAt}',to_jsonb($2::text)),'{closedAt}',to_jsonb($3::text)),'{status}','\"closed\"') WHERE id=$1",[v.id,'2026-09-01T00:00:00Z','2026-10-13T21:00:00Z']);
  const second=await visit();await pool.query("UPDATE outpatient_visits SET opened_at=$2::timestamptz,data=jsonb_set(data,'{openedAt}',to_jsonb($2::text)) WHERE id=$1",[second.id,'2026-10-14T21:00:00Z']);
  const before=(await pool.query('SELECT * FROM outpatient_visits ORDER BY id')).rows;const r=await report(users.admin,'2026-10-14','2026-10-14');assert.equal(r.operations!.period.visitsClosed,1);assert.equal(r.operations!.period.visitsOpened,0);assert.equal(r.operations!.current.activeVisits,1);assert.equal(r.operations!.current.pendingPrescriptions,1);assert.deepEqual((await pool.query('SELECT * FROM outpatient_visits ORDER BY id')).rows,before);
  assert.equal((await report(users.admin,'2026-10-15','2026-10-15')).operations!.period.visitsOpened,1);
});
test('partial multi-day payments, voids, legacy exclusion and totals above32bit reconcile without join multiplication',async()=>{
  const sid=await service(999999999);const v=await visit();const inv=await invoice(v,sid);
  await clockDefault('billing_payments','2026-10-13T21:00:00Z',()=>billing(v,{type:'payment.record',invoiceId:inv,expectedRevision:1,amountMinor:100,method:'cash'}));
  await clockDefault('billing_payments','2026-10-14T21:00:00Z',()=>billing(v,{type:'payment.record',invoiceId:inv,expectedRevision:2,amountMinor:200,method:'manual_transfer',reference:'Private payment reference'}));
  const voidVisit=await visit(),voidInvoice=await invoice(voidVisit,sid);await billing(voidVisit,{type:'invoice.void',invoiceId:voidInvoice,expectedRevision:1,reason:'Fictional void'});
  for(let i=0;i<3;i++)await invoice(await visit(),sid);
  const r=await report(users.cashier,'2026-10-14','2026-10-14');assert.equal(r.finance!.period.collectedMinor,'100');assert.equal(r.finance!.period.receiptCount,1);assert.equal(r.finance!.current.outstandingMinor,'3999999696');assert.equal(r.finance!.current.outstandingInvoiceCount,4);
  const two=await report(users.admin,'2026-10-14','2026-10-15');assert.equal(two.finance!.period.collectedMinor,'300');assert.equal(two.finance!.period.byMethod.manual_transfer.collectedMinor,'200');assert.equal(two.finance!.period.receiptCount,2);assert.equal(JSON.stringify(two).includes('Private payment reference'),false);assert.equal(JSON.stringify(two).includes(v.patient.name),false);
  const patientId=randomUUID(),legacyId=randomUUID();await pool.query("INSERT INTO patients(id,hospital_id,record_number,name,normalized_name) VALUES($1::uuid,$2,$1::text,'Fictional legacy','fictional legacy')",[patientId,users.admin.hospital]);await pool.query("INSERT INTO outpatient_visits(id,hospital_id,patient_id,revision,status,opened_at,data) VALUES($1,$2,$3,1,'active','2026-10-14T00:00:00Z',$4)",[legacyId,users.admin.hospital,patientId,{id:legacyId,patientId,status:'active',openedAt:'2026-10-14T00:00:00Z',notes:[],orders:[],prescriptions:[],charges:[],payments:[{id:randomUUID(),amount:500000,at:'2026-10-14T00:00:00Z'}]}]);assert.equal((await report()).finance!.period.collectedMinor,'300');
  const paidSid=await service(900000000);for(let i=0;i<3;i++){const pv=await visit(),pi=await invoice(pv,paidSid);await clockDefault('billing_payments','2026-10-15T00:00:00Z',()=>billing(pv,{type:'payment.record',invoiceId:pi,expectedRevision:1,amountMinor:900000000,method:'cash'}));}assert.equal((await report()).finance!.period.collectedMinor,'2700000300');
});
test('partial supply and latest corrected-result backlog stay current outside selected period, including closed visits',async()=>{
  const {v:initial,batchId,prescriptionId}=await allocated();let v=initial;await supply(v,{type:'dispense',prescriptionId,expectedVisitRevision:v.revision,batchId,expectedBatchRevision:2,quantity:1});v=await current(v);
  await ok(users.clinician,`/api/visits/${v.id}/clinical/commands`,{type:'note.amend',subjectId:v.notes![0].id,expectedVersion:0,body:'Private amended narrative',reason:'Fictional correction'});
  v=await current(v);v=await apply(v,{type:'order',test:'Blood count'});const oid=v.orders![0].id;v=await apply(v,{type:'advanceOrder',orderId:oid,next:'collected'});v=await apply(v,{type:'advanceOrder',orderId:oid,next:'released',result:'Private result'});v=await apply(v,{type:'advanceOrder',orderId:oid,next:'reviewed'});
  for(const version of [0,1])await ok(users.admin,`/api/visits/${v.id}/clinical/commands`,{type:'result.correct',subjectId:oid,expectedVersion:version,body:`Private corrected result ${version}`,reason:'Fictional',ownerId:users.clinician.id});
  const r=await report(users.clinician,'2020-01-01','2020-01-01');assert.equal(r.operations!.period.resultCorrections,0);assert.equal(r.operations!.current.pendingPrescriptions,1);assert.equal(r.operations!.current.pendingCorrectedResultReviews,1);assert.equal(r.operations!.current.pendingInvestigations,0);
  const date=(await dates()).today;const actual=await report(users.clinician,date,date);assert.equal(actual.operations!.period.noteAmendments,1);assert.equal(actual.operations!.period.resultCorrections,2);assert.equal(JSON.stringify(actual).includes('Private'),false);
  v=await current(v);const corrected=v.clinical!.records.find(record=>record.subjectId===oid)!;await ok(users.clinician,`/api/visits/${v.id}/clinical/commands`,{type:'result.review',subjectId:oid,expectedVersion:2,amendmentId:corrected.latest.id});assert.equal((await report()).operations!.current.pendingCorrectedResultReviews,0);
  v=await current(v);await supply(v,{type:'dispense',prescriptionId,expectedVisitRevision:v.revision,batchId,expectedBatchRevision:3,quantity:3});v=await current(v);v=await apply(v,{type:'close'});
  await ok(users.admin,`/api/visits/${v.id}/clinical/commands`,{type:'result.correct',subjectId:oid,expectedVersion:3,body:'Fictional correction after closure',reason:'Fictional',ownerId:users.clinician.id});assert.equal((await report()).operations!.current.pendingCorrectedResultReviews,1);
});
test('inventory categories are disjoint, period movement signs reconcile, pages and populated tenants stay isolated',async()=>{
  const {v,batchId,productId,prescriptionId}=await allocated();await supply(v,{type:'dispense',prescriptionId,expectedVisitRevision:v.revision,batchId,expectedBatchRevision:2,quantity:1});
  await stock({type:'stock.adjust',batchId,expectedRevision:3,quantity:-2,reason:'Fictional discrepancy'});
  const d=await dates();for(const [lot,expiry,quarantine]of [['EXPIRED',d.yesterday,false],['TODAY',d.today,false],['QUARANTINE',d.yesterday,true]]as const){const b=await stock({type:'batch.create',productId,lot,expiry});await stock({type:'stock.receive',batchId:b.batchId,expectedRevision:1,quantity:5,reference:'Fictional'});if(quarantine)await stock({type:'batch.status',batchId:b.batchId,expectedRevision:2,quarantined:true,reason:'Fictional'});}
  const r=await report(users.admin,d.today,d.today),p=r.inventory!.entries[0];assert.deepEqual(p.current,{total:'22',available:'7',inactive:'0',quarantined:'5',expired:'5',expiryToday:'5'});assert.deepEqual(p.period,{received:'25',supplied:'1',adjustmentNet:'-2',movementNet:'22'});
  await stock({type:'product.status',productId,expectedRevision:1,active:false,reason:'Fictional inactive'});const inactive=(await report()).inventory!.entries[0];assert.deepEqual(inactive.current,{total:'22',available:'0',inactive:'22',quarantined:'0',expired:'0',expiryToday:'0'});
  assert.deepEqual((await report(users.pharmacist,'2020-01-01','2020-01-01')).inventory!.entries[0].period,{received:'0',supplied:'0',adjustmentNet:'0',movementNet:'0'});
  for(let i=0;i<26;i++)await stock({type:'product.create',code:`Z${String(i).padStart(2,'0')}`,name:'Fictional product',unit:i%2?'vial':'tablet'});
  const a=await report(),b=await report(users.admin,'2026-10-01','2026-10-31',2);assert.equal(a.inventory!.entries.length,25);assert.equal(b.inventory!.entries.length,2);assert.equal(a.inventory!.total,27);assert.equal(new Set([...a.inventory!.entries,...b.inventory!.entries].map(p=>p.productId)).size,27);assert.equal(b.inventory!.entries[0].current.total,'0');
  const foreign=await stock({type:'product.create',code:'FOREIGN',name:'Other hospital only',unit:'box'},other);assert.deepEqual((await report(other)).inventory!.entries.map(p=>p.productId),[foreign.productId]);assert.equal((await report()).inventory!.entries.some(p=>p.productId===foreign.productId),false);
  assert.equal((await pool.query('SELECT product_row_count FROM report_access_events WHERE id=$1',[b.auditId])).rows[0].product_row_count,2);
});
test('failed audit rolls back access and returns no aggregate data',async()=>{
  await pool.query("CREATE FUNCTION fail_report_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'injected'; END;$$; CREATE TRIGGER fail_report BEFORE INSERT ON report_access_events FOR EACH ROW EXECUTE FUNCTION fail_report_audit()");
  try{const response=await get(users.admin,url());assert.equal(response.statusCode,500);assert.equal(response.body.includes('operations'),false);assert.equal((await pool.query('SELECT count(*) FROM report_access_events')).rows[0].count,'0');}finally{await pool.query('DROP TRIGGER fail_report ON report_access_events; DROP FUNCTION fail_report_audit()');}
  assert.ok((await report()).auditId);
});
async function blockedBy(pid:number){for(let i=0;i<150;i++){if((await database.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[schema,pid])).rowCount)return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('request did not reach the hospital lock');}
test('post-lock deactivation, role change, password reset and session expiry deny report and audit',async()=>{
  for(const change of ['active','role','reset','expiry']){const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE',[users.admin.hospital]);const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;const response=Promise.resolve(get(users.admin,url()));
    try{await blockedBy(pid);if(change==='expiry')await blocker.query("UPDATE staff_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[users.admin.id]);else await blocker.query(`UPDATE staff_users SET ${change==='active'?'active=false':change==='role'?"role='receptionist'":'password_change_required=true'} WHERE id=$1`,[users.admin.id]);await blocker.query('COMMIT');assert.equal((await response).statusCode,401);assert.equal((await pool.query('SELECT count(*) FROM report_access_events')).rows[0].count,'0');}finally{await blocker.query('ROLLBACK');blocker.release();await pool.query("UPDATE staff_users SET active=true,role='admin',password_change_required=false WHERE id=$1",[users.admin.id]);await pool.query("UPDATE staff_sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE user_id=$1",[users.admin.id]);}}
});
test('hospital snapshot excludes concurrent stock write until audited report commits',async()=>{
  const {batchId}=await catalog();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>entered=resolve);let held=false;let pid=0;
  const wrapped=new Proxy(pool,{get(target,key){if(key==='connect')return async()=>{const client=await target.connect();return new Proxy(client,{get(c,k){if(k==='query')return async(sql:string,...args:unknown[])=>{const result=await(c.query as Function).call(c,sql,...args);if(sql.includes('FROM hospitals')&&sql.includes('FOR SHARE')&&!held){held=true;pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;entered();await gate;}return result;};const value=Reflect.get(c,k);return typeof value==='function'?value.bind(c):value;}});};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const snapshotApp=buildApp({pool:wrapped,origin});try{const response=Promise.resolve(snapshotApp.inject({url:url(),headers:{cookie:users.admin.cookie}}));await ready;const write=Promise.resolve(post(users.pharmacist,'/api/inventory/commands',{type:'stock.receive',batchId,expectedRevision:2,quantity:1,reference:'Concurrent fictional'}));await blockedBy(pid);release();const r=await response;assert.equal(r.statusCode,200,r.body);assert.equal(r.json().inventory.entries[0].current.total,'10');assert.equal((await write).statusCode,200);assert.equal((await report()).inventory!.entries[0].current.total,'11');assert.ok((await pool.query('SELECT id FROM report_access_events WHERE id=$1',[r.json().auditId])).rowCount);}finally{release();await snapshotApp.close();}
});
test('populated foreign operations, corrections, receipts and balances cannot leak into successful reports',async()=>{
  const local=await visit();const localService=await service(300);const localInvoice=await invoice(local,localService);await billing(local,{type:'payment.record',invoiceId:localInvoice,expectedRevision:1,amountMinor:100,method:'cash'});
  const patient=(await post(other,'/api/patients',{name:'Foreign private name',contact:''})).json().patient;const fv=(await post(other,`/api/patients/${patient.id}/visits`,{})).json().visit;
  const dep=await ok(other,'/api/configuration/commands',{type:'department.create',code:'OTHER',name:'Other department'});const sid=(await ok(other,'/api/configuration/commands',{type:'service.create',departmentId:dep.entry.id,code:'OTHER',name:'Other service',priceMinor:500})).entry.id;
  const inv=(await ok(other,`/api/visits/${fv.id}/billing/commands`,{type:'invoice.issue',lines:[{serviceId:sid,serviceRevision:1,quantity:1}]})).invoiceId;await ok(other,`/api/visits/${fv.id}/billing/commands`,{type:'payment.record',invoiceId:inv,expectedRevision:1,amountMinor:137,method:'cash'});
  const withNote=(await ok(other,`/api/visits/${fv.id}/commands`,{expectedRevision:fv.revision,command:{type:'note',body:'Other private narrative'}})).visit;await ok(other,`/api/visits/${fv.id}/clinical/commands`,{type:'note.amend',subjectId:withNote.notes[0].id,expectedVersion:0,body:'Other private amendment',reason:'Fictional'});
  const day=(await dates()).today,own=await report(users.admin,day,day),foreign=await report(other,day,day);assert.equal(own.operations!.period.visitsOpened,1);assert.equal(own.operations!.period.noteAmendments,0);assert.equal(own.operations!.current.activeVisits,1);assert.equal(own.finance!.period.collectedMinor,'100');assert.equal(own.finance!.current.outstandingMinor,'200');assert.equal(foreign.operations!.period.noteAmendments,1);assert.equal(foreign.finance!.period.collectedMinor,'137');assert.equal(foreign.finance!.current.outstandingMinor,'363');
});
test('stock aggregate exceeds32bit using valid bounded movements across multiple batches',async()=>{
  const {productId,batchId}=await catalog(0,'2099-12-31');const ids=[batchId];for(let i=0;i<2;i++)ids.push((await stock({type:'batch.create',productId,lot:`BIG-${i}`,expiry:'2099-12-31'})).batchId);
  // Bulk fixture uses the real movement/event constraints; each batch remains within its one-billion limit.
  for(const id of ids)await pool.query(`WITH events AS (INSERT INTO inventory_events(id,hospital_id,action,product_id,batch_id,actor_id,actor_name,snapshot)
    SELECT gen_random_uuid(),$1,'stock.receive',$2,$3,$4,'Fictional bulk fixture','{}'::jsonb FROM generate_series(1,1000) RETURNING id)
    INSERT INTO inventory_movements(id,hospital_id,batch_id,kind,quantity) SELECT id,$1,$3,'stock.receive',1000000 FROM events`,[users.admin.hospital,productId,id,users.admin.id]);
  const day=(await dates()).today,p=(await report(users.pharmacist,day,day)).inventory!.entries[0];assert.equal(p.current.total,'3000000000');assert.equal(p.current.available,'3000000000');assert.equal(p.period.received,'3000000000');assert.equal(p.period.movementNet,'3000000000');
});
test('bounded lock contention returns503 without an access entry or aggregate response',async()=>{
  const blocker=await pool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE',[users.admin.hospital]);
  const wrapped=new Proxy(pool,{get(target,key){if(key==='connect')return async()=>{const client=await target.connect();return new Proxy(client,{get(c,k){if(k==='query')return(sql:string,...args:unknown[])=>(c.query as Function).call(c,sql==="SET LOCAL lock_timeout='5s'"?"SET LOCAL lock_timeout='30ms'":sql,...args);const value=Reflect.get(c,k);return typeof value==='function'?value.bind(c):value;}});};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const busyApp=buildApp({pool:wrapped,origin});try{const response=await busyApp.inject({url:url(),headers:{cookie:users.admin.cookie}});assert.equal(response.statusCode,503);assert.equal(response.json().code,'REPORT_BUSY');assert.equal(response.body.includes('operations'),false);assert.equal((await pool.query('SELECT count(*) FROM report_access_events')).rows[0].count,'0');}finally{await blocker.query('ROLLBACK');blocker.release();await busyApp.close();}
});

test('investigations count ordered, collected and released work but exclude reviewed and cancelled regardless of period',async()=>{
  for(const state of ['ordered','collected','released','reviewed','cancelled']){
    let v=await visit();v=await apply(v,{type:'order',test:'Blood count'});const id=v.orders!.at(-1)!.id;
    if(state==='cancelled')v=await apply(v,{type:'advanceOrder',orderId:id,next:'cancelled'});
    else if(state!=='ordered'){
      v=await apply(v,{type:'advanceOrder',orderId:id,next:'collected'});
      if(state!=='collected')v=await apply(v,{type:'advanceOrder',orderId:id,next:'released',result:'Fictional result'});
      if(state==='reviewed')v=await apply(v,{type:'advanceOrder',orderId:id,next:'reviewed'});
    }
  }
  const r=await report(users.clinician,'2001-01-01','2001-01-01');assert.equal(r.operations!.period.visitsOpened,0);assert.equal(r.operations!.current.pendingInvestigations,3);
});

test('stock event timestamps include start and exclude end for each movement kind',async()=>{
  const {v:initial,batchId,productId,prescriptionId}=await clockDefault('inventory_events','2026-10-12T00:00:00Z',()=>allocated(20,100));let v=initial,revision=2;
  const times=['2026-10-13T20:59:59.999Z','2026-10-13T21:00:00Z','2026-10-13T21:00:00.001Z','2026-10-14T20:59:59.999Z','2026-10-14T21:00:00Z','2026-10-14T21:00:00.001Z'];
  for(const instant of times){
    await clockDefault('inventory_events',instant,()=>stock({type:'stock.receive',batchId,expectedRevision:revision++,quantity:10,reference:'Fictional boundary receipt'}));
    await clockDefault('inventory_events',instant,()=>supply(v,{type:'dispense',prescriptionId,expectedVisitRevision:v.revision,batchId,expectedBatchRevision:revision++,quantity:1}));v=await current(v);
    await clockDefault('inventory_events',instant,()=>stock({type:'stock.adjust',batchId,expectedRevision:revision++,quantity:-2,reason:'Fictional boundary adjustment'}));
  }
  const p=(await report(users.pharmacist,'2026-10-14','2026-10-14')).inventory!.entries.find(p=>p.productId===productId)!;
  assert.deepEqual(p.period,{received:'30',supplied:'3',adjustmentNet:'-6',movementNet:'21'});assert.equal(p.current.total,'142');
});

function observePool(beforeQuery:(sql:string,client:pg.PoolClient)=>Promise<void>|void,afterQuery?:(sql:string,client:pg.PoolClient)=>Promise<void>|void){
  return new Proxy(pool,{get(target,key){if(key==='connect')return async()=>{const client=await target.connect();return new Proxy(client,{get(c,k){if(k==='query')return async(sql:string,...args:unknown[])=>{await beforeQuery(sql,c);const result=await(c.query as Function).call(c,sql,...args);await afterQuery?.(sql,c);return result;};const value=Reflect.get(c,k);return typeof value==='function'?value.bind(c):value;}});};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
}

test('populated role projections execute only authorized aggregates and later-page audit captures every field',async()=>{
  await catalog();const v=await visit(),sid=await service(1000),iid=await invoice(v,sid);await billing(v,{type:'payment.record',invoiceId:iid,expectedRevision:1,amountMinor:123,method:'cash'});
  for(let i=0;i<26;i++)await stock({type:'product.create',code:`Z${String(i).padStart(2,'0')}`,name:'Fictional paging product',unit:'vial'});
  const day=(await dates()).today,full=await report(users.admin,day,day);let executed:string[]=[];
  const guarded=buildApp({pool:observePool(sql=>{if(sql.includes('FROM outpatient_visits')||sql.includes('FROM clinical_events'))executed.push('operations');if(sql.includes('FROM billing_payments')||sql.includes('FROM billing_invoices'))executed.push('finance');if(sql.includes('FROM inventory_products'))executed.push('inventory');}),origin});
  try{for(const role of roles){executed=[];const r=await guarded.inject({url:url(day,day),headers:{cookie:users[role].cookie}});const expected=role==='admin'||role==='auditor'?['operations','finance','inventory']:role==='clinician'?['operations']:role==='cashier'?['finance']:role==='pharmacist'?['inventory']:[];
    if(!expected.length){assert.equal(r.statusCode,403);assert.deepEqual(executed,[]);continue;}
    assert.equal(r.statusCode,200,r.body);const value=r.json();for(const section of ['operations','finance','inventory'] as const){assert.equal(Object.hasOwn(value,section),expected.includes(section));if(expected.includes(section))assert.deepEqual(value[section],full[section]);}assert.deepEqual([...new Set(executed)].sort(),expected.toSorted());
  }}finally{await guarded.close();}
  const r=await report(users.pharmacist,'2004-02-28','2004-03-01',2);const event=(await pool.query("SELECT id,hospital_id,actor_id,actor_name,actor_role,report_kind,to_char(date_from,'YYYY-MM-DD') AS date_from,to_char(date_to,'YYYY-MM-DD') AS date_to,generated_at,authorized_sections,inventory_page,page_size,product_row_count FROM report_access_events WHERE id=$1",[r.auditId])).rows[0];
  assert.deepEqual({...event,generated_at:event.generated_at.toISOString()},{id:r.auditId,hospital_id:users.pharmacist.hospital,actor_id:users.pharmacist.id,actor_name:'Fictional pharmacist',actor_role:'pharmacist',report_kind:'operational',date_from:'2004-02-28',date_to:'2004-03-01',generated_at:r.generatedAt,authorized_sections:['inventory'],inventory_page:2,page_size:25,product_row_count:2});
});

test('hospital lock spans section transitions and uncommitted read audit while payments wait',async()=>{
  const sid=await service(1000),day=(await dates()).today;
  for(const phase of ['sections','audit']){
    const v=await visit(),iid=await invoice(v,sid),beforeReport=await report(users.admin,day,day);let release!:()=>void,entered!:()=>void,pid=0,held=false;
    const gate=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>entered=resolve);
    const hold=async(sql:string,c:pg.PoolClient)=>{if(!held&&sql.includes(phase==='sections'?'SELECT p.method':'INSERT INTO report_access_events')){held=true;pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;entered();await gate;}};
    const scoped=buildApp({pool:phase==='sections'?observePool(hold):observePool(()=>{},hold),origin});
    try{const reading=Promise.resolve(scoped.inject({url:url(day,day),headers:{cookie:users.admin.cookie}}));await ready;const paying=Promise.resolve(post(users.cashier,`/api/visits/${v.id}/billing/commands`,{type:'payment.record',invoiceId:iid,expectedRevision:1,amountMinor:250,method:'cash'}));await blockedBy(pid);
      assert.equal((await pool.query('SELECT count(*) FROM report_access_events')).rows[0].count,phase==='sections'?'1':'4');release();const response=await reading;assert.equal(response.statusCode,200,response.body);assert.deepEqual(response.json().finance,beforeReport.finance);assert.equal((await paying).statusCode,200);
      const next=await report(users.admin,day,day);assert.equal(BigInt(next.finance!.period.collectedMinor)-BigInt(beforeReport.finance!.period.collectedMinor),250n);
    }finally{release();await scoped.close();}
  }
});

test('one monotonic budget expires across short statements, rolls back and releases the hospital lock',async context=>{
  const {batchId}=await catalog();let elapsed=0;const limits:number[]=[];const statements:string[]=[];
  const clock=context.mock.method(performance,'now',()=>elapsed);
  const watched=observePool(sql=>{statements.push(sql);const limit=/SET LOCAL statement_timeout='(\d+)ms'/.exec(sql);if(limit)limits.push(Number(limit[1]));},sql=>{if(sql.includes('FROM outpatient_visits')||sql.includes('FROM clinical_events')||sql.includes('SELECT p.method'))elapsed+=3400;});
  const timed=buildApp({pool:watched,origin});
  try{const response=await timed.inject({url:url(),headers:{cookie:users.admin.cookie}});assert.equal(response.statusCode,503);assert.equal(response.json().code,'REPORT_BUSY');assert.equal(response.body.includes('operations'),false);assert.equal(statements.some(sql=>sql.startsWith('INSERT INTO report_access_events')),false);assert.equal((await pool.query('SELECT count(*) FROM report_access_events')).rows[0].count,'0');assert.ok(limits.includes(6600)&&limits.includes(3200));clock.mock.restore();
    await stock({type:'stock.receive',batchId,expectedRevision:2,quantity:1,reference:'Fictional recovery'});assert.equal((await report()).inventory!.entries[0].current.total,'11');
  }finally{clock.mock.restore();await timed.close();}
});

test('deadline while waiting for a connection removes listeners and releases a late acquisition',async context=>{
  context.mock.timers.enable({apis:['setTimeout']});
  const incoming=Object.assign(new EventEmitter(),{aborted:false}),outgoing=Object.assign(new EventEmitter(),{writableEnded:false,destroyed:false});let releaseConnection!:(client:pg.PoolClient)=>void,releases=0,worked=false;
  const waiting=new Promise<pg.PoolClient>(resolve=>releaseConnection=resolve);const delayed={connect:()=>waiting} as unknown as pg.Pool;
  const pending=withReportBudget(delayed,{raw:incoming} as Parameters<typeof withReportBudget>[1],{raw:outgoing} as Parameters<typeof withReportBudget>[2],async()=>{worked=true;});
  const rejected=assert.rejects(pending,(error:unknown)=>(error as {code:string}).code==='REPORT_BUSY');context.mock.timers.tick(10000);await rejected;
  assert.equal(incoming.listenerCount('aborted'),0);assert.equal(outgoing.listenerCount('close'),0);
  releaseConnection({release:()=>{releases++;}} as unknown as pg.PoolClient);await new Promise(resolve=>setImmediate(resolve));assert.equal(releases,1);assert.equal(worked,false);context.mock.timers.reset();
});

test('already abandoned requests never acquire a connection or start report work',async()=>{
  for(const state of ['request','response']){
    const incoming=Object.assign(new EventEmitter(),{aborted:state==='request'}),outgoing=Object.assign(new EventEmitter(),{writableEnded:false,destroyed:state==='response'});let acquired=false;
    await assert.rejects(withReportBudget({connect:async()=>{acquired=true;throw Error('must not connect');}} as unknown as pg.Pool,{raw:incoming} as Parameters<typeof withReportBudget>[1],{raw:outgoing} as Parameters<typeof withReportBudget>[2],async()=>assert.fail('must not work')),(error:unknown)=>(error as {code:string}).code==='REPORT_BUSY');
    assert.equal(acquired,false);assert.equal(incoming.listenerCount('aborted'),0);assert.equal(outgoing.listenerCount('close'),0);
  }
});

test('remaining cumulative time bounds an active database statement and recovery releases its lock',async context=>{
  const {batchId}=await catalog();let elapsed=0,delayed=false;const clock=context.mock.method(performance,'now',()=>elapsed);
  const scoped=buildApp({pool:observePool(async(sql,c)=>{if(sql.startsWith('SELECT u.*')&&!delayed){delayed=true;await c.query('SELECT pg_sleep(0.3)');}},sql=>{if(sql.includes('FROM hospitals')&&sql.includes('FOR SHARE'))elapsed=9900;}),origin});
  try{const response=await scoped.inject({url:url(),headers:{cookie:users.admin.cookie}});assert.equal(response.statusCode,503);assert.equal(response.json().code,'REPORT_BUSY');assert.equal((await pool.query('SELECT count(*) FROM report_access_events')).rows[0].count,'0');clock.mock.restore();await stock({type:'stock.receive',batchId,expectedRevision:2,quantity:1,reference:'Fictional active-query recovery'});assert.equal((await report()).inventory!.entries[0].current.total,'11');}
  finally{clock.mock.restore();await scoped.close();}
});

test('a disconnected response stops further aggregate and audit work and destroys its transaction client',async()=>{
  const incoming=Object.assign(new EventEmitter(),{aborted:false}),outgoing=Object.assign(new EventEmitter(),{writableEnded:false,destroyed:false});const statements:string[]=[],releases:unknown[]=[];
  const client={query:async(sql:string)=>{statements.push(sql);return{rows:[]};},release:(destroy:boolean)=>releases.push(destroy)} as unknown as pg.PoolClient;
  await assert.rejects(withReportBudget({connect:async()=>client} as unknown as pg.Pool,{raw:incoming} as Parameters<typeof withReportBudget>[1],{raw:outgoing} as Parameters<typeof withReportBudget>[2],async c=>{
    await c.query('BEGIN');outgoing.emit('close');await c.query('SELECT sensitive_aggregate');await c.query('INSERT INTO report_access_events');
  }),(error:unknown)=>(error as {code:string}).code==='REPORT_BUSY');
  assert.deepEqual(statements,['BEGIN']);assert.deepEqual(releases,[true]);assert.equal(incoming.listenerCount('aborted'),0);assert.equal(outgoing.listenerCount('close'),0);
});
