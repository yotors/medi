import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import pg from 'pg';
import {migrate} from './db.ts';
import {schemaManifest} from './schema-manifest.ts';
import {schemaReady} from './schema.ts';
const connectionString=process.env.TEST_DATABASE_URL??process.env.DATABASE_URL;
test('genuine historical SQL adoption, atomic failure, replay, future and changed baseline refusal',async()=>{
 const schema='operations_'+randomUUID().replaceAll('-','');const admin=new pg.Pool({connectionString});const pool=new pg.Pool({connectionString,options:`-c search_path=${schema}`});
 try{
 await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query('CREATE TABLE registration_migrations(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
 for(const entry of schemaManifest.slice(0,11)){await pool.query(await readFile(new URL('./migrations/'+entry.file,import.meta.url),'utf8'));await pool.query('INSERT INTO registration_migrations(version) VALUES ($1)',[entry.version]);}
 const definition=(await pool.query("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='inventory_movements'::regclass AND conname='inventory_movements_quantity_check'")).rows[0].definition;
 await pool.query('ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_quantity_check, ADD CONSTRAINT inventory_movements_quantity_check '+definition);
 await assert.rejects(schemaReady(pool));
 await assert.rejects(migrate(pool,async()=>{throw Error('synthetic grant failure');}));
 assert.equal((await pool.query('SELECT max(version) v FROM registration_migrations')).rows[0].v,11);
 await migrate(pool);await migrate(pool);await schemaReady(pool);
 await pool.query("INSERT INTO registration_migrations(version,checksum) VALUES (999,'future')");await assert.rejects(migrate(pool));await assert.rejects(schemaReady(pool));
 await pool.query('DELETE FROM registration_migrations WHERE version=999');
 await pool.query('DELETE FROM registration_migrations WHERE version=7');await assert.rejects(migrate(pool));
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
