import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {withIsolatedTarget} from './release-recovery.mjs';
import {docker} from './release-process.mjs';
import {check} from './release-archive.mjs';
const [key,archive,...extra]=process.argv.slice(2);
try{
 check(key&&archive&&!extra.length);
 const report=await withIsolatedTarget(key,archive,async({manifest,compose,environment,target,directory})=>{
  check(/^medi-recovery-[a-f0-9]{24}$/.test(target)&&manifest.format===2&&manifest.inventory.versions.at(-1).version===15);
  const override=resolve(directory,'capacity-monitoring.json');writeFileSync(override,JSON.stringify({services:{api:{environment:{MEDI_TELEMETRY:'private'}},collector:{image:'otel/opentelemetry-collector-contrib:0.123.0@sha256:e39311df1f3d941923c00da79ac7ba6269124a870ee87e3c3ad24d60f8aee4d2',command:['--config=/etc/otelcol/config.yaml'],volumes:[resolve('deploy/observability/collector.yaml')+':/etc/otelcol/config.yaml:ro'],tmpfs:['/data:uid=10001,gid=10001,mode=0700,size=20m'],networks:['data'],mem_limit:'128m',logging:{driver:'none'},cap_drop:['ALL'],security_opt:['no-new-privileges:true']}}}),{mode:0o600,flag:'wx'});compose.push('-f',override);
  docker([...compose,'up','-d','collector'],environment);
  docker([...compose,'up','-d','--wait','--wait-timeout','90','api'],environment);
  const script=readFileSync(new URL('./capacity-workload.mjs',import.meta.url),'utf8');
  const result=spawnSync('docker',[...compose,'run','--rm','--no-deps','-T','--entrypoint','node','migrate','--input-type=module','-e',script],{env:environment,encoding:'utf8',timeout:600000,maxBuffer:1024*1024});
  if(result.status!==0){if(result.stderr.includes('Capacity workload failed at '))console.error(result.stderr.split('\n').find(line=>/^Capacity workload failed at [a-z]+; sensitive diagnostics withheld\.$/.test(line))??'Capacity workload failed.');if(result.stdout.trim().startsWith('{'))console.log(result.stdout.trim());throw Error();}
  const data=JSON.parse(result.stdout.trim()),info=JSON.parse(docker(['info','--format','{{json .}}'],environment)),api=JSON.parse(docker(['inspect',docker([...compose,'ps','-q','api'],environment).trim()],environment))[0];return {...data,images:manifest.images,schema:manifest.inventory.versions,coLoad:process.env.MEDI_CAPACITY_COLOAD??'host-workloads-not-excluded',host:{os:info.OperatingSystem,cpus:info.NCPU,memoryBytes:info.MemTotal},allocation:{memoryBytes:api.HostConfig.Memory,nanoCpus:api.HostConfig.NanoCpus,zeroMeansHostLimit:true}};
 });console.log(JSON.stringify(report));
}catch{console.error('Capacity verification failed; sensitive diagnostics withheld.');process.exitCode=1;}
