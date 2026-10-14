import {docker,sourceCompose} from './release-process.mjs';
import {withIsolatedTarget} from './release-recovery.mjs';
import {check} from './release-archive.mjs';
const [key,archive,...extra]=process.argv.slice(2),checks={};
try{
 check(key&&archive&&!extra.length);
 const call=args=>docker([...sourceCompose,...args],process.env);
 const api=call(['ps','-q','api']).trim();check(/^[a-f0-9]{12,64}$/.test(api));
 const inspect=JSON.parse(docker(['inspect',api],process.env))[0];
 checks.immutableRunningImage=/^sha256:[a-f0-9]{64}$/.test(inspect.Image);
 checks.privateApi=Object.values(inspect.NetworkSettings.Ports??{}).every(value=>value===null);
 const script=`import {createPool} from './compiled/server/db.js';import {schemaReady} from './compiled/server/schema.js';import {validateEnvelopes} from './compiled/server/mfa-config.js';const p=createPool();try{await schemaReady(p);await validateEnvelopes(p);const r=(await p.query("SELECT current_user='medi_runtime' runtime, has_table_privilege(current_user,'identity_security_events','UPDATE') mutable,has_table_privilege(current_user,'registration_migrations','INSERT') migration")).rows[0];if(!r.runtime||r.mutable||r.migration)throw Error();if(!(await fetch('http://127.0.0.1:3100/api/health')).ok)throw Error();}catch{process.exitCode=1;}finally{await p.end();}`;
 call(['exec','-T','api','node','--input-type=module','-e',script]);checks.schemaGrantsMfaReadiness=true;
 for(const service of ['collector','prometheus','alertmanager','receiver','database']){
  const id=call(['ps','-q',service]).trim();check(/^[a-f0-9]{12,64}$/.test(id));const state=JSON.parse(docker(['inspect',id],process.env))[0];checks['private_'+service]=Object.values(state.NetworkSettings.Ports??{}).every(value=>value===null);
  checks['logging_'+service]=service==='database'?state.HostConfig.LogConfig.Type==='none':state.HostConfig.LogConfig.Type==='local'&&state.HostConfig.LogConfig.Config['max-size']==='10m';
 }
 call(['exec','-T','receiver','node','--input-type=module','-e',"const b=await(await fetch('http://prometheus:9090/api/v1/query?query=medi_heartbeat_seconds',{signal:AbortSignal.timeout(5000)})).json();if(!b.data.result.length||Date.now()/1000-Number(b.data.result[0].value[1])>20)throw Error();"]);checks.collectorFresh=true;
 const restore=await withIsolatedTarget(key,archive);checks.authenticatedRestore=restore.result==='PASS';checks.recordedBackupImages=true;
 if(!Object.values(checks).every(Boolean))process.exitCode=1;
 console.log(JSON.stringify({localChecks:checks,runtimeVerified:Object.values(checks).every(Boolean),ready:false,externalDecisions:['host_domain_tls','dedicated_topology','operator_support','clinical_legal_acceptance','human_alert_escalation','independent_backup_key_custody','disk_capacity_retention'],scope:'owned synthetic local release'}));
}catch{console.log(JSON.stringify({localChecks:checks,runtimeVerified:false,ready:false,failed:['local_preflight']}));process.exitCode=1;}
