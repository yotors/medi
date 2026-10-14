// Fixed owner-image code. Output must be durably published before commit is accepted.
import { createInterface } from 'node:readline';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPool } from './compiled/server/db.js';
import { hashPassword } from './compiled/server/auth.js';
import { issueGrant } from './compiled/server/mfa.js';
const input = createInterface({ input: process.stdin }),
  lines = input[Symbol.asyncIterator](),
  pool = createPool();
let client;
const timeout = setTimeout(() => process.exit(1), 30000);
try {
  const first = await lines.next();
  if (first.done) throw Error();
  const c = JSON.parse(first.value);
  const password = randomBytes(24).toString('base64url'),
    hash = await hashPassword(password),
    hospital = randomUUID(),
    user = randomUUID();
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query('LOCK TABLE hospitals IN EXCLUSIVE MODE');
  if ((await client.query('SELECT 1 FROM hospitals LIMIT 1')).rowCount) throw Error();
  await client.query('INSERT INTO hospitals(id,code,name) VALUES ($1,$2,$3)', [
    hospital,
    c.hospitalCode,
    c.hospitalName,
  ]);
  await client.query(
    "INSERT INTO staff_users(id,hospital_id,username,display_name,role,password_hash) VALUES ($1,$2,$3,$4,'admin',$5)",
    [user, hospital, c.username, c.operator, hash],
  );
  const grant = await issueGrant(client, hospital, user, null, c.operator, 'initial_enrollment');
  process.stdout.write(JSON.stringify({ password, ...grant }) + '\n');
  const command = await lines.next();
  if (command.done || command.value !== 'commit') throw Error();
  await client.query('COMMIT');
} catch {
  if (client) await client.query('ROLLBACK');
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  input.close();
  client?.release();
  await pool.end();
}
