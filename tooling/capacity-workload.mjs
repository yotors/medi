// Fixed synthetic workload, executed only by capacity-verify inside an isolated target.
import {randomUUID,randomBytes} from 'node:crypto';
import {createPool} from './compiled/server/db.js';
import {hashPassword} from './compiled/server/auth.js';
import {issueGrant} from './compiled/server/mfa.js';
import {totp} from './compiled/server/mfa-config.js';
const pool=createPool(),origin='https://localhost:8443',base='http://api:3100';
const contract={hospitals:2,patientsPerHospital:1000,encountersPerHospital:250,sessions:10,rampSeconds:10,steadySeconds:180,thinkMs:1000,timeoutMs:10000,p95Ms:1500,unexpectedFailureRate:0.01};
const stats={},commands=[],hospitals=[];let measured=false,stage='setup',violations=0,poolWaiting=0,apiMemoryBytes=0,metricSamples=0;let sampling;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(actor,path,body,route,key=randomUUID(),expected=200){
 const start=performance.now();let status=0,result;
 try{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{origin,...(actor?.cookie?{cookie:actor.cookie,'x-csrf-token':actor.csrf}:{}),...(body?{'content-type':'application/json','idempotency-key':key}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});status=r.status;result=await r.json();if(actor&&r.headers.get('set-cookie'))actor.cookie=r.headers.get('set-cookie').split(';')[0];if(status!==expected&&!(expected===200&&status===201))throw Error();const tables={'patient.register':'registration_requests','visit.checkin':'outpatient_requests','visit.command':'outpatient_requests','pharmacy.dispense':'inventory_requests','payment.record':'billing_requests'};if(stage==='workload'&&tables[route])commands.push({table:tables[route],hospital:actor.hospital,key});return result;}
 finally{if(measured){const s=stats[route]??={durations:[],success:0,failures:0,limited:0,conflicts:0};s.durations.push(performance.now()-start);if(status===expected||status===201)s.success++;else if(status===429||status===503)s.limited++;else if(status===409)s.conflicts++;else s.failures++;}}
}
async function sign(h,role,password){
 const actor={hospital:h.id};const c=await pool.connect();let grant;
 try{await c.query('BEGIN');grant=(await issueGrant(c,h.id,h.users[role],null,'capacity-synthetic-operator','initial_enrollment')).grant;await c.query('COMMIT');}catch{await c.query('ROLLBACK');throw Error();}finally{c.release();}
 const login=await request(actor,'/api/auth/login',{hospitalCode:h.code,username:role,password},'login');actor.csrf=login.csrfToken;if(login.authState!=='enrollment')throw Error();
 const setup=await request(actor,'/api/auth/mfa/start',{grant},'mfa');const verified=await request(actor,'/api/auth/mfa/confirm',{code:totp(setup.secret).generate()},'mfa');actor.csrf=verified.session.csrfToken;if(verified.session.authState!=='complete')throw Error();return actor;
}
async function visitCommand(actor,v,command){const result=await request(actor,'/api/visits/'+v.id+'/commands',{expectedRevision:v.revision,command},'visit.command');Object.assign(v,result.visit);return result;}
try{
 const provisioning=Date.now(),password=randomBytes(24).toString('hex'),hash=await hashPassword(password);
 for(let n=0;n<2;n++){
  const h={id:randomUUID(),code:'capacity-'+randomBytes(6).toString('hex'),users:{},actors:{},visits:[],patients:[],paid:0,dispensed:0,registered:0,checkedIn:0,observedPatients:new Set(),observedVisits:new Set()};hospitals.push(h);
  await pool.query('INSERT INTO hospitals(id,code,name,next_record_number) VALUES ($1,$2,$3,1001)',[h.id,h.code,'Capacity Synthetic '+n]);
  for(const role of ['admin','receptionist','clinician','lab','pharmacist','cashier']){h.users[role]=randomUUID();await pool.query('INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$3,$5)',[h.users[role],h.id,role,'Capacity '+role,hash]);}
  h.patients=(await pool.query("INSERT INTO patients(id,hospital_id,record_number,name,normalized_name) SELECT gen_random_uuid(),$1,'CAP-'||n,'Capacity Patient '||n,'capacity patient '||n FROM generate_series(1,1000) n RETURNING id",[h.id])).rows;
  for(const role of Object.keys(h.users))h.actors[role]=await sign(h,role,password);
  const admin=h.actors.admin;
  const department=(await request(admin,'/api/configuration/commands',{type:'department.create',code:'CAP',name:'Capacity'},'setup')).entry;
  h.service=(await request(admin,'/api/configuration/commands',{type:'service.create',code:'CAP',name:'Capacity',departmentId:department.id,priceMinor:1000},'setup')).entry;
  h.product=(await request(admin,'/api/inventory/commands',{type:'product.create',code:'CAP',name:'Capacity',unit:'unit'},'setup')).productId;
  h.batch=(await request(admin,'/api/inventory/commands',{type:'batch.create',productId:h.product,lot:'CAP',expiry:'2099-01-01'},'setup')).batchId;
  await request(admin,'/api/inventory/commands',{type:'stock.receive',batchId:h.batch,expectedRevision:1,quantity:1000,reference:'capacity'},'setup');h.batchRevision=2;
  for(let i=0;i<250;i++){
   const v=(await request(admin,'/api/patients/'+h.patients[i].id+'/visits',{},'setup')).visit;h.visits.push(v);
   if(i<50)await visitCommand(admin,v,{type:'order',test:'Blood count'});
   else if(i<100){await visitCommand(admin,v,{type:'prescribe',instruction:'Synthetic instruction'});const result=await request(admin,'/api/visits/'+v.id+'/inventory/commands',{type:'authorize',prescriptionId:v.prescriptions[0].id,expectedVisitRevision:v.revision,productId:h.product,quantity:1},'setup');v.revision=result.visitRevision;}
   else if(i<150){v.invoice=(await request(admin,'/api/visits/'+v.id+'/billing/commands',{type:'invoice.issue',lines:[{serviceId:h.service.id,serviceRevision:1,quantity:1}]},'setup')).invoiceId;}
   else if(i<200){await visitCommand(admin,v,{type:'order',test:'Blood count'});await visitCommand(admin,v,{type:'advanceOrder',orderId:v.orders[0].id,next:'collected'});await visitCommand(admin,v,{type:'advanceOrder',orderId:v.orders[0].id,next:'released',result:'Synthetic result'});}
  }
 }
 const provisioningSeconds=(Date.now()-provisioning)/1000;
 // Verify explicit foreign IDs before measurement. No submitted IDs in the artifact.
 for(let i=0;i<2;i++)await request(hospitals[i].actors.receptionist,'/api/patients/'+hospitals[1-i].patients[0].id,undefined,'tenant',undefined,404);
 stage='workload';sampling=setInterval(async()=>{try{const text=await(await fetch('http://collector:8889/metrics',{signal:AbortSignal.timeout(2000)})).text();const waiting=/medi_pool\{[^}]*state="waiting"[^}]*\} ([0-9.]+)/.exec(text);if(waiting){poolWaiting=Math.max(poolWaiting,Number(waiting[1]));metricSamples++;}const memory=/medi_memory_bytes(?:\{[^}]*\})? ([0-9.e+]+)/.exec(text);if(memory)apiMemoryBytes=Math.max(apiMemoryBytes,Number(memory[1]));}catch{}},5000);const starts=Date.now()+10000,ends=starts+180000;
 const workers=hospitals.flatMap(h=>['receptionist','clinician','lab','pharmacist','cashier'].map((role,index)=>(async()=>{
  await sleep(index*2000);let i=0;
  while(Date.now()<ends){measured=Date.now()>=starts;const actor=h.actors[role];
   try{
    if(i%3!==0){if(i%3===1){const page=await request(actor,'/api/patients/search',{q:'Capacity',page:1},'patients.search');for(const row of page.patients)h.observedPatients.add(row.id);}else{const page=await request(actor,'/api/visits/search',{status:'active'},'visits.search');for(const row of page.visits)h.observedVisits.add(row.id);}}
    else{
     const task=Math.floor(i/3),j=task%50;
     if(role==='receptionist'){
      const key=randomUUID(),body={name:'Capacity New '+randomUUID(),contact:''};const p=(await request(actor,'/api/patients',body,'patient.register',key)).patient;h.registered++;
      await request(actor,'/api/patients/'+p.id+'/visits',{},'visit.checkin');h.checkedIn++;
     }else if(role==='clinician'){const v=h.visits[150+j];if(task<50)await visitCommand(actor,v,{type:'advanceOrder',orderId:v.orders[0].id,next:'reviewed'});else await request(actor,'/api/visits/'+v.id,undefined,'visit.detail');}
     else if(role==='lab'){const v=h.visits[j];if(task<50)await visitCommand(actor,v,{type:'advanceOrder',orderId:v.orders[0].id,next:'collected'});else if(task<100)await visitCommand(actor,v,{type:'advanceOrder',orderId:v.orders[0].id,next:'released',result:'Synthetic result'});else await request(actor,'/api/visits/'+v.id,undefined,'visit.detail');}
     else if(role==='pharmacist'){const v=h.visits[50+j];if(task<50){const result=await request(actor,'/api/visits/'+v.id+'/inventory/commands',{type:'dispense',prescriptionId:v.prescriptions[0].id,expectedVisitRevision:v.revision,batchId:h.batch,expectedBatchRevision:h.batchRevision,quantity:1},'pharmacy.dispense');v.revision=result.visitRevision;h.batchRevision++;h.dispensed++;}else await request(actor,'/api/visits/'+v.id,undefined,'visit.detail');}
     else {const v=h.visits[100+j];if(task<50){const key=randomUUID(),body={type:'payment.record',invoiceId:v.invoice,expectedRevision:1,amountMinor:1000,method:'cash'};await request(actor,'/api/visits/'+v.id+'/billing/commands',body,'payment.record',key);h.paid+=1000;}else await request(actor,'/api/visits/'+v.id+'/billing',undefined,'billing.detail');}
    }
   }catch{ /* Counted by request; preserve the predefined thresholds. */ }
   i++;await sleep(1000);
  }
 })()));
 await Promise.all(workers);measured=false;
 stage='login-abuse';const abuse=[];const h=hospitals[0];await pool.query('INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$5,$6)',[randomUUID(),h.id,'abuse','Capacity Abuse','receptionist',hash]);
 for(let i=0;i<12;i++){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({hospitalCode:h.code,username:'abuse',password:'Synthetic deliberately incorrect password'}),signal:AbortSignal.timeout(10000)});abuse.push(r.status);if(![401,429].includes(r.status))throw Error();}if(!abuse.includes(429))throw Error();
 stage='overload-lock';const lock=await pool.connect();let overload;
 try{await lock.query('BEGIN');await lock.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE',[hospitals[0].id]);
 stage='overload-requests';const requests=Array.from({length:24},()=>fetch(base+'/api/patients/search',{method:'POST',headers:{origin,cookie:hospitals[0].actors.receptionist.cookie,'x-csrf-token':hospitals[0].actors.receptionist.csrf,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)}).then(r=>r.status).catch(()=>0));
 await sleep(6500);await lock.query('ROLLBACK');overload=await Promise.all(requests);if(!overload.some(s=>s===503)||overload.some(s=>![200,503,429].includes(s))){console.log(JSON.stringify({result:'FAIL',stage:'overload-status',statuses:Object.fromEntries([...new Set(overload)].map(s=>[s,overload.filter(x=>x===s).length]))}));throw Error();}
 }finally{await lock.query('ROLLBACK').catch(()=>{});lock.release();}
 stage='overload-recovery';const recoveryStart=Date.now(),recoveryStatuses=[];for(let i=0;i<6;i++){const r=await fetch(base+'/api/patients/search',{method:'POST',headers:{origin,cookie:hospitals[0].actors.receptionist.cookie,'x-csrf-token':hospitals[0].actors.receptionist.csrf,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(2000)});recoveryStatuses.push(r.status);await r.arrayBuffer();if(r.status===200)break;if(![503,429].includes(r.status))throw Error();await sleep(500);}if(recoveryStatuses.at(-1)!==200)throw Error();const recoveryMs=Date.now()-recoveryStart;
 stage='invariants';
 for(const h of hospitals){
  for(const [table,ids]of [['patients',h.observedPatients],['outpatient_visits',h.observedVisits]])if((await pool.query('SELECT 1 FROM '+table+' WHERE id=ANY($1::uuid[]) AND hospital_id<>$2',[Array.from(ids),h.id])).rowCount)violations++;
  const sum=Number((await pool.query('SELECT coalesce(sum(amount_minor),0) n FROM billing_payments WHERE hospital_id=$1',[h.id])).rows[0].n);if(sum!==h.paid)violations++;
  const receipts=Number((await pool.query('SELECT count(*) n FROM billing_receipts WHERE hospital_id=$1',[h.id])).rows[0].n);if(receipts!==h.paid/1000)violations++;
  const invoiceTotal=Number((await pool.query('SELECT coalesce(sum(total_minor),0) n FROM billing_invoices WHERE hospital_id=$1',[h.id])).rows[0].n);if(invoiceTotal!==50000)violations++;
  const patients=Number((await pool.query('SELECT count(*) n FROM patients WHERE hospital_id=$1',[h.id])).rows[0].n);if(patients!==1000+h.registered)violations++;
  const visits=Number((await pool.query('SELECT count(*) n FROM outpatient_visits WHERE hospital_id=$1',[h.id])).rows[0].n);if(visits!==250+h.checkedIn)violations++;
  const dispensed=Number((await pool.query('SELECT coalesce(sum(quantity),0) n FROM inventory_dispenses WHERE hospital_id=$1',[h.id])).rows[0].n);if(dispensed!==h.dispensed)violations++;
  const stock=Number((await pool.query('SELECT coalesce(sum(quantity),0) n FROM inventory_movements WHERE hospital_id=$1',[h.id])).rows[0].n);if(stock!==1000-h.dispensed||stock<0)violations++;
  if((await pool.query('SELECT number FROM billing_receipts WHERE hospital_id=$1 GROUP BY number HAVING count(*)>1',[h.id])).rowCount)violations++;
 }
 for(const c of commands)if(Number((await pool.query('SELECT count(*) n FROM '+c.table+' WHERE hospital_id=$1 AND idempotency_key=$2',[c.hospital,c.key])).rows[0].n)!==1)violations++;
 const report={contract,provisioningSeconds,routeClasses:{},invariantViolations:violations,networkRetries:0,node:process.version,postgres:(await pool.query('SHOW server_version')).rows[0].server_version,runnerMemoryBytes:process.memoryUsage().rss,apiMemoryBytes,poolWaitingMaximum:poolWaiting,metricSamples,loginAbuse:{attempts:abuse.length,denied:abuse.filter(s=>s===401).length,limited:abuse.filter(s=>s===429).length},overload:{requests:overload.length,unavailable:overload.filter(s=>s===503||s===429).length,recovered:true,recoveryMs,recoveryStatuses}};
 let total=0,unexpected=0,p95=0;
 for(const [route,s]of Object.entries(stats)){s.durations.sort((a,b)=>a-b);const percentile=p=>Math.round(s.durations[Math.min(s.durations.length-1,Math.floor(s.durations.length*p))]??0);report.routeClasses[route]={attempts:s.durations.length,success:s.success,failures:s.failures,limited:s.limited,conflicts:s.conflicts,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99)};total+=s.durations.length;unexpected+=s.failures+s.limited;p95=Math.max(p95,percentile(.95));}
 report.result=violations===0&&unexpected/Math.max(1,total)<.01&&p95<1500?'PASS':'FAIL';console.log(JSON.stringify(report));if(report.result!=='PASS')process.exitCode=1;
}catch{const observed=Object.fromEntries(Object.entries(stats).map(([route,s])=>{s.durations.sort((a,b)=>a-b);const p=q=>Math.round(s.durations[Math.min(s.durations.length-1,Math.floor(s.durations.length*q))]??0);return[route,{attempts:s.durations.length,success:s.success,failures:s.failures,limited:s.limited,conflicts:s.conflicts,p50:p(.5),p95:p(.95),p99:p(.99)}];}));console.log(JSON.stringify({result:'FAIL',stage,contract,routeClasses:observed,invariantViolations:violations}));console.error('Capacity workload failed at '+stage+'; sensitive diagnostics withheld.');process.exitCode=1;}finally{clearInterval(sampling);await pool.end();}
