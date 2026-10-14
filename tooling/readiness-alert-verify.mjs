import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {docker,sourceCompose} from './release-process.mjs';
const call=args=>docker([...sourceCompose,...args],process.env);
const get=()=>JSON.parse(call(['exec','-T','receiver','node','--input-type=module','-e',"process.stdout.write(await(await fetch('http://127.0.0.1:9094/receipts',{signal:AbortSignal.timeout(3000)})).text());"])).MediApiUnavailable;
async function wait(predicate){const end=Date.now()+100000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,5000));}throw Error();}
export async function verifyReadinessAlert(){
let stopped=false;
try{const before=get();call(['stop','database']);stopped=true;await wait(()=>get().firing>before.firing);call(['up','-d','--no-deps','--wait','--wait-timeout','90','database']);stopped=false;await wait(()=>get().resolved>before.resolved);return {result:'PASS',runningApiDatabaseOutage:true,firingReceipt:true,resolvedReceipt:true,humanNotification:false};}
catch{throw Error('Readiness alert drill failed; sensitive diagnostics withheld.');}
finally{if(stopped)call(['up','-d','--no-deps','database']);}

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(await verifyReadinessAlert()));}catch{console.error('Readiness alert drill failed; sensitive diagnostics withheld.');process.exitCode=1;}}
