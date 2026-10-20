// Menerapkan schema Kantong ke proyek Nhost secara langsung: SQL (tabel, trigger) + metadata Hasura (track tabel, permission role "user").
// Jalur utama setelah integrasi Git Nhost: push ke GitHub → Nhost menerapkan nhost/migrations + nhost/metadata. Script ini cadangan/bootstrap.
// Pemakaian: isi NHOST_ADMIN_SECRET di .env.local, lalu `npm run setup:nhost`. Aman dijalankan ulang.
// Admin secret hanya dipakai di mesin Anda dan tidak pernah dikirim ke browser.

import { readFile } from 'node:fs/promises';

const env = await loadEnv('.env.local');
const subdomain = env.VITE_NHOST_SUBDOMAIN;
const region = env.VITE_NHOST_REGION;
const secret = env.NHOST_ADMIN_SECRET;
if (!subdomain || !region || !secret) {
  console.error('Lengkapi VITE_NHOST_SUBDOMAIN, VITE_NHOST_REGION, dan NHOST_ADMIN_SECRET di .env.local');
  process.exit(1);
}
const base = `https://${subdomain}.hasura.${region}.nhost.run`;

const TABLES = [
  'settings', 'accounts', 'categories', 'pockets', 'transactions', 'allocations',
  'adjustments', 'budgets', 'goals', 'reminders', 'occurrences', 'audit_events',
];

async function call(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': secret },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

console.log(`→ Menerapkan schema SQL ke ${subdomain} (${region})`);
const sql = await readFile('nhost/migrations/default/1792520000000_kantong_init/up.sql', 'utf8');
const r1 = await call('/v2/query', { type: 'run_sql', args: { source: 'default', sql, cascade: false, read_only: false } });
if (!r1.ok) {
  console.error('Gagal menjalankan SQL:', JSON.stringify(r1.json, null, 2));
  process.exit(1);
}
console.log('  ✓ tabel & trigger siap');

async function columnsOf(table) {
  const r = await call('/v2/query', {
    type: 'run_sql',
    args: { source: 'default', read_only: true, sql: `select column_name from information_schema.columns where table_schema='public' and table_name='${table}' order by ordinal_position` },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.json));
  return r.json.result.slice(1).map((row) => row[0]);
}

const own = { user_id: { _eq: 'X-Hasura-User-Id' } };
for (const name of TABLES) {
  const table = { schema: 'public', name };
  const t = await call('/v1/metadata', { type: 'pg_track_table', args: { source: 'default', table } });
  if (!t.ok && t.json?.code !== 'already-tracked' && t.json?.code !== 'already-exists') {
    console.error(`Gagal track ${name}:`, t.json);
    process.exit(1);
  }
  const cols = await columnsOf(name);
  const writable = cols.filter((c) => c !== 'user_id');
  const updatable = writable.filter((c) => c !== 'id');
  for (const kind of ['select', 'insert', 'update', 'delete']) {
    await call('/v1/metadata', { type: `pg_drop_${kind}_permission`, args: { source: 'default', table, role: 'user' } });
  }
  const perms = [
    ['select', { columns: cols, filter: own, allow_aggregations: false }],
    ['insert', { check: own, set: { user_id: 'X-Hasura-User-Id' }, columns: writable }],
    ['delete', { filter: own }],
  ];
  if (name !== 'audit_events') perms.push(['update', { columns: name === 'settings' ? writable : updatable, filter: own, check: own }]);
  for (const [kind, permission] of perms) {
    const p = await call('/v1/metadata', { type: `pg_create_${kind}_permission`, args: { source: 'default', table, role: 'user', permission } });
    if (!p.ok) {
      console.error(`Gagal membuat permission ${kind} pada ${name}:`, p.json);
      process.exit(1);
    }
  }
  console.log(`  ✓ ${name}: tracked + permission role "user"`);
}
console.log('Selesai. Schema Kantong siap dipakai.');

async function loadEnv(file) {
  const out = { ...process.env };
  try {
    for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* pakai process.env */
  }
  return out;
}
