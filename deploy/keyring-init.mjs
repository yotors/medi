// Short-lived privileged provisioning only. The API never runs as root.
import { constants, fstatSync, readSync, openSync, writeFileSync, fsyncSync, closeSync, chownSync, chmodSync, renameSync, rmSync } from 'node:fs';
const temporary='/output/keyring.pending';
try {
  const source=openSync('/input/keyring.json',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let bytes;
  try {const stat=fstatSync(source);if(!stat.isFile()||(stat.mode&0o077)||stat.size<1||stat.size>16384)throw Error();const data=Buffer.alloc(16385);let count=0,n;while((n=readSync(source,data,count,data.length-count,null))>0){count+=n;if(count>16384)throw Error();}bytes=data.subarray(0,count);}finally{closeSync(source);}
  const ring=JSON.parse(bytes);if(!ring || Object.keys(ring).sort().join(',')!=='current,keys' || typeof ring.current!=='string' || !/^[A-Za-z0-9_-]{1,64}$/.test(ring.current) || !ring.keys || typeof ring.keys!=='object' || Array.isArray(ring.keys) || Object.keys(ring.keys).length>64 || !Object.hasOwn(ring.keys,ring.current))throw Error();
  for(const [id,key] of Object.entries(ring.keys))if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)||typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))throw Error();
  const fd=openSync(temporary,'w',0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  chownSync(temporary,1000,1000);chmodSync(temporary,0o400);renameSync(temporary,'/output/mfa-keyring.json');
} catch {rmSync(temporary,{force:true});process.stderr.write('Private authentication configuration could not be provisioned.\n');process.exitCode=1;}
