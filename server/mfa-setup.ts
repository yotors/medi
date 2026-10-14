// Private operator ceremony. Credentials are written only to a newly-created 0600 file.
import { constants, openSync, writeFileSync, fsyncSync, closeSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { boundedMfa } from './mfa-db.ts';
import { createPool } from './db.ts';
import { issueGrant, securityEvent } from './mfa.ts';
import { seal, unseal, validateEnvelopes, trustedParents } from './mfa-config.ts';
const pool = createPool();
let createdOutput: string | undefined;
try {
  const [mode, hospitalCode, username, reason, operator, output, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !['grant', 'rotate-keys'].includes(mode) ||
    !hospitalCode ||
    !username ||
    !['initial_enrollment', 'lost_all_factors', 'compromised_factor'].includes(reason) ||
    !/^[A-Za-z0-9_.-]{1,80}$/.test(operator ?? '') ||
    !output
  )
    throw Error();
  const outputPath = resolve(output);
  trustedParents(outputPath, true);
  function writeOutput(value: unknown) {
    const file = openSync(
      outputPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    createdOutput = outputPath; // Ownership recorded before the first possible partial write.
    // Small synchronous publication cannot outlive transaction timeout cleanup.
    try {
      writeFileSync(file, JSON.stringify(value) + '\n');
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
  }
  await validateEnvelopes(pool);
  await boundedMfa(pool, 'proof', async (client) => {
    if (process.env.MEDI_OPERATOR_RELEASE === 'medi-release-local') {
      const {
        rows: [target],
      } = await client.query('SELECT current_database() AS database,current_user AS owner');
      if (target.database !== 'product_studio_release' || target.owner !== 'medi_migrator')
        throw Error();
    }
    const {
      rows: [hospital],
    } = await client.query('SELECT id FROM hospitals WHERE code=$1 FOR UPDATE', [hospitalCode]);
    if (!hospital) throw Error();
    const {
      rows: [user],
    } = await client.query(
      'SELECT id,active,factor_generation FROM staff_users WHERE hospital_id=$1 AND username=$2',
      [hospital.id, username],
    );
    if (!user) throw Error();
    if (mode === 'rotate-keys') {
      let count = 0;
      for (const [table, purpose] of [
        ['staff_factors', 'factor'],
        ['staff_mfa_pending', 'pending'],
      ] as const) {
        const { rows } = await client.query(
          `SELECT envelope FROM ${table} WHERE hospital_id=$1 AND user_id=$2 FOR UPDATE`,
          [hospital.id, user.id],
        );
        for (const row of rows) {
          const secret = unseal(row.envelope, hospital.id, user.id, purpose);
          const envelope = seal(secret, hospital.id, user.id, purpose);
          if (unseal(envelope, hospital.id, user.id, purpose) !== secret) throw Error();
          const updated = await client.query(
            `UPDATE ${table} SET envelope=$3 WHERE hospital_id=$1 AND user_id=$2`,
            [hospital.id, user.id, envelope],
          );
          if (updated.rowCount !== 1) throw Error();
          count++;
        }
      }
      await securityEvent(client, hospital.id, user.id, 'keys.rotated', null, operator, reason);
      writeOutput({ hospitalCode, username, reencrypted: count });
    } else {
      if (!user.active) throw Error();
      const existing = await client.query(
        'SELECT 1 FROM staff_factors WHERE user_id=$1 UNION ALL SELECT 1 FROM staff_recovery_codes WHERE user_id=$1',
        [user.id],
      );
      if (reason === 'initial_enrollment' && (user.factor_generation !== 0 || existing.rowCount))
        throw Error();
      if (reason !== 'initial_enrollment') {
        await client.query('DELETE FROM staff_factors WHERE user_id=$1', [user.id]);
        await client.query('DELETE FROM staff_recovery_codes WHERE user_id=$1', [user.id]);
        await client.query(
          'UPDATE staff_users SET factor_generation=factor_generation+1 WHERE id=$1',
          [user.id],
        );
        await securityEvent(client, hospital.id, user.id, 'factor.reset', null, operator, reason);
      }
      const grant = await issueGrant(client, hospital.id, user.id, null, operator, reason);
      writeOutput({
        hospitalCode,
        username,
        ...grant,
        instructions:
          'Verify identity independently. Deliver privately. Sign in, enter this grant within 30 minutes, and configure your own authenticator. Do not share setup keys. If a temporary password must change first, obtain a fresh grant after changing it.',
      });
    }
  });
  createdOutput = undefined;
  process.stdout.write(
    'Private operator result written. Deliver through an independently verified channel.\n',
  );
} catch {
  if (createdOutput) rmSync(createdOutput, { force: true });
  process.stderr.write(
    'Operator action could not be confirmed. A lost commit acknowledgement is uncertain; verify account state before retrying. No authentication details were logged.\n',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
