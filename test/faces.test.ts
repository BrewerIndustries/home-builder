import assert from 'node:assert/strict';
import { test } from 'node:test';
import { faceSpans, outerCorners, outerSides, wallDimLabels } from '../src/calc/faces.ts';
import type { DimLabel } from '../src/calc/faces.ts';
import { box, project, wall } from './helpers.ts';

const lengths = (ls: DimLabel[], id: string) => ls.filter((l) => l.wall.id === id).map((l) => Math.round(l.length * 100) / 100).sort((a, b) => a - b);

/** 240 × 144 exterior box (centrelines) with an interior wall teeing in from the top at x = 120. */
function plan() {
  const outer = box(240, 144);
  const mid = wall(120, 0, 120, 144, 'interior');
  return { p: project([...outer, mid]), outer, mid };
}

test('the outside face of each exterior wall is the one away from the house', () => {
  const { p, outer } = plan();
  const sides = outerSides(p);
  for (const w of outer) {
    const f = faceSpans(p).find((s) => s.wall.id === w.id && s.side === sides.get(w.id))!;
    // Outside faces lie outside the centreline box.
    const pt = { x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 };
    assert.ok(pt.x < 0 || pt.x > 240 || pt.y < 0 || pt.y > 144, JSON.stringify(pt));
  }
});

test('outside dims add a thickness, inside dims take one off and split at Ts', () => {
  const { p, outer, mid } = plan();
  const t = outer[0].thickness;
  const ti = mid.thickness;
  const top = outer[0]; // 240 long, the interior wall tees into it
  assert.deepEqual(lengths(wallDimLabels(p, 'centre'), top.id), [240]);
  assert.deepEqual(lengths(wallDimLabels(p, 'outside'), top.id), [240 + t]);
  // Inside: two rooms, each 120 less half the exterior and half the interior thickness.
  const room = Math.round((120 - t / 2 - ti / 2) * 100) / 100;
  assert.deepEqual(lengths(wallDimLabels(p, 'inside'), top.id), [room, room]);
  // The short sides have no T: one piece, a full thickness shorter.
  assert.deepEqual(lengths(wallDimLabels(p, 'inside'), outer[1].id), [144 - t]);
  // The interior wall runs face to face across the house, the same both sides: one label.
  assert.deepEqual(lengths(wallDimLabels(p, 'inside'), mid.id), [144 - t]);
  // Outside mode leaves interior walls on their centreline.
  assert.deepEqual(lengths(wallDimLabels(p, 'outside'), mid.id), [144]);
});

test('overall outside corners sit half a thickness outside the centreline box', () => {
  const { p, outer } = plan();
  const h = outer[0].thickness / 2;
  const xs = outerCorners(p).map((q) => q.x);
  const ys = outerCorners(p).map((q) => q.y);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [-h, 240 + h, -h, 144 + h]);
});

test('a free-standing wall measures to its drawn ends; a 45° corner mitres', () => {
  const stub = wall(0, 0, 96, 0, 'interior');
  const p = project([stub]);
  assert.deepEqual(lengths(wallDimLabels(p, 'inside'), stub.id), [96 + stub.thickness]);
  // Two exterior walls at 135° (a 45° bend): faces meet at the mitre, longer outside than in.
  const a = wall(0, 0, 120, 0);
  const b = wall(120, 0, 220, 100);
  const spans = faceSpans(project([a, b])).filter((f) => f.wall.id === a.id);
  const [inner, outerF] = [...spans].sort((x, y) => x.length - y.length);
  const h = a.thickness / 2;
  // At the bend the faces move ±h·tan(22.5°) from the centreline end; the free end adds h.
  assert.ok(Math.abs(inner.length - (120 + h - h * Math.tan(Math.PI / 8))) < 0.01, String(inner.length));
  assert.ok(Math.abs(outerF.length - (120 + h + h * Math.tan(Math.PI / 8))) < 0.01, String(outerF.length));
});
