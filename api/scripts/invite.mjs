#!/usr/bin/env node
// Mint a single-use sign-up code without the app (e.g. before the first admin exists).
//   npm run invite -- --env dev [--note "for Sam"] [--local]
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? undefined : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
};
const env = flag('env') === 'dev' ? 'dev' : 'prod';
const local = !!flag('local');
const note = typeof flag('note') === 'string' ? flag('note') : null;
const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const s = [...randomBytes(12)].map((b) => abc[b % abc.length]).join('');
const code = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
const q = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const sql = `INSERT INTO invites (code, created_by, note, created_at) VALUES (${q(code)}, NULL, ${q(note)}, ${Date.now()});`;
const args = ['wrangler', 'd1', 'execute', env === 'dev' ? 'home-builder-dev' : 'home-builder-prod'];
if (env === 'dev' && !local) args.push('--env', 'dev');
args.push(local ? '--local' : '--remote', '--command', sql);
execFileSync('npx', args, { stdio: 'inherit' });
console.log(`\nInvite code (${env}): ${code}`);
