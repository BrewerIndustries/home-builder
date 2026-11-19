import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanThumb, hashShareToken, newShareToken, validShareToken } from '../api/src/share.ts';
import { accountListing, decideSync, type CacheEntry } from '../src/model/offlineSync.ts';
import { shareTokenFrom } from '../src/model/share.ts';
import { MAX_THUMB, planThumbnail, thumbSrc, THUMB_H, THUMB_W } from '../src/model/thumbnail.ts';
import { box, project, wall } from './helpers.ts';

// ---------------- share tokens ----------------
test('share tokens are 43 url-safe characters and unique', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const t = newShareToken();
    assert.match(t, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(validShareToken(t));
    seen.add(t);
  }
  assert.equal(seen.size, 200);
});

test('malformed share tokens are refused', () => {
  for (const bad of ['', 'abc', 'x'.repeat(42), 'x'.repeat(44), 'a'.repeat(42) + '=', 'a'.repeat(42) + '/', null, 42]) assert.equal(validShareToken(bad), false);
});

test('share token hash is stable SHA-256 hex and differs per token', async () => {
  const t = newShareToken();
  const h = await hashShareToken(t);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(await hashShareToken(t), h);
  assert.notEqual(await hashShareToken(newShareToken()), h);
  // Known vector: SHA-256("abc").
  assert.equal(await hashShareToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('the app reads only well-formed tokens from ?share=', () => {
  const t = newShareToken();
  assert.equal(shareTokenFrom(`?share=${t}`), t);
  assert.equal(shareTokenFrom(`?invite=X&share=${t}`), t);
  assert.equal(shareTokenFrom('?share=short'), null);
  assert.equal(shareTokenFrom(''), null);
});

// ---------------- thumbnails ----------------
test('empty plan has no thumbnail', () => {
  assert.equal(planThumbnail(project([])), null);
});

test('thumbnail fits the plan in the box, centred, with integer coordinates', () => {
  const svg = planThumbnail(project(box(480, 240)))!;
  assert.ok(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${THUMB_W} ${THUMB_H}">`));
  assert.ok(svg.endsWith('</svg>'));
  const nums = [...svg.matchAll(/d="([^"]+)"/g)].flatMap((m) => m[1].match(/-?\d+(\.\d+)?/g)!.map(Number));
  assert.ok(nums.length >= 16);
  for (const n of nums) {
    assert.ok(Number.isInteger(n));
    assert.ok(n >= 0 && n <= THUMB_W);
  }
  // 2:1 plan in a 4:3 box → width-limited, so it spans the padded width.
  const xs = nums.filter((_, i) => i % 2 === 0);
  assert.equal(Math.min(...xs), 5);
  assert.equal(Math.max(...xs), THUMB_W - 5);
});

test('thumbnail draws rooms, interior and exterior walls', () => {
  const p = project([...box(400, 300), wall(200, 0, 200, 300, 'interior')], [], {
    rooms: [{ id: 'r1', name: 'Living', type: 'living', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 300 }, { x: 0, y: 300 }] } as any],
  });
  const svg = planThumbnail(p)!;
  assert.equal((svg.match(/<path /g) ?? []).length, 3);
  assert.match(svg, /fill-opacity/);
  assert.match(svg, /stroke-width="1"/);
  assert.match(svg, /stroke-width="2.2"/);
});

test('a single straight wall still makes a finite thumbnail', () => {
  const svg = planThumbnail(project([wall(0, 0, 300, 0)]))!;
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test('a very busy plan drops detail to stay under the size cap', () => {
  const walls = [];
  for (let i = 0; i < 1500; i++) walls.push(wall(i * 7, (i * 13) % 997, i * 7 + 50, ((i * 29) % 991) + 3, i % 3 ? 'interior' : 'exterior'));
  const svg = planThumbnail(project(walls));
  assert.ok(svg === null || svg.length <= MAX_THUMB);
});

test('the Worker accepts generated thumbnails and nothing else', () => {
  const svg = planThumbnail(project(box(480, 240)))!;
  assert.equal(cleanThumb(svg), svg);
  assert.equal(cleanThumb(svg.replace('<path ', '<script>alert(1)</script><path ')), null);
  assert.equal(cleanThumb(svg.replace('<path ', '<path onload="x" ')), null);
  assert.equal(cleanThumb(svg.replace('fill="none"', 'fill="url(#x)"')), null);
  assert.equal(cleanThumb('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image href="x"/></svg>'), null);
  assert.equal(cleanThumb('x'.repeat(MAX_THUMB + 1)), null);
  assert.equal(cleanThumb(42), null);
  assert.ok(thumbSrc(svg).startsWith('data:image/svg+xml;utf8,%3Csvg'));
});

// ---------------- offline sync ----------------
test('offline edits push normally when the server has not moved', () => {
  assert.equal(decideSync({ base: 100, editedAt: 150 }, { updated_at: 100 }), 'push');
  assert.equal(decideSync({ base: 100, editedAt: 150 }, null), 'push');
});

test('a clash is last-write-wins: later offline edit overwrites, earlier one is kept as a copy', () => {
  assert.equal(decideSync({ base: 100, editedAt: 300 }, { updated_at: 200 }), 'force');
  assert.equal(decideSync({ base: 100, editedAt: 150 }, { updated_at: 200 }), 'keep-copy');
});

const entry = (p: Partial<CacheEntry>): Omit<CacheEntry, 'data'> => ({ id: 'a', userId: 'u1', name: 'A', base: 100, editedAt: 100, dirty: false, ...p });

test('online listing marks projects with unsynced offline edits', () => {
  const rows = accountListing(
    [
      { id: 'a', name: 'A', updated_at: 100, bytes: 10 },
      { id: 'b', name: 'B', updated_at: 200, bytes: 10 },
    ],
    [entry({ id: 'a', name: 'A renamed', dirty: true, editedAt: 500 }), entry({ id: 'b' }), entry({ id: 'z', userId: 'u2', dirty: true })],
    'u1',
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.name, r.unsynced, r.offline]),
    [
      ['b', 'B', false, false],
      ['a', 'A renamed', true, false],
    ],
  );
});

test('online listing includes an unsynced project the server does not have yet', () => {
  const rows = accountListing([], [entry({ id: 'n', name: 'New', dirty: true, editedAt: 900 })], 'u1');
  assert.deepEqual(rows.map((r) => [r.id, r.unsynced]), [['n', true]]);
});

test('offline listing comes from the cache, this user only, newest first', () => {
  const rows = accountListing(null, [entry({ id: 'a', base: 100 }), entry({ id: 'b', base: 50, dirty: true, editedAt: 300 }), entry({ id: 'c', userId: 'u2' })], 'u1');
  assert.deepEqual(
    rows.map((r) => [r.id, r.updated_at, r.unsynced, r.offline]),
    [
      ['b', 300, true, true],
      ['a', 100, false, true],
    ],
  );
});
