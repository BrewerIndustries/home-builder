import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newCounter } from '../src/calc/counters.ts';
import { kitchenChecks, outlineGap } from '../src/calc/kitchen.ts';
import { projectReducer } from '../src/model/store.ts';
import type { Cutout, Project } from '../src/model/types.ts';
import { box, project } from './helpers.ts';

/** 20' × 14' kitchen, a 16' counter along the top wall and a 6' × 3' island `gap` in front of it. */
function kitchen(cutouts: Cutout[], gap = 48): Project {
  let p = project(box(240, 168), [], {
    rooms: [{ id: 'K', name: 'Kitchen', type: 'kitchen', points: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 168 }, { x: 0, y: 168 }] }],
  });
  const counter = { ...newCounter(p, { x: 24, y: 10 }, { x: 216, y: 10 }, 'c'), cutouts };
  const front = counter.a.y + counter.depth;
  const island = newCounter(p, { x: 84, y: front + gap }, { x: 156, y: front + gap + 36 }, 'i');
  p = projectReducer(projectReducer(p, { type: 'addCounter', counter }), { type: 'addCounter', counter: island });
  return p;
}

const find = (p: Project, rule: string) => kitchenChecks(p).find((c) => c.rule.startsWith(rule))!;

test('a work triangle with legs in range passes; one stretched too far warns', () => {
  const k = (kind: Cutout['kind'], offset: number, width = 30): Cutout => ({ id: kind, kind, offset, width });
  const far = kitchen([k('fridge', 18, 36), k('sink', 96, 33), k('range', 168)]);
  assert.equal(find(far, 'Work triangle').status, 'warn'); // all on one wall: fridge–range 12.5 ft > 9 ft
  const ok = kitchen([k('fridge', 36, 36), k('sink', 96, 33), k('range', 144)]);
  const t = find(ok, 'Work triangle');
  assert.equal(t.status, 'pass', t.message);
  const none = kitchen([k('sink', 96, 33)]);
  assert.equal(find(none, 'Work triangle').status, 'info');
});

test('an island 48" off the counter passes; 36" warns the work aisle', () => {
  assert.equal(find(kitchen([], 48), 'Clearance').status, 'pass');
  const tight = find(kitchen([], 36), 'Clearance');
  assert.equal(tight.status, 'warn');
  assert.match(tight.message, /3' 0"/);
});

test('outline gap between two rectangles', () => {
  const sq = (x: number, y: number) => [{ x, y }, { x: x + 10, y }, { x: x + 10, y: y + 10 }, { x, y: y + 10 }];
  assert.equal(outlineGap(sq(0, 0), sq(15, 0)), 5);
  assert.equal(outlineGap(sq(0, 0), sq(13, 14)), 5);
});
