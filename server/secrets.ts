import { constants, openSync, fstatSync, readSync, closeSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { trustedParents } from './mfa-config.ts';
export function privateSecret(path: string): string {
  const target = resolve(path);
  trustedParents(target);
  const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.mode & 0o077 ||
      ![process.getuid?.(), lstatSync('/').uid].includes(stat.uid) ||
      stat.size < 1 ||
      stat.size > 16384
    )
      throw Error('Private configuration rejected.');
    const data = Buffer.alloc(16385);
    let count = 0,
      read = 0;
    while ((read = readSync(fd, data, count, data.length - count, null)) > 0) {
      count += read;
      if (count > 16384) throw Error('Private configuration rejected.');
    }
    return data
      .subarray(0, count)
      .toString('utf8')
      .replace(/\r?\n$/, '');
  } finally {
    closeSync(fd);
  }
}
export function databaseUrl() {
  return process.env.DATABASE_URL_FILE
    ? privateSecret(process.env.DATABASE_URL_FILE)
    : process.env.DATABASE_URL;
}
