import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { inventoryCommandSchema, inventoryUuid, pharmacyCommandSchema, type InventoryBatch, type InventoryEvent, type InventoryProduct, type InventoryResult, type PharmacyAuthorization } from '../shared/inventory.ts';
import type { Session, StaffRole } from '../shared/registration.ts';
import { execute, type Visit } from '../src/domain.ts';
import { ApiError } from './app.ts';
import { currentActor, digest } from './auth.ts';
const empty = z.strictObject({});
const page = z.coerce.number().int().min(1).max(10000).default(1);
const readers: StaffRole[] = ['admin','pharmacist','auditor'];
const writers: StaffRole[] = ['admin','pharmacist'];
const missing = () => new ApiError(404, 'NOT_FOUND', 'The inventory record was not found.');
const invalid = () => new ApiError(400, 'INVALID_REQUEST', 'Check the inventory fields and try again.');
const conflict = (message: string, code = 'INVENTORY_CONFLICT') => new ApiError(409, code, message);
const productDto = (row: any): InventoryProduct => ({ id: row.id, code: row.code, name: row.name, unit: row.unit, active: row.active, revision: row.revision });
const batchSelect = `SELECT b.*,to_char(b.expiry,'YYYY-MM-DD') AS expiry_text,
  p.active,coalesce((SELECT sum(quantity) FROM inventory_movements m WHERE m.hospital_id=b.hospital_id AND m.batch_id=b.id),0)::integer AS balance
  FROM inventory_batches b JOIN inventory_products p ON p.hospital_id=b.hospital_id AND p.id=b.product_id`;
const batchDto = (row: any, today: string): InventoryBatch => ({ id: row.id, productId: row.product_id, lot: row.lot, expiry: row.expiry_text, quarantined: row.quarantined, revision: row.revision, balance: row.balance,
  eligibility: !row.active ? 'inactive' : row.quarantined ? 'quarantined' : row.expiry_text < today ? 'expired' : row.expiry_text === today ? 'expiry_today' : 'available' });
async function addisDate(client: pg.PoolClient): Promise<string> {
  return (await client.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Africa/Addis_Ababa','YYYY-MM-DD') AS today")).rows[0].today;
}
async function product(client: pg.PoolClient, hospital: string, id: string) {
  const { rows: [row] } = await client.query('SELECT * FROM inventory_products WHERE hospital_id=$1 AND id=$2', [hospital,id]); if (!row) throw missing(); return row;
}
async function batch(client: pg.PoolClient, hospital: string, id: string) {
  const { rows: [row] } = await client.query(`${batchSelect} WHERE b.hospital_id=$1 AND b.id=$2`, [hospital,id]); if (!row) throw missing(); return row;
}
export async function readPharmacyAuthorizations(client: pg.PoolClient, hospital: string, visit: string): Promise<PharmacyAuthorization[]> {
  const { rows } = await client.query(`SELECT a.*,p.code,p.name,p.unit,p.active,p.revision,
    coalesce((SELECT sum(quantity) FROM inventory_dispenses d WHERE d.hospital_id=a.hospital_id AND d.authorization_id=a.id),0)::integer AS supplied,
    EXISTS(SELECT 1 FROM inventory_dispenses d WHERE d.hospital_id=a.hospital_id AND d.authorization_id=a.id AND d.kind='cancel') AS cancelled
    FROM inventory_authorizations a JOIN inventory_products p ON p.hospital_id=a.hospital_id AND p.id=a.product_id WHERE a.hospital_id=$1 AND a.visit_id=$2 ORDER BY a.created_at,a.id`, [hospital,visit]);
  return rows.map(row => ({ id: row.id, prescriptionId: row.prescription_id, product: productDto({ ...row,id:row.product_id }), quantity: row.quantity, supplied: row.supplied,
    remaining: row.cancelled ? 0 : row.quantity-row.supplied, cancelled: row.cancelled, actorId: row.actor_id, actorName: row.actor_name, at: row.created_at.toISOString() }));
}
export function registerInventoryRoutes(app: FastifyInstance, pool: pg.Pool, sessions: WeakMap<FastifyRequest, Session>) {
  async function transaction<T>(session: Session, write: boolean, roles: StaffRole[], work: (client: pg.PoolClient, actor: any) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='10s'");
      await client.query(`SELECT id FROM hospitals WHERE id=$1 FOR ${write ? 'UPDATE' : 'SHARE'}`, [session.user.hospital.id]);
      const actor = await currentActor(client,session);
      if (!actor || actor.password_change_required) throw new ApiError(401,'UNAUTHENTICATED','Your session ended. Sign in again.');
      if (!roles.includes(actor.role)) throw new ApiError(403,'FORBIDDEN','This account cannot perform this inventory action.');
      const result = await work(client,actor); await client.query('COMMIT'); return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (['55P03','57014','40001','40P01'].includes((error as {code?:string}).code ?? '')) throw new ApiError(503,'INVENTORY_BUSY','Inventory is temporarily busy. Retry the exact same request.');
      throw error;
    } finally { client.release(); }
  }
  async function receipt(client: pg.PoolClient, hospital: string, actor: string, key: string, hash: string): Promise<InventoryResult | undefined> {
    const { rows:[prior] } = await client.query('SELECT * FROM inventory_requests WHERE hospital_id=$1 AND idempotency_key=$2',[hospital,key]);
    if (!prior) return;
    if (prior.actor_id !== actor || prior.payload_hash !== hash) throw conflict('This retry key belongs to different details or another operator.','IDEMPOTENCY_CONFLICT'); return prior.result;
  }
  async function saveEvent(client: pg.PoolClient, hospital: string, actor: any, key: string, hash: string, result: InventoryResult, action: string, snapshot: object, visit?: string, prescription?: string) {
    await client.query('INSERT INTO inventory_events(id,hospital_id,action,product_id,batch_id,visit_id,prescription_id,actor_id,actor_name,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[result.eventId,hospital,action,result.productId,result.batchId ?? null,visit ?? null,prescription ?? null,actor.id,actor.display_name,snapshot]);
    await client.query('INSERT INTO inventory_requests(hospital_id,idempotency_key,actor_id,payload_hash,result) VALUES($1,$2,$3,$4,$5)',[hospital,key,actor.id,hash,result]);
  }
  app.get('/api/inventory/products', async request => {
    const parsed = z.strictObject({ page,q:z.string().trim().max(100).refine(value => !value.includes('\0')).default(''),active:z.enum(['all','active']).default('all') }).safeParse(request.query); if (!parsed.success) throw invalid();
    const session = sessions.get(request)!;
    return transaction(session,false,[...readers,'clinician'],async (client,actor) => {
      const {q,active,page:current} = parsed.data; const args=[session.user.hospital.id,`%${q.replace(/[\\%_]/g,'\\$&')}%`,active==='active'||actor.role==='clinician'];
      const where='hospital_id=$1 AND (name ILIKE $2 OR code ILIKE $2) AND (NOT $3 OR active)';
      const {rows:[count]}=await client.query(`SELECT count(*)::integer AS total FROM inventory_products WHERE ${where}`,args);
      const {rows}=await client.query(`SELECT * FROM inventory_products WHERE ${where} ORDER BY code,id LIMIT 25 OFFSET $4`,[...args,(current-1)*25]);
      return {entries:rows.map(productDto),total:count.total,page:current,pageSize:25};
    });
  });
  app.get<{Params:{id:string}}>('/api/inventory/products/:id/batches',async request => {
    const parsed=z.strictObject({page,selectedBatchId:inventoryUuid.optional()}).safeParse(request.query);const id=inventoryUuid.safeParse(request.params.id);if(!parsed.success)throw invalid();if(!id.success)throw missing();const session=sessions.get(request)!;
    return transaction(session,false,readers,async client=>{
      const hospital=session.user.hospital.id;const today=await addisDate(client);const p=await product(client,hospital,id.data);
      const {rows:[count]}=await client.query('SELECT count(*)::integer AS total FROM inventory_batches WHERE hospital_id=$1 AND product_id=$2',[hospital,p.id]);
      const {rows}=await client.query(`${batchSelect} WHERE b.hospital_id=$1 AND b.product_id=$2 ORDER BY b.expiry,b.id LIMIT 25 OFFSET $3`,[hospital,p.id,(parsed.data.page-1)*25]);
      const selected=parsed.data.selectedBatchId ? await batch(client,hospital,parsed.data.selectedBatchId) : undefined;
      if(selected && selected.product_id!==p.id)throw missing();
      return {product:productDto(p),entries:rows.map(row=>batchDto(row,today)),total:count.total,page:parsed.data.page,pageSize:25,today,...(selected?{selectedBatch:batchDto(selected,today)}:{})};
    });
  });
  async function history(client:pg.PoolClient,hospital:string,current:number,productId?:string,visitId?:string) {
    const args=[hospital,productId??null,visitId??null];const where='hospital_id=$1 AND ($2::uuid IS NULL OR product_id=$2) AND ($3::uuid IS NULL OR visit_id=$3)';
    const {rows:[count]}=await client.query(`SELECT count(*)::integer AS total FROM inventory_events WHERE ${where}`,args);
    const {rows}=await client.query(`SELECT * FROM inventory_events WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET $4`,[...args,(current-1)*25]);
    const entries:InventoryEvent[]=rows.map(row=>({id:row.id,action:row.action,actorId:row.actor_id,actorName:row.actor_name,at:row.created_at.toISOString(),productId:row.product_id,...(row.batch_id?{batchId:row.batch_id}:{}),...(row.visit_id?{visitId:row.visit_id,prescriptionId:row.prescription_id}:{}),snapshot:row.snapshot}));
    return {entries,total:count.total,page:current,pageSize:25};
  }
  app.get('/api/inventory/history',async request=>{
    const parsed=z.strictObject({page,productId:inventoryUuid.optional()}).safeParse(request.query);if(!parsed.success)throw invalid();const session=sessions.get(request)!;
    return transaction(session,false,readers,async client=>{if(parsed.data.productId)await product(client,session.user.hospital.id,parsed.data.productId);return history(client,session.user.hospital.id,parsed.data.page,parsed.data.productId);});
  });
  app.get<{Params:{id:string}}>('/api/visits/:id/inventory/history',async request=>{
    const parsed=z.strictObject({page}).safeParse(request.query);const id=inventoryUuid.safeParse(request.params.id);if(!parsed.success)throw invalid();if(!id.success)throw missing();const session=sessions.get(request)!;
    return transaction(session,false,['admin','clinician','pharmacist'],async client=>{if(!(await client.query('SELECT 1 FROM outpatient_visits WHERE hospital_id=$1 AND id=$2',[session.user.hospital.id,id.data])).rowCount)throw missing();return history(client,session.user.hospital.id,parsed.data.page,undefined,id.data);});
  });
  app.post('/api/inventory/commands',{bodyLimit:16384},async request=>{
    const parsed=inventoryCommandSchema.safeParse(request.body);const key=inventoryUuid.safeParse(request.headers['idempotency-key']);if(!parsed.success||!key.success||!empty.safeParse(request.query).success)throw invalid();
    const command=parsed.data;const session=sessions.get(request)!;const hospital=session.user.hospital.id;const hash=digest(JSON.stringify({command}));
    return transaction(session,true,writers,async(client,actor)=>{
      const prior=await receipt(client,hospital,actor.id,key.data,hash);if(prior)return prior;
      const result:InventoryResult={eventId:randomUUID(),productId:''};let snapshot:object;
      if(command.type==='product.create'){
        if((await client.query('SELECT 1 FROM inventory_products WHERE hospital_id=$1 AND code=$2',[hospital,command.code])).rowCount)throw conflict('This product code already exists.');
        result.productId=randomUUID();await client.query('INSERT INTO inventory_products(id,hospital_id,code,name,unit) VALUES($1,$2,$3,$4,$5)',[result.productId,hospital,command.code,command.name,command.unit]);snapshot={code:command.code,name:command.name,unit:command.unit,active:true,revision:1};
      }else if(command.type==='product.status'){
        const p=await product(client,hospital,command.productId);if(p.revision!==command.expectedRevision)throw conflict('This product changed. Refresh and review its latest status.','STALE_INVENTORY');if(p.active===command.active)throw conflict('The product already has this status.');
        result.productId=p.id;await client.query('UPDATE inventory_products SET active=$3,revision=revision+1 WHERE hospital_id=$1 AND id=$2',[hospital,p.id,command.active]);snapshot={code:p.code,name:p.name,unit:p.unit,active:command.active,reason:command.reason,revision:p.revision+1};
      }else if(command.type==='batch.create'){
        const p=await product(client,hospital,command.productId);if(!p.active)throw conflict('Activate this product before adding a batch.');
        if((await client.query('SELECT 1 FROM inventory_batches WHERE hospital_id=$1 AND product_id=$2 AND lot=$3',[hospital,p.id,command.lot])).rowCount)throw conflict('This lot already exists for the product.');
        result.productId=p.id;result.batchId=randomUUID();await client.query('INSERT INTO inventory_batches(id,hospital_id,product_id,lot,expiry) VALUES($1,$2,$3,$4,$5)',[result.batchId,hospital,p.id,command.lot,command.expiry]);snapshot={code:p.code,name:p.name,unit:p.unit,lot:command.lot,expiry:command.expiry,quarantined:false,revision:1};
      }else{
        const b=await batch(client,hospital,command.batchId);const p=await product(client,hospital,b.product_id);if(b.revision!==command.expectedRevision)throw conflict('This batch changed. Refresh stock and review your draft.','STALE_INVENTORY');result.productId=p.id;result.batchId=b.id;
        if(command.type==='batch.status'){
          if(b.quarantined===command.quarantined)throw conflict('The batch already has this status.');await client.query('UPDATE inventory_batches SET quarantined=$3,revision=revision+1 WHERE hospital_id=$1 AND id=$2',[hospital,b.id,command.quarantined]);snapshot={code:p.code,name:p.name,unit:p.unit,lot:b.lot,expiry:b.expiry_text,quarantined:command.quarantined,reason:command.reason,revision:b.revision+1};
        }else{
          const balance=b.balance+command.quantity;if(balance<0||balance>1000000000)throw conflict('The adjustment would make stock negative or exceed the supported limit.','STOCK_LIMIT');
          await client.query('INSERT INTO inventory_movements(id,hospital_id,batch_id,kind,quantity) VALUES($1,$2,$3,$4,$5)',[result.eventId,hospital,b.id,command.type,command.quantity]);await client.query('UPDATE inventory_batches SET revision=revision+1 WHERE hospital_id=$1 AND id=$2',[hospital,b.id]);
          snapshot={code:p.code,name:p.name,unit:p.unit,lot:b.lot,expiry:b.expiry_text,quantity:command.quantity,balance,...(command.type==='stock.receive'?{reference:command.reference}:{reason:command.reason}),revision:b.revision+1};
        }
      }
      await saveEvent(client,hospital,actor,key.data,hash,result,command.type,snapshot);return result;
    });
  });
  app.post<{Params:{id:string}}>('/api/visits/:id/inventory/commands',{bodyLimit:16384},async request=>{
    const parsed=pharmacyCommandSchema.safeParse(request.body);const key=inventoryUuid.safeParse(request.headers['idempotency-key']);const id=inventoryUuid.safeParse(request.params.id);if(!parsed.success||!key.success||!empty.safeParse(request.query).success)throw invalid();if(!id.success)throw missing();
    const command=parsed.data;const session=sessions.get(request)!;const hospital=session.user.hospital.id;const hash=digest(JSON.stringify({visit:id.data,command}));
    return transaction(session,true,command.type==='authorize'?['admin','clinician']:writers,async(client,actor)=>{
      const {rows:[row]}=await client.query<{data:Visit;revision:number;patient_id:string}>('SELECT data,revision,patient_id FROM outpatient_visits WHERE hospital_id=$1 AND id=$2',[hospital,id.data]);if(!row)throw missing();
      const prior=await receipt(client,hospital,actor.id,key.data,hash);if(prior)return prior;
      if(row.revision!==command.expectedVisitRevision)throw conflict('This visit changed. Refresh the visit and review your retained draft.','STALE_VISIT');
      const prescription=row.data.prescriptions.find(p=>p.id===command.prescriptionId);if(!prescription)throw missing();if(row.data.status!=='active'||prescription.status!=='pending')throw conflict('Only pending prescriptions in active visits can change.');
      const authorization=(await readPharmacyAuthorizations(client,hospital,id.data)).find(a=>a.prescriptionId===command.prescriptionId);
      const result:InventoryResult={eventId:randomUUID(),productId:'',visitRevision:row.revision+1};let snapshot:object;let next:'fulfilled'|'cancelled'|undefined;
      if(command.type==='authorize'){
        if(authorization)throw conflict('This prescription already has an immutable product authorization.');const p=await product(client,hospital,command.productId);if(!p.active)throw conflict('Choose an active product.');result.productId=p.id;
        await client.query('INSERT INTO inventory_authorizations(id,hospital_id,visit_id,prescription_id,product_id,quantity,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[result.eventId,hospital,id.data,prescription.id,p.id,command.quantity,actor.id,actor.display_name]);snapshot={code:p.code,name:p.name,unit:p.unit,quantity:command.quantity};
      }else{
        if(!authorization)throw conflict('A clinician must authorize product and quantity before stock-accounted supply.');if(authorization.cancelled||authorization.remaining===0)throw conflict('No authorized quantity remains.');result.productId=authorization.product.id;
        if(command.type==='cancel'){
          next='cancelled';snapshot={code:authorization.product.code,name:authorization.product.name,unit:authorization.product.unit,cancelledQuantity:authorization.remaining,supplied:authorization.supplied,reason:command.reason};
        }else{
          const b=await batch(client,hospital,command.batchId);if(b.product_id!==authorization.product.id)throw missing();if(b.revision!==command.expectedBatchRevision)throw conflict('This batch changed. Refresh stock and review your retained draft.','STALE_INVENTORY');
          if(batchDto(b,await addisDate(client)).eligibility!=='available')throw conflict('This batch cannot be supplied: check product status, quarantine and expiry.','BATCH_UNAVAILABLE');
          if(command.quantity>authorization.remaining)throw conflict('The quantity exceeds the remaining authorization.','EXCESS_SUPPLY');if(command.quantity>b.balance)throw conflict('This batch has insufficient stock.','INSUFFICIENT_STOCK');
          result.batchId=b.id;await client.query('INSERT INTO inventory_movements(id,hospital_id,batch_id,kind,quantity) VALUES($1,$2,$3,$4,$5)',[result.eventId,hospital,b.id,'dispense',-command.quantity]);await client.query('UPDATE inventory_batches SET revision=revision+1 WHERE hospital_id=$1 AND id=$2',[hospital,b.id]);
          if(command.quantity===authorization.remaining)next='fulfilled';snapshot={code:authorization.product.code,name:authorization.product.name,unit:authorization.product.unit,lot:b.lot,expiry:b.expiry_text,quantity:command.quantity,balance:b.balance-command.quantity,remaining:authorization.remaining-command.quantity};
        }
        await client.query('INSERT INTO inventory_dispenses(id,hospital_id,authorization_id,movement_id,kind,quantity,visit_revision) VALUES($1,$2,$3,$4,$5,$6,$7)',[result.eventId,hospital,authorization.id,result.batchId?result.eventId:null,command.type,command.type==='dispense'?command.quantity:0,result.visitRevision]);
      }
      let data=row.data;
      if(next){
        const {rows:[p]}=await client.query('SELECT * FROM patients WHERE hospital_id=$1 AND id=$2',[hospital,row.patient_id]);
        const state=execute({version:1,revision:row.revision,patients:[{id:p.id,name:p.name,...(p.age===null?{}:{age:p.age}),contact:p.contact,createdAt:p.created_at.toISOString()}],visits:[data],events:[]},{type:'fulfill',visitId:id.data,prescriptionId:prescription.id,next});data=state.visits[0];
      }
      await client.query('UPDATE outpatient_visits SET revision=$3,data=$4 WHERE hospital_id=$1 AND id=$2',[hospital,id.data,result.visitRevision,data]);
      await client.query(`INSERT INTO audit_events(id,hospital_id,actor_id,patient_id,action,visit_id,visit_revision,detail,subject_type,subject_id,transition_from,transition_to)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'prescription',$9,'pending',$10)`,[randomUUID(),hospital,actor.id,row.patient_id,command.type==='authorize'?'visit.authorize':command.type==='dispense'?'visit.dispense':'visit.inventoryCancel',id.data,result.visitRevision,command.type==='authorize'?'Authorized product and quantity for pharmacy.':command.type==='dispense'?'Recorded stock-accounted prescription supply.':'Cancelled remaining authorized supply; supplied stock retained.',prescription.id,next??'pending']);
      await saveEvent(client,hospital,actor,key.data,hash,result,command.type,snapshot,id.data,prescription.id);return result;
    });
  });
}
