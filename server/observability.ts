import { randomUUID } from 'node:crypto';
import { diag, ROOT_CONTEXT, SpanStatusCode } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BasicTracerProvider, BatchSpanProcessor, AlwaysOnSampler, type SpanExporter } from '@opentelemetry/sdk-trace-base';
import { MeterProvider, PeriodicExportingMetricReader, type PushMetricExporter } from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';

export type Completion = { correlation: string; route: string; method: string; status: string; error: string; duration_ms: number };
export interface Telemetry { start(route: string, method: string): { correlation: string; end(status: number, aborted?: boolean): void }; shutdown(): Promise<void> }
const methods = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
export function createTelemetry({ pool, enabled = false, log = (record: Completion) => { if(process.stdout.writableNeedDrain)return false;return process.stdout.write(JSON.stringify(record)+'\n'); }, traceExporter, metricExporter }: { pool: Pick<pg.Pool,'totalCount'|'idleCount'|'waitingCount'>; enabled?: boolean; log?: (record: Completion) => void | boolean; traceExporter?: SpanExporter; metricExporter?: PushMetricExporter }): Telemetry {
  // No global providers, propagators, detectors, diagnostic logger or auto instrumentation.
  diag.disable();
  const resource = resourceFromAttributes({ 'service.name': 'medi-api', 'service.version': '0.1.0' });
  // Exporter constructors merge environment headers, even with headers: {}.
  // Capture their configuration in a synchronous environment-free boundary.
  const saved = Object.entries(process.env).filter(([name]) => name.startsWith('OTEL_'));
  for (const [name] of saved) delete process.env[name];
  try {
    if (enabled) {
      traceExporter ??= new OTLPTraceExporter({ url:'http://collector:4318/v1/traces', headers:{}, timeoutMillis:1000, concurrencyLimit:1 });
      metricExporter ??= new OTLPMetricExporter({ url:'http://collector:4318/v1/metrics', headers:{}, timeoutMillis:1000, concurrencyLimit:1 });
    }
  } finally { for (const [name,value] of saved) process.env[name]=value; }
  let failures=0, inflight=0, queued=0, drops=0;
  if (traceExporter) {
    const original=traceExporter, originalExport=original.export.bind(original);
    traceExporter={ export(spans,done){queued=Math.max(0,queued-spans.length);originalExport(spans,result=>{if(result.code!==0)failures++;done({code:result.code});});},shutdown:()=>original.shutdown(),forceFlush:()=>original.forceFlush?.() ?? Promise.resolve() };
  }
  if (metricExporter) {
    const original=metricExporter, originalExport=original.export.bind(original);
    metricExporter={ export(metrics,done){originalExport(metrics,result=>{if(result.code!==0)failures++;done({code:result.code});});},shutdown:()=>original.shutdown(),forceFlush:()=>original.forceFlush() };
  }
  const batch=traceExporter?new BatchSpanProcessor(traceExporter,{maxQueueSize:256,maxExportBatchSize:64,scheduledDelayMillis:1000,exportTimeoutMillis:1500}):undefined;
  const traces=new BasicTracerProvider({resource,sampler:new AlwaysOnSampler(),spanLimits:{attributeCountLimit:8,eventCountLimit:0,linkCountLimit:0},spanProcessors:batch?[{onStart(){},onEnd(span){if(queued>=256){drops++;return;}queued++;batch.onEnd(span);},forceFlush:()=>batch.forceFlush(),shutdown:()=>batch.shutdown()}]:[]});
  const metrics=new MeterProvider({resource,readers:metricExporter?[new PeriodicExportingMetricReader({exporter:metricExporter,exportIntervalMillis:5000,exportTimeoutMillis:1500})]:[]});
  const tracer=traces.getTracer('medi.manual'), meter=metrics.getMeter('medi.manual');
  const count=meter.createCounter('medi_requests'), duration=meter.createHistogram('medi_duration_ms');
  meter.createObservableGauge('medi_memory_bytes').addCallback(result=>result.observe(process.memoryUsage().rss));
  meter.createObservableGauge('medi_inflight').addCallback(result=>result.observe(inflight));
  meter.createObservableGauge('medi_export_drops').addCallback(result=>result.observe(drops));
  meter.createObservableGauge('medi_export_failures').addCallback(result=>result.observe(failures));
  meter.createObservableGauge('medi_heartbeat_seconds').addCallback(result=>result.observe(Date.now()/1000));
  meter.createObservableGauge('medi_pool').addCallback(result=>{result.observe(pool.totalCount,{state:'total'});result.observe(pool.idleCount,{state:'idle'});result.observe(pool.waitingCount,{state:'waiting'});});
  return {
    start(route,method) {
      const correlation=randomUUID(), started=performance.now(); let ended=false;
      method=methods.has(method)?method:'UNKNOWN';
      const span=tracer.startSpan('http.request',{attributes:{route,method,correlation}},ROOT_CONTEXT); inflight++;
      return {correlation,end(code,aborted=false){
        if(ended)return;ended=true;inflight--;
        const status=aborted?'aborted':Number.isInteger(code)&&code>=100&&code<=599?`${Math.floor(code/100)}xx`:'unknown';
        const error=aborted?'aborted':code===429?'limited':code===401||code===403?'denied':code>=500?'unavailable':code>=400?'invalid':'none';
        const labels={route,method,status,error}, elapsed=Math.max(0,performance.now()-started);
        count.add(1,labels);duration.record(elapsed,labels);span.setAttributes({status,error});span.setStatus({code:error==='unavailable'?SpanStatusCode.ERROR:SpanStatusCode.UNSET});span.end();
        try{if(log({correlation,...labels,duration_ms:Math.round(elapsed)})===false)drops++;}catch{failures++;}
      }};
    },
    async shutdown(){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([Promise.allSettled([traces.shutdown(),metrics.shutdown()]),new Promise<void>(resolve=>{timer=setTimeout(resolve,2500);})]);}finally{clearTimeout(timer);}}
  };
}
export function instrument(app: FastifyInstance, telemetry: Telemetry) {
  const routes=new Set<string>(), active=new WeakMap<FastifyRequest,ReturnType<Telemetry['start']>>();
  app.addHook('onRoute',options=>{routes.add(options.url);});
  app.addHook('onRequest',async(request,reply)=>{
    const route=request.routeOptions.url;
    const completion=telemetry.start(route&&routes.has(route)?route:'UNKNOWN',request.method);active.set(request,completion);
    reply.header('X-Correlation-ID',completion.correlation);
    reply.raw.once('close',()=>completion.end(reply.statusCode,!reply.raw.writableFinished));
  });
  app.addHook('onResponse',async(request,reply)=>{active.get(request)?.end(reply.statusCode);});
  app.addHook('onRequestAbort',async request=>{active.get(request)?.end(0,true);});
}
