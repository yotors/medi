import {fileURLToPath} from 'node:url';
import {verifyReadinessAlert} from './readiness-alert-verify.mjs';
import {docker,sourceCompose} from './release-process.mjs';
import {check} from './release-archive.mjs';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const env=process.env,call=(args,input)=>docker([...sourceCompose,...args],env,input);
const remote=script=>call(['exec','-T','receiver','node','--input-type=module','-e',script]);
const get=url=>JSON.parse(remote(`const r=await fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error();process.stdout.write(await r.text());`));
const wait=async(predicate)=>{const end=Date.now()+100000;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,5000));}throw Error();};
let stage='receipt',apiStopped=false,collectorStopped=false;const directory=mkdtempSync(join(tmpdir(),'medi-telemetry-'));
try{
 stage='rules';docker(['run','--rm','--network','none','-v',fileURLToPath(new URL('../deploy/observability',import.meta.url))+':/rules:ro','-w','/rules','--entrypoint','promtool','prom/prometheus:v3.2.1@sha256:6927e0919a144aa7616fd0137d4816816d42f6b816de3af269ab065250859a62','test','rules','rules.test.yaml'],env);stage='receipt';
 const marker='SENSITIVE_'+randomUUID();
 remote(`for(const path of ['/api/health?marker=${marker}','/api/${marker}'])await fetch('http://api:3100'+path,{headers:{baggage:'${marker}','x-correlation-id':'${marker}'}});await fetch('http://api:3100/api/auth/login',{method:'POST',headers:{origin:'https://localhost:8443','content-type':'application/json'},body:JSON.stringify({hospitalCode:'${marker}',username:'${marker}',password:'${marker}'})});`);
 await wait(()=>get('http://prometheus:9090/api/v1/query?query=medi_requests_total').data.result.length>0);
 stage='trace-file';
 const collector=call(['ps','-q','collector']).trim();docker(['cp',collector+':/data/traces.json',join(directory,'traces.json')],env);
 const traces=readFileSync(join(directory,'traces.json'),'utf8');check(traces.includes('medi.manual')&&!traces.includes(marker));
 stage='log-scan';
 for(const service of ['api','web','collector','prometheus','alertmanager','receiver'])check(!call(['logs','--no-color',service]).includes(marker));
 stage='database-log-policy';
 const db=call(['ps','-q','database']).trim();const inspection=JSON.parse(docker(['inspect',db],env))[0];check(inspection.HostConfig.LogConfig.Type==='none'&&!inspection.LogPath);
 // Generate a server-side PostgreSQL value-bearing error. Output never reaches evidence.
 call(['exec','-T','database','psql','-U','medi_migrator','-d','product_studio_release','-c',`DO $$ BEGIN RAISE EXCEPTION '${marker}'; EXCEPTION WHEN OTHERS THEN RAISE WARNING '${marker}'; END $$;`]);
 stage='api-outage';const before=get('http://receiver:9094/receipts').MediApiUnavailable;
 call(['stop','api']);apiStopped=true;
 await wait(()=>get('http://prometheus:9090/api/v1/alerts').data.alerts.some(a=>a.labels.alertname==='MediApiUnavailable'&&a.state==='firing'));
 await wait(()=>get('http://receiver:9094/receipts').MediApiUnavailable.firing>before.firing);
 call(['up','-d','--no-deps','--wait','--wait-timeout','90','api']);apiStopped=false;
 await wait(()=>get('http://receiver:9094/receipts').MediApiUnavailable.resolved>before.resolved);
 stage='collector-outage';const collectorBefore=get('http://receiver:9094/receipts').MediCollectorUnavailable;call(['stop','collector']);collectorStopped=true;
 remote("for(let i=0;i<300;i++){const r=await fetch('http://api:3100/api/health');if(!r.ok)throw Error();}");
 await wait(()=>get('http://receiver:9094/receipts').MediCollectorUnavailable.firing>collectorBefore.firing);
 call(['up','-d','--no-deps','collector']);collectorStopped=false;
 await wait(()=>get('http://receiver:9094/receipts').MediCollectorUnavailable.resolved>collectorBefore.resolved);
 stage='readiness-outage';await verifyReadinessAlert();
 console.log(JSON.stringify({result:'PASS',runningApiReadinessAlert:true,collectorReceipt:true,markerAbsent:true,databaseDiagnosticsDiscarded:true,apiFiringResolvedReceipt:true,collectorFiringResolvedReceipt:true,humanNotification:false}));
}catch{console.error('Observability drill failed at '+stage+'; sensitive diagnostics withheld.');process.exitCode=1;}
finally{if(apiStopped)call(['up','-d','--no-deps','api']);if(collectorStopped)call(['up','-d','--no-deps','collector']);rmSync(directory,{recursive:true,force:true});}
