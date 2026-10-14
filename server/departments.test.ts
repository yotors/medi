import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import pg from 'pg';
import { buildApp } from './app.ts';
import { digest } from './auth.ts';
import { migrate } from './db.ts';
import { departmentCommandSchema, financialProjection } from '../shared/departments.ts';
import { execute } from '../shared/visit-domain.ts';
import type { StaffRole } from '../shared/registration.ts';
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw Error('Departments tests require a database.');
const schema = `departments_test_${randomUUID().replaceAll('-', '')}`,
  database = new pg.Pool({ connectionString }),
  pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}` }),
  origin = 'http://127.0.0.1:5173',
  app = buildApp({ pool, origin });
type Auth = { id: string; hospital: string; cookie: string; csrf: string };
let users: Record<string, Auth>, other: Auth;
async function actor(hospital: string, role: StaffRole) {
  const id = randomUUID(),
    token = randomBytes(32).toString('base64url'),
    csrf = randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES($1,$2,$6,$3,$4,$5)',
    [id, hospital, `Fictional ${role}`, role, 'unused', id],
  );
  await pool.query(
    "INSERT INTO staff_sessions(token_hash,user_id,csrf_token,expires_at,auth_state) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour','complete')",
    [digest(token), id, csrf],
  );
  return { id, hospital, cookie: `staff_session=${token}`, csrf };
}
const get = (u: Auth, path: string) => app.inject({ url: path, headers: { cookie: u.cookie } });
const post = (u: Auth, path: string, payload: object, key: string = randomUUID()) =>
  app.inject({
    method: 'POST',
    url: path,
    headers: { cookie: u.cookie, origin, 'x-csrf-token': u.csrf, 'idempotency-key': key },
    payload,
  });
async function ok(u: Auth, path: string, value: object, key?: string) {
  const r = await post(u, path, value, key);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
const department = (value: object, u?: Auth, key?: string) =>
  ok(u ?? users.admin, '/api/departments/commands', value, key);
async function visit() {
  const p = await post(users.admin, '/api/patients', {
    name: `Fictional Department Patient ${randomUUID().slice(0, 8)}`,
    contact: '',
  });
  assert.equal(p.statusCode, 201, p.body);
  const v = await post(users.admin, `/api/patients/${p.json().patient.id}/visits`, {});
  assert.equal(v.statusCode, 201, v.body);
  return v.json().visit;
}
async function order(catalogId?: string) {
  let v = await visit();
  v = (
    await ok(users.clinician, `/api/visits/${v.id}/commands`, {
      expectedRevision: v.revision,
      command: { type: 'order', test: 'Blood glucose', ...(catalogId ? { catalogId } : {}) },
    })
  ).visit;
  return v;
}
async function stock(q = 0) {
  const p = await ok(users.pharmacist, '/api/inventory/commands', {
    type: 'product.create',
    code: `P${randomUUID().slice(0, 8)}`,
    name: 'Fictional item',
    unit: 'tablet',
  });
  const b = await ok(users.pharmacist, '/api/inventory/commands', {
    type: 'batch.create',
    productId: p.productId,
    lot: 'Fictional lot',
    expiry: '2099-12-31',
  });
  if (q)
    await ok(users.pharmacist, '/api/inventory/commands', {
      type: 'stock.receive',
      batchId: b.batchId,
      expectedRevision: 1,
      quantity: q,
      reference: 'Fictional initial stock',
    });
  return { productId: p.productId, batchId: b.batchId };
}
async function specimen() {
  const catalog = await department({
    type: 'lab.catalog',
    code: 'GLU',
    name: 'Blood glucose',
    specimen: 'Plasma',
    unit: 'configured unit',
    criticalHigh: 100,
  });
  const v = await order(catalog.id);
  const r = await department(
    {
      type: 'lab.register',
      catalogId: catalog.id,
      visitId: v.id,
      orderId: v.orders[0].id,
      accession: randomUUID(),
      clinicianId: users.clinician.id,
    },
    users.lab,
  );
  return { ...r, v };
}
async function invoice() {
  const v = await visit(),
    dep = await ok(users.admin, '/api/configuration/commands', {
      type: 'department.create',
      code: `D${randomUUID().slice(0, 8).toUpperCase()}`,
      name: 'Fictional service department',
    }),
    svc = await ok(users.admin, '/api/configuration/commands', {
      type: 'service.create',
      departmentId: dep.entry.id,
      code: `S${randomUUID().slice(0, 8).toUpperCase()}`,
      name: 'Fictional service',
      priceMinor: 10000,
    });
  const inv = await ok(users.cashier, `/api/visits/${v.id}/billing/commands`, {
    type: 'invoice.issue',
    lines: [{ serviceId: svc.entry.id, serviceRevision: 1, quantity: 1 }],
  });
  await ok(users.cashier, `/api/visits/${v.id}/billing/commands`, {
    type: 'payment.record',
    invoiceId: inv.invoiceId,
    expectedRevision: 1,
    amountMinor: 10000,
    method: 'cash',
  });
  const payment = (
    await pool.query('SELECT id FROM billing_payments WHERE invoice_id=$1', [inv.invoiceId])
  ).rows[0].id;
  return { v, invoiceId: inv.invoiceId, paymentId: payment };
}
before(async () => {
  await database.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
});
beforeEach(async () => {
  await pool.query('TRUNCATE hospitals CASCADE');
  const h = randomUUID(),
    b = randomUUID();
  await pool.query(
    "INSERT INTO hospitals(id,code,name) VALUES($1,'fiction-a','Fictional A'),($2,'fiction-b','Fictional B')",
    [h, b],
  );
  users = {};
  for (const role of [
    'admin',
    'lab',
    'clinician',
    'pharmacist',
    'cashier',
    'auditor',
  ] as StaffRole[])
    users[role] = await actor(h, role);
  other = await actor(b, 'admin');
});
after(async () => {
  await app.close();
  await pool.end();
  await database.query(`DROP SCHEMA ${schema} CASCADE`);
  await database.end();
});
test('bounded strict commands and minor-unit projections reject invalid totals', () => {
  assert.equal(
    departmentCommandSchema.safeParse({ type: 'shift.open', openingMinor: 0, extra: true }).success,
    false,
  );
  assert.equal(
    departmentCommandSchema.safeParse({
      type: 'lab.catalog',
      code: 'X',
      name: 'N',
      specimen: 'S',
      unit: 'U',
      criticalHigh: Infinity,
    }).success,
    false,
  );
  assert.throws(() => financialProjection(100, 50, 101, 0));
  assert.throws(() => financialProjection(100, 50, 0, 51));
  assert.deepEqual(financialProjection(100, 100, 20, 10), {
    totalMinor: 80,
    paidMinor: 90,
    creditedMinor: 20,
    refundedMinor: 10,
    balanceMinor: 0,
    refundableMinor: 10,
  });
});
test('specimen rejection blocks release, recollection retains history, critical review closes and correction reopens', async () => {
  const r = await specimen();
  await department(
    { type: 'lab.reject', id: r.id, expectedRevision: 1, reason: 'Fictional specimen mismatch' },
    users.lab,
  );
  assert.equal(
    (
      await post(users.lab, '/api/departments/commands', {
        type: 'lab.release',
        id: r.id,
        expectedRevision: 2,
      })
    ).statusCode,
    409,
  );
  await department(
    {
      type: 'lab.recollect',
      id: r.id,
      expectedRevision: 2,
      accession: 'Fictional new accession',
      reason: 'Recollect correct specimen',
    },
    users.lab,
  );
  await department({ type: 'lab.collect', id: r.id, expectedRevision: 3 }, users.lab);
  await department({ type: 'lab.receive', id: r.id, expectedRevision: 4 }, users.lab);
  await department(
    {
      type: 'lab.result',
      id: r.id,
      expectedRevision: 5,
      value: '101 configured unit',
      numericValue: 101,
      critical: false,
    },
    users.lab,
  );
  await department({ type: 'lab.release', id: r.id, expectedRevision: 6 }, users.lab);
  let detail = (await get(users.admin, `/api/visits/${r.v.id}`)).json().visit;
  assert.equal(detail.orders[0].status, 'released');
  assert.equal(detail.clinical.pendingReviews, 1);
  await department(
    {
      type: 'lab.acknowledge',
      id: r.id,
      expectedRevision: 7,
      delivery: 'Delivered in person',
      acknowledgement: 'Reviewed and acted',
    },
    users.clinician,
  );
  await department(
    {
      type: 'lab.result',
      id: r.id,
      expectedRevision: 8,
      value: 'Corrected fictional result',
      critical: false,
      reason: 'Instrument correction',
    },
    users.lab,
  );
  await department({ type: 'lab.release', id: r.id, expectedRevision: 9 }, users.lab);
  detail = (await get(users.admin, `/api/visits/${r.v.id}`)).json().visit;
  assert.equal(detail.orders[0].result, '101 configured unit');
  assert.equal(detail.clinical.records[0].latest.body, 'Corrected fictional result');
  assert.equal(detail.clinical.pendingReviews, 1);
  const row = (await pool.query('SELECT data FROM department_records WHERE id=$1', [r.id])).rows[0];
  assert.equal(row.data.versions.length, 2);
  assert.equal(row.data.review, 'pending');
  assert.equal(
    (await get(users.auditor, `/api/departments/${r.id}/history`)).json().entries.length,
    10,
  );
});
test('partial purchase receipt retries and concurrent remaining quantities cannot overreceive', async () => {
  const s = await stock(),
    supplier = await department(
      { type: 'supplier.create', name: 'Fictional supplier', contact: 'Fictional contact' },
      users.pharmacist,
    ),
    po = await department(
      {
        type: 'purchase.create',
        supplierId: supplier.id,
        lines: [
          {
            productId: s.productId,
            unit: 'tablet',
            quantity: 4,
            costMinor: 100,
            packSize: 2,
            controlled: true,
          },
        ],
      },
      users.pharmacist,
    );
  await department({
    type: 'purchase.approve',
    id: po.id,
    expectedRevision: 1,
    reason: 'Approved fictional purchase',
  });
  const receipt = {
      type: 'purchase.receive',
      id: po.id,
      expectedRevision: 2,
      line: 0,
      batchId: s.batchId,
      expectedBatchRevision: 1,
      quantity: 3,
      authorization: 'Responsible fictional authorization',
    },
    key = randomUUID();
  await department(receipt, users.pharmacist, key);
  await department(receipt, users.pharmacist, key);
  assert.equal(
    (await post(users.pharmacist, '/api/departments/commands', { ...receipt, quantity: 2 }, key))
      .statusCode,
    409,
  );
  const responses = await Promise.all(
    [1, 2].map(() =>
      post(users.pharmacist, '/api/departments/commands', {
        ...receipt,
        expectedRevision: 3,
        expectedBatchRevision: 2,
        quantity: 1,
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
  assert.equal(
    (
      await pool.query(
        'SELECT sum(quantity)::integer total FROM inventory_movements WHERE batch_id=$1',
        [s.batchId],
      )
    ).rows[0].total,
    8,
  );
});
test('patient returns quarantine units and cumulative returns cannot exceed actual dispense', async () => {
  const s = await stock(10);
  let v = await visit();
  v = (
    await ok(users.clinician, `/api/visits/${v.id}/commands`, {
      expectedRevision: v.revision,
      command: { type: 'prescribe', instruction: 'Fictional instructions' },
    })
  ).visit;
  await ok(users.clinician, `/api/visits/${v.id}/inventory/commands`, {
    type: 'authorize',
    prescriptionId: v.prescriptions[0].id,
    expectedVisitRevision: v.revision,
    productId: s.productId,
    quantity: 3,
  });
  v = (await get(users.admin, `/api/visits/${v.id}`)).json().visit;
  const d = await ok(users.pharmacist, `/api/visits/${v.id}/inventory/commands`, {
    type: 'dispense',
    prescriptionId: v.prescriptions[0].id,
    expectedVisitRevision: v.revision,
    batchId: s.batchId,
    expectedBatchRevision: 2,
    quantity: 3,
  });
  const r = await department(
    {
      type: 'return.record',
      dispenseId: d.eventId,
      quantity: 2,
      reason: 'Fictional patient return',
    },
    users.pharmacist,
  );
  assert.equal(
    (
      await pool.query(
        'SELECT sum(quantity)::integer total FROM inventory_movements WHERE batch_id=$1',
        [s.batchId],
      )
    ).rows[0].total,
    7,
  );
  assert.equal(
    (
      await post(users.pharmacist, '/api/departments/commands', {
        type: 'return.record',
        dispenseId: d.eventId,
        quantity: 2,
        reason: 'Excess return',
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await post(users.pharmacist, '/api/departments/commands', {
        type: 'return.quality',
        id: r.id,
        expectedRevision: 1,
        expectedBatchRevision: 3,
        decision: 'restock',
        reason: 'Inspected',
      })
    ).statusCode,
    403,
  );
  await department({
    type: 'return.quality',
    id: r.id,
    expectedRevision: 1,
    expectedBatchRevision: 3,
    decision: 'restock',
    reason: 'Explicit authorized fictional quality decision',
  });
  assert.equal(
    (
      await pool.query(
        'SELECT sum(quantity)::integer total FROM inventory_movements WHERE batch_id=$1',
        [s.batchId],
      )
    ).rows[0].total,
    9,
  );
});
test('immutable credit refund projections prevent concurrent overrefund and preserve receipts', async () => {
  const i = await invoice();
  await department({
    type: 'invoice.credit',
    invoiceId: i.invoiceId,
    expectedRevision: 2,
    amountMinor: 4000,
    kind: 'discount',
    reason: 'Approved discount',
  });
  const refund = {
      type: 'payment.refund',
      invoiceId: i.invoiceId,
      paymentId: i.paymentId,
      expectedRevision: 3,
      amountMinor: 3000,
      kind: 'refund',
      reason: 'Recorded refund',
      method: 'cash',
    },
    key = randomUUID();
  const responses = await Promise.all([
    post(users.admin, '/api/departments/commands', refund, key),
    post(users.admin, '/api/departments/commands', refund),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
  await department(refund, users.admin, key);
  assert.equal(
    (
      await post(users.admin, '/api/departments/commands', {
        ...refund,
        expectedRevision: 4,
        amountMinor: 2000,
      })
    ).statusCode,
    409,
  );
  const detail = (await get(users.cashier, `/api/billing/invoices/${i.invoiceId}`)).json();
  assert.equal(detail.invoice.totalMinor, 6000);
  assert.equal(detail.invoice.paidMinor, 7000);
  assert.equal(detail.invoice.refundedMinor, 3000);
  assert.equal(detail.invoice.balanceMinor, 0);
  assert.equal(detail.adjustments.length, 2);
  assert.equal(
    (await pool.query('SELECT count(*)::integer count FROM billing_receipts')).rows[0].count,
    1,
  );
  await assert.rejects(pool.query("UPDATE department_finance SET reason='changed'"), /immutable/);
});
test('shift cash allocation is unique, close locks allocations, signature and manager review retained', async () => {
  const i = await invoice(),
    shift = await department({ type: 'shift.open', openingMinor: 500 }, users.cashier);
  await department(
    { type: 'shift.allocate', id: shift.id, expectedRevision: 1, paymentId: i.paymentId },
    users.cashier,
  );
  assert.equal(
    (
      await post(users.cashier, '/api/departments/commands', {
        type: 'shift.allocate',
        id: shift.id,
        expectedRevision: 2,
        paymentId: i.paymentId,
      })
    ).statusCode,
    409,
  );
  const attempts = await Promise.all([
    post(users.cashier, '/api/departments/commands', {
      type: 'shift.close',
      id: shift.id,
      expectedRevision: 2,
      countedMinor: 10400,
      signature: 'Fictional Cashier',
    }),
    post(users.cashier, '/api/departments/commands', {
      type: 'shift.allocate',
      id: shift.id,
      expectedRevision: 2,
      paymentId: i.paymentId,
    }),
  ]);
  assert.deepEqual(attempts.map((r) => r.statusCode).sort(), [200, 409]);
  await department({
    type: 'shift.review',
    id: shift.id,
    expectedRevision: 3,
    reason: 'Manager reviewed count difference',
  });
  const row = (await pool.query('SELECT data FROM department_records WHERE id=$1', [shift.id]))
    .rows[0].data;
  assert.equal(row.expectedMinor, 10500);
  assert.equal(row.differenceMinor, -100);
  assert.equal(row.status, 'reviewed');
});
test('hospital and role isolation, changed payload and revoked retry authority reject mutations', async () => {
  const s = await department(
    { type: 'supplier.create', name: 'Fictional supplier', contact: 'Fictional' },
    users.pharmacist,
  );
  assert.equal((await get(other, `/api/departments/${s.id}/history`)).statusCode, 404);
  assert.equal((await get(users.lab, '/api/departments?kind=supplier')).statusCode, 403);
  assert.equal(
    (
      await post(users.cashier, '/api/departments/commands', {
        type: 'lab.catalog',
        code: 'A',
        name: 'B',
        unit: 'C',
        specimen: 'D',
      })
    ).statusCode,
    403,
  );
  const cmd = { type: 'shift.open', openingMinor: 0 },
    key = randomUUID();
  await department(cmd, users.cashier, key);
  await pool.query("UPDATE staff_users SET role='lab' WHERE id=$1", [users.cashier.id]);
  assert.equal((await post(users.cashier, '/api/departments/commands', cmd, key)).statusCode, 403);
});
test('injected audit failure rolls stock and financial adjustments and retry receipt back atomically', async () => {
  const i = await invoice(),
    s = await stock(),
    supplier = await department({
      type: 'supplier.create',
      name: 'Fictional supplier',
      contact: 'Fictional',
    }),
    po = await department({
      type: 'purchase.create',
      supplierId: supplier.id,
      lines: [
        {
          productId: s.productId,
          unit: 'tablet',
          quantity: 1,
          costMinor: 100,
          packSize: 1,
          controlled: false,
        },
      ],
    });
  await department({
    type: 'purchase.approve',
    id: po.id,
    expectedRevision: 1,
    reason: 'Approved',
  });
  await pool.query(
    "CREATE FUNCTION fail_department_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected audit failure'; END; $$",
  );
  await pool.query(
    'CREATE TRIGGER fail_department_audit BEFORE INSERT ON department_events FOR EACH ROW EXECUTE FUNCTION fail_department_audit()',
  );
  try {
    for (const cmd of [
      {
        type: 'invoice.credit',
        invoiceId: i.invoiceId,
        expectedRevision: 2,
        amountMinor: 100,
        kind: 'credit',
        reason: 'Rollback test',
      },
      {
        type: 'purchase.receive',
        id: po.id,
        expectedRevision: 2,
        line: 0,
        batchId: s.batchId,
        expectedBatchRevision: 1,
        quantity: 1,
      },
    ]) {
      const key = randomUUID();
      assert.equal(
        (await post(users.admin, '/api/departments/commands', cmd, key)).statusCode,
        500,
      );
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::integer count FROM department_requests WHERE idempotency_key=$1',
            [key],
          )
        ).rows[0].count,
        0,
      );
    }
    assert.equal(
      (await pool.query('SELECT count(*)::integer count FROM department_finance')).rows[0].count,
      0,
    );
    assert.equal(
      (
        await pool.query(
          'SELECT count(*)::integer count FROM inventory_movements WHERE batch_id=$1',
          [s.batchId],
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await pool.query('DROP TRIGGER fail_department_audit ON department_events');
  }
});
test('mutation rechecks actor after waiting for hospital lock', async () => {
  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM hospitals WHERE id=$1 FOR UPDATE', [
      users.cashier.hospital,
    ]);
    const pending = post(users.cashier, '/api/departments/commands', {
      type: 'shift.open',
      openingMinor: 0,
    });
    await blocker.query('UPDATE staff_users SET active=false WHERE id=$1', [users.cashier.id]);
    await blocker.query('COMMIT');
    const response = await pending;
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::integer count FROM department_records WHERE kind='shift'",
        )
      ).rows[0].count,
      0,
    );
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
});
test('legacy encounter collection and release cannot bypass registered or rejected specimens', async () => {
  const r = await specimen();
  const path = `/api/visits/${r.v.id}/commands`;
  assert.equal(
    (
      await post(users.lab, path, {
        expectedRevision: r.v.revision,
        command: { type: 'advanceOrder', orderId: r.v.orders[0].id, next: 'collected' },
      })
    ).statusCode,
    409,
  );
  await department({ type: 'lab.collect', id: r.id, expectedRevision: 1 }, users.lab);
  await department(
    { type: 'lab.reject', id: r.id, expectedRevision: 2, reason: 'Fictional compromised specimen' },
    users.lab,
  );
  const current = (await get(users.admin, `/api/visits/${r.v.id}`)).json().visit;
  assert.equal(current.orders[0].status, 'collected');
  assert.equal(
    (
      await post(users.lab, path, {
        expectedRevision: current.revision,
        command: {
          type: 'advanceOrder',
          orderId: r.v.orders[0].id,
          next: 'released',
          result: 'Bypass attempt',
        },
      })
    ).statusCode,
    409,
  );
});
test('critical department delivery acknowledgement blocks closure after legacy clinical review', async () => {
  const r = await specimen();
  await department({ type: 'lab.collect', id: r.id, expectedRevision: 1 }, users.lab);
  await department({ type: 'lab.receive', id: r.id, expectedRevision: 2 }, users.lab);
  await department(
    {
      type: 'lab.result',
      id: r.id,
      expectedRevision: 3,
      value: 'Fictional critical result',
      critical: true,
    },
    users.lab,
  );
  await department({ type: 'lab.release', id: r.id, expectedRevision: 4 }, users.lab);
  let v = (await get(users.admin, `/api/visits/${r.v.id}`)).json().visit;
  const correction = v.clinical.records[0];
  await ok(users.clinician, `/api/visits/${v.id}/clinical/commands`, {
    type: 'result.review',
    subjectId: r.v.orders[0].id,
    expectedVersion: correction.version,
    amendmentId: correction.latest.id,
  });
  v = (
    await ok(users.clinician, `/api/visits/${v.id}/commands`, {
      expectedRevision: v.revision,
      command: { type: 'advanceOrder', orderId: r.v.orders[0].id, next: 'reviewed' },
    })
  ).visit;
  v = (
    await ok(users.clinician, `/api/visits/${v.id}/commands`, {
      expectedRevision: v.revision,
      command: { type: 'note', body: 'Fictional documented consultation' },
    })
  ).visit;
  assert.equal(v.clinical.pendingReviews, 0);
  assert.equal(
    (
      await post(users.clinician, `/api/visits/${v.id}/commands`, {
        expectedRevision: v.revision,
        command: { type: 'close' },
      })
    ).statusCode,
    409,
  );
  await department(
    {
      type: 'lab.acknowledge',
      id: r.id,
      expectedRevision: 5,
      delivery: 'Fictional direct delivery',
      acknowledgement: 'Responsible clinician reviewed and acted',
    },
    users.clinician,
  );
  v = (
    await ok(users.clinician, `/api/visits/${v.id}/commands`, {
      expectedRevision: v.revision,
      command: { type: 'close' },
    })
  ).visit;
  assert.equal(v.status, 'closed');
});

test('closed reviewed historical orders cannot register independent unamended results and collection rejects externally reviewed orders', async () => {
  const catalog = await department({
    type: 'lab.catalog',
    code: 'LEGACY',
    name: 'Blood glucose',
    specimen: 'Plasma',
    unit: 'configured unit',
  });
  const patient = {
    id: randomUUID(),
    name: 'Fictional closed archived patient',
    contact: '',
    createdAt: new Date().toISOString(),
  };
  let state = execute(
    { version: 1, revision: 0, patients: [patient], visits: [], events: [] },
    { type: 'checkIn', patientId: patient.id },
  );
  const id = state.visits[0].id;
  for (const command of [
    { type: 'note' as const, visitId: id, body: 'Fictional archived note' },
    { type: 'order' as const, visitId: id, test: 'Blood glucose' },
  ])
    state = execute(state, command);
  const orderId = state.visits[0].orders[0].id;
  for (const next of ['collected', 'released', 'reviewed'] as const)
    state = execute(state, {
      type: 'advanceOrder',
      visitId: id,
      orderId,
      next,
      ...(next === 'released' ? { result: 'Retained archived original' } : {}),
    });
  state = execute(state, { type: 'settle', visitId: id });
  state = execute(state, { type: 'close', visitId: id });
  await pool.query(
    'INSERT INTO patients(id,hospital_id,record_number,name,normalized_name) VALUES($1,$2,$3,$4,$4)',
    [patient.id, users.admin.hospital, 'ARCHIVE-1', patient.name],
  );
  await pool.query(
    'INSERT INTO outpatient_visits(id,hospital_id,patient_id,revision,status,opened_at,data) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      id,
      users.admin.hospital,
      patient.id,
      state.revision,
      'closed',
      state.visits[0].openedAt,
      state.visits[0],
    ],
  );
  assert.equal(
    (
      await post(users.lab, '/api/departments/commands', {
        type: 'lab.register',
        catalogId: catalog.id,
        visitId: id,
        orderId,
        accession: 'ARCHIVE-NO-BYPASS',
        clinicianId: users.clinician.id,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer count FROM department_records WHERE kind='specimen'",
      )
    ).rows[0].count,
    0,
  );
  const r = await specimen();
  await pool.query(
    "UPDATE outpatient_visits SET data=jsonb_set(jsonb_set(data,'{orders,0,status}','\"reviewed\"'::jsonb),'{orders,0,result}','\"External original\"'::jsonb) WHERE id=$1",
    [r.v.id],
  );
  assert.equal(
    (
      await post(users.lab, '/api/departments/commands', {
        type: 'lab.collect',
        id: r.id,
        expectedRevision: 1,
      })
    ).statusCode,
    409,
  );
});
test('configured custom test order label and hospital ID are validated, released and reviewed with known-label compatibility', async () => {
  let v = await visit();
  const catalog = await department({
    type: 'lab.catalog',
    code: 'CUSTOM',
    name: 'Fictional custom coagulation test',
    specimen: 'Configured specimen',
    unit: 'Configured unit',
  });
  assert.equal(
    (
      await post(users.clinician, `/api/visits/${v.id}/commands`, {
        expectedRevision: v.revision,
        command: { type: 'order', test: 'Unknown unconfigured test' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await post(users.clinician, `/api/visits/${v.id}/commands`, {
        expectedRevision: v.revision,
        command: { type: 'order', test: 'Forged name', catalogId: catalog.id },
      })
    ).statusCode,
    409,
  );
  const foreign = await department(
    {
      type: 'lab.catalog',
      code: 'FOREIGN',
      name: 'Fictional foreign test',
      specimen: 'Specimen',
      unit: 'Unit',
    },
    other,
  );
  assert.equal(
    (
      await post(users.clinician, `/api/visits/${v.id}/commands`, {
        expectedRevision: v.revision,
        command: { type: 'order', test: 'Fictional foreign test', catalogId: foreign.id },
      })
    ).statusCode,
    409,
  );
  v = (
    await ok(users.clinician, `/api/visits/${v.id}/commands`, {
      expectedRevision: v.revision,
      command: { type: 'order', test: 'Fictional custom coagulation test', catalogId: catalog.id },
    })
  ).visit;
  const order = v.orders[0];
  assert.equal(order.catalogId, catalog.id);
  assert.equal(order.test, 'Fictional custom coagulation test');
  assert.equal(
    (await pool.query('SELECT data FROM outpatient_visits WHERE id=$1', [v.id])).rows[0].data
      .charges.length,
    0,
  );
  assert.equal(
    (
      await post(users.lab, '/api/departments/commands', {
        type: 'lab.register',
        catalogId: foreign.id,
        visitId: v.id,
        orderId: order.id,
        accession: 'WRONG',
        clinicianId: users.clinician.id,
      })
    ).statusCode,
    404,
  );
  const wrong = await department({
    type: 'lab.catalog',
    code: 'OTHER',
    name: 'Fictional other test',
    specimen: 'Specimen',
    unit: 'Unit',
  });
  assert.equal(
    (
      await post(users.lab, '/api/departments/commands', {
        type: 'lab.register',
        catalogId: wrong.id,
        visitId: v.id,
        orderId: order.id,
        accession: 'WRONG',
        clinicianId: users.clinician.id,
      })
    ).statusCode,
    409,
  );
  const specimenId = (
    await department(
      {
        type: 'lab.register',
        catalogId: catalog.id,
        visitId: v.id,
        orderId: order.id,
        accession: 'CUSTOM-ACCESSION',
        clinicianId: users.clinician.id,
      },
      users.lab,
    )
  ).id;
  await department({ type: 'lab.collect', id: specimenId, expectedRevision: 1 }, users.lab);
  await department({ type: 'lab.receive', id: specimenId, expectedRevision: 2 }, users.lab);
  await department(
    {
      type: 'lab.result',
      id: specimenId,
      expectedRevision: 3,
      value: 'Fictional configured result',
      critical: false,
    },
    users.lab,
  );
  await department({ type: 'lab.release', id: specimenId, expectedRevision: 4 }, users.lab);
  v = (await get(users.admin, `/api/visits/${v.id}`)).json().visit;
  v = (
    await ok(users.clinician, `/api/visits/${v.id}/commands`, {
      expectedRevision: v.revision,
      command: { type: 'advanceOrder', orderId: order.id, next: 'reviewed' },
    })
  ).visit;
  assert.equal(v.orders[0].status, 'reviewed');
  v = (
    await ok(users.clinician, `/api/visits/${v.id}/commands`, {
      expectedRevision: v.revision,
      command: { type: 'order', test: 'Blood count' },
    })
  ).visit;
  assert.equal(v.orders[1].catalogId, undefined);
  assert.equal(
    (await pool.query('SELECT data FROM outpatient_visits WHERE id=$1', [v.id])).rows[0].data
      .charges.length,
    0,
  );
});
test('search sources are bounded, searchable in POST bodies and hospital/role scoped with revisions and factual labels', async () => {
  const v = await order();
  const options = await ok(users.lab, '/api/departments/sources', {
    kind: 'orders',
    q: 'Fictional Department',
    page: 1,
  });
  assert.equal(options.entries.length, 1);
  assert.match(options.entries[0].label, /MRN/);
  assert.equal(options.entries[0].values.visitId, v.id);
  const correctedName = 'Fictional Corrected Picker Identity';
  await ok(users.admin, '/api/care/records', {
    kind: 'profile',
    patientId: v.patient.id,
    expectedRevision: 0,
    reason: 'Correcting fictional registration name',
    data: {
      name: correctedName,
      contact: '',
      dateOfBirth: null,
      sex: 'unknown',
      address: '',
      emergencyContact: '',
      identity: 'verified',
      allergiesStatus: 'not-entered',
      allergies: '',
    },
  });
  const corrected = await ok(users.lab, '/api/departments/sources', {
    kind: 'orders',
    q: correctedName,
  });
  assert.equal(corrected.entries.length, 1);
  assert.match(corrected.entries[0].label, /Fictional Corrected Picker Identity/);
  assert.equal(corrected.entries[0].values.visitId, v.id);
  assert.equal(
    (await ok(users.lab, '/api/departments/sources', { kind: 'orders', q: v.patient.name })).entries
      .length,
    0,
  );
  const i = await invoice();
  const invoices = await ok(users.cashier, '/api/departments/sources', {
    kind: 'invoices',
    q: 'Fictional Department',
  });
  assert.equal(invoices.entries[0].values.expectedRevision, '2');
  assert.match(invoices.entries[0].label, /INV-.*MRN.*100.00 ETB/);
  const payments = await ok(users.admin, '/api/departments/sources', {
    kind: 'payments',
    invoiceId: i.invoiceId,
  });
  assert.equal(payments.entries[0].values.paymentId, i.paymentId);
  assert.match(payments.entries[0].label, /RCT-/);
  const cash = await ok(users.cashier, '/api/departments/sources', { kind: 'cashEntries' });
  assert.equal(cash.entries[0].values.paymentId, i.paymentId);
  assert.equal(
    (await ok(other, '/api/departments/sources', { kind: 'invoices', q: 'Fictional Department' }))
      .entries.length,
    0,
  );
  assert.equal(
    (await post(users.lab, '/api/departments/sources', { kind: 'invoices' })).statusCode,
    403,
  );
  assert.equal(
    (await post(users.cashier, '/api/departments/sources', { kind: 'dispenses' })).statusCode,
    403,
  );
  assert.equal(
    (await post(users.admin, '/api/departments/sources', { kind: 'orders', q: 'x'.repeat(101) }))
      .statusCode,
    400,
  );
  for (let n = 0; n < 26; n++)
    await department({
      type: 'supplier.create',
      name: `Fictional source supplier ${String(n).padStart(2, '0')}`,
      contact: 'Fictional contact',
    });
  const first = await ok(users.pharmacist, '/api/departments/sources', {
      kind: 'supplier',
      q: 'source supplier',
      page: 1,
    }),
    last = await ok(users.pharmacist, '/api/departments/sources', {
      kind: 'supplier',
      q: 'source supplier',
      page: 2,
    });
  assert.equal(first.entries.length, 25);
  assert.equal(last.entries.length, 1);
  assert.equal(first.total, 26);
});

test('configured test policy binds unique known labels and prevents preregistration legacy handoffs while retaining historical fallback', async () => {
  let historical = await visit();
  historical = (
    await ok(users.clinician, `/api/visits/${historical.id}/commands`, {
      expectedRevision: historical.revision,
      command: { type: 'order', test: 'Blood count' },
    })
  ).visit;
  assert.equal(historical.orders[0].catalogId, undefined);
  const catalog = await department({
    type: 'lab.catalog',
    code: 'COUNT',
    name: 'Blood count',
    specimen: 'Configured specimen',
    unit: 'Configured unit',
    criticalHigh: 1,
  });
  for (const next of ['collected', 'released'] as const)
    historical = (
      await ok(users.lab, `/api/visits/${historical.id}/commands`, {
        expectedRevision: historical.revision,
        command: {
          type: 'advanceOrder',
          orderId: historical.orders[0].id,
          next,
          ...(next === 'released' ? { result: 'Retained historical compatible result' } : {}),
        },
      })
    ).visit;
  let v = await visit();
  const command = { expectedRevision: v.revision, command: { type: 'order', test: 'Blood count' } },
    key = randomUUID();
  v = (await ok(users.clinician, `/api/visits/${v.id}/commands`, command, key)).visit;
  assert.equal(v.orders[0].catalogId, catalog.id);
  for (const next of ['collected', 'released'] as const) {
    const response = await post(users.lab, `/api/visits/${v.id}/commands`, {
      expectedRevision: v.revision,
      command: {
        type: 'advanceOrder',
        orderId: v.orders[0].id,
        next,
        ...(next === 'released' ? { result: 'Attempt to bypass configured critical rule' } : {}),
      },
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().code, 'SPECIMEN_MANAGED');
  }
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::integer count FROM department_records WHERE kind='specimen'",
      )
    ).rows[0].count,
    0,
  );
  await department({
    type: 'lab.catalog',
    code: 'COUNT-ALT',
    name: 'Blood count',
    specimen: 'Alternative specimen',
    unit: 'Alternative unit',
  });
  const replay = await ok(users.clinician, `/api/visits/${v.id}/commands`, command, key);
  assert.equal(replay.visit.orders[0].catalogId, catalog.id);
  let ambiguous = await visit();
  const rejection = await post(users.clinician, `/api/visits/${ambiguous.id}/commands`, {
    expectedRevision: ambiguous.revision,
    command: { type: 'order', test: 'Blood count' },
  });
  assert.equal(rejection.statusCode, 409, rejection.body);
  assert.equal(rejection.json().code, 'AMBIGUOUS_TEST_CATALOG');
  ambiguous = (
    await ok(users.clinician, `/api/visits/${ambiguous.id}/commands`, {
      expectedRevision: ambiguous.revision,
      command: { type: 'order', test: 'Blood count', catalogId: catalog.id },
    })
  ).visit;
  assert.equal(ambiguous.orders[0].catalogId, catalog.id);
  const patient = {
    id: randomUUID(),
    name: 'Fictional legacy policy patient',
    contact: '',
    createdAt: new Date().toISOString(),
  };
  const legacy = execute(
    { version: 1, revision: 0, patients: [patient], visits: [], events: [] },
    { type: 'checkIn', patientId: patient.id },
  ).visits[0];
  await pool.query(
    'INSERT INTO patients(id,hospital_id,record_number,name,normalized_name) VALUES($1,$2,$3,$4,$4)',
    [patient.id, users.admin.hospital, 'LEGACY-POLICY', patient.name],
  );
  await pool.query(
    'INSERT INTO outpatient_visits(id,hospital_id,patient_id,revision,status,opened_at,data) VALUES($1,$2,$3,1,$4,$5,$6)',
    [legacy.id, users.admin.hospital, patient.id, 'active', legacy.openedAt, legacy],
  );
  const legacyResult = (
    await ok(users.clinician, `/api/visits/${legacy.id}/commands`, {
      expectedRevision: 1,
      command: { type: 'order', test: 'Blood count' },
    })
  ).visit;
  assert.equal(legacyResult.orders[0].catalogId, undefined);
  assert.equal(
    (await pool.query('SELECT data FROM outpatient_visits WHERE id=$1', [legacy.id])).rows[0].data
      .charges[1].amount,
    18000,
  );
});
