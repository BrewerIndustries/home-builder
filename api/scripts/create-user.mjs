#!/usr/bin/env node
// Create (or the first admin) user directly in D1. Hashes the password locally
// with the SAME format the Worker verifies (pbkdf2$iter$saltB64$hashB64) and
// inserts via `wrangler d1 execute`.
//
//   npm run create-user -- --env prod --email you@example.com --role admin --password 'secret'
//   npm run create-user -- --env dev  --email friend@example.com  --role user --password 'secret'
//
// Flags: --env prod|dev (default prod) · --email · --password · --role user|admin
//        --name "Display Name" (optional) · --local (target the local D1 instead of --remote)

import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

const args = parse(process.argv.slice(2));
const env = args.env === 'dev' ? 'dev' : 'prod';
const email = String(args.email || '').trim().toLowerCase();
const password = String(args.password || '');
const role = ['user', 'admin'].includes(args.role) ? args.role : 'user';
const name = args.name ? String(args.name) : null;
const dbName = env === 'dev' ? 'home-builder-dev' : 'home-builder-prod';
const target = args.local ? '--local' : '--remote';

if (!email || password.length < 8) {
  console.error('Usage: --email <email> --password <min 8 chars> [--role user|admin] [--env prod|dev] [--name "..."]');
  process.exit(1);
}

const ITER = 100_000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, ITER, 32, 'sha256');
const stored = `pbkdf2$${ITER}$${salt.toString('base64')}$${hash.toString('base64')}`;
const id = randomUUID();
const q = (s) => (s === null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

const sql =
  `INSERT INTO users (id,email,password_hash,role,display_name,created_at) VALUES ` +
  `(${q(id)},${q(email)},${q(stored)},${q(role)},${q(name)},${Date.now()});`;

// The dev D1 binding lives under [env.dev], so remote dev commands need --env dev.
const wranglerArgs = ['wrangler', 'd1', 'execute', dbName];
if (env === 'dev' && !args.local) wranglerArgs.push('--env', 'dev');
wranglerArgs.push(target, '--command', sql);

console.log(`Creating ${role} "${email}" in ${dbName} (${target})...`);
execFileSync('npx', wranglerArgs, { stdio: 'inherit' });
console.log('Done.');
