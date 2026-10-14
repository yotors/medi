import assert from 'node:assert/strict';
import {test} from 'node:test';
import Fastify from 'fastify';
import {InMemorySpanExporter} from '@opentelemetry/sdk-trace-base';
import {createTelemetry,instrument,type Completion} from './observability.ts';
const pool={totalCount:2,idleCount:1,waitingCount:0};
test('registered routes, unknown input, headers, bodies and errors never enter telemetry',async()=>{
 const spans=new InMemorySpanExporter(), logs:Completion[]=[];
 const telemetry=createTelemetry({pool,traceExporter:spans,log:record=>{logs.push(record);}});
 const app=Fastify({logger:false});instrument(app,telemetry);
 app.post('/fixed/:id',async()=>{throw Error('SENSITIVE_MARKER');});
 app.setErrorHandler((_error,_request,reply)=>reply.code(500).send({error:'unavailable'}));
 for(let i=0;i<20;i++)await app.inject({method:'POST',url:'/fixed/SENSITIVE_MARKER?secret=SENSITIVE_MARKER',headers:{'x-correlation-id':'SENSITIVE_MARKER',baggage:'SENSITIVE_MARKER','content-type':'application/json'},payload:{marker:'SENSITIVE_MARKER'}});
 await app.inject({url:'/SENSITIVE_MARKER'});
 assert.equal(logs.length,21);assert.equal(logs[0].route,'/fixed/:id');assert.equal(logs[20].route,'UNKNOWN');assert.ok(logs.every(r=>/^[a-f0-9-]{36}$/.test(r.correlation)));assert.ok(!JSON.stringify(logs).includes('SENSITIVE_MARKER'));
 await app.close();await telemetry.shutdown();
});
test('completion is end-once; throwing log and failed exporter cannot fail requests',async()=>{
 let exported=0;const telemetry=createTelemetry({pool,log:()=>{throw Error('SENSITIVE_MARKER');},traceExporter:{export(spans,done){exported+=spans.length;done({code:1,error:Error('SENSITIVE_MARKER')});},shutdown:async()=>{}}});
 const one=telemetry.start('UNKNOWN','SENSITIVE_MARKER');one.end(0,true);one.end(500);await telemetry.shutdown();assert.equal(exported,1);
});
test('shutdown remains bounded for a hanging exporter',async()=>{
 const telemetry=createTelemetry({pool,log:()=>{},traceExporter:{export(){},shutdown:()=>new Promise(()=>{})}});
 telemetry.start('UNKNOWN','GET').end(200);const start=Date.now();await telemetry.shutdown();assert.ok(Date.now()-start<3000);
});

test('overflow and log backpressure are counted with bounded exporter batches',async()=>{
 let spans=0;const snapshots:unknown[]=[];
 const telemetry=createTelemetry({pool,log:()=>false,traceExporter:{export(batch,done){spans+=batch.length;setTimeout(()=>done({code:1}),50);},shutdown:async()=>{}},metricExporter:{export(data,done){snapshots.push(data);done({code:0});},shutdown:async()=>{},forceFlush:async()=>{}}});
 for(let i=0;i<1000;i++)telemetry.start('UNKNOWN','GET').end(200);
 await telemetry.shutdown();assert.ok(spans<=320);assert.ok(JSON.stringify(snapshots).includes('medi_export_drops'));
});

test('hostile OTEL environment cannot change resource, destination or exporter headers',async()=>{
 const http=(await import('node:http')).default;
 const {syncBuiltinESMExports}=await import('node:module');
 const {Writable,PassThrough}=await import('node:stream');
 const prior=http.request, captured:string[]=[];
 const names=['OTEL_RESOURCE_ATTRIBUTES','OTEL_SERVICE_NAME','OTEL_EXPORTER_OTLP_ENDPOINT','OTEL_EXPORTER_OTLP_HEADERS','OTEL_EXPORTER_OTLP_TRACES_HEADERS','OTEL_EXPORTER_OTLP_METRICS_HEADERS'];
 const saved=names.map(name=>[name,process.env[name]] as const);
 for(const name of names)process.env[name]=name.endsWith('HEADERS')?'authorization=SENSITIVE_MARKER':name.endsWith('ENDPOINT')?'https://SENSITIVE_MARKER.invalid':'SENSITIVE_MARKER';
 http.request=((url:URL,options:unknown,callback:(response:unknown)=>void)=>{
  captured.push(String(url),JSON.stringify(options));
  const stream=new Writable({write(chunk,_encoding,done){captured.push(chunk.toString());done();},final(done){const response=Object.assign(new PassThrough(),{statusCode:200,headers:{}});callback(response);response.end('{}');done();}});
  return Object.assign(stream,{setTimeout(){return stream;},setHeader(){return stream;}});
 }) as unknown as typeof http.request;syncBuiltinESMExports();
 try{const telemetry=createTelemetry({pool,enabled:true,log:()=>{}});telemetry.start('/fixed','POST').end(200);await telemetry.shutdown();assert.ok(captured.some(value=>value==='http://collector:4318/v1/traces'));assert.ok(captured.some(value=>value==='http://collector:4318/v1/metrics'));assert.ok(!captured.join('').includes('SENSITIVE_MARKER'));}
 finally{http.request=prior;syncBuiltinESMExports();for(const[name,value]of saved){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
