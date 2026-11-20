import assert from 'node:assert/strict';
import { test } from 'node:test';
import { framingTakeoff } from '../src/calc/framing.ts';
import { ircChecks } from '../src/calc/irc.ts';
import { materialsList } from '../src/calc/materials.ts';
import { drywallWallArea } from '../src/calc/assemblyTakeoff.ts';
import { wetSummary } from '../src/calc/wetRoom.ts';
import { syncThickness } from '../src/model/store.ts';
import { GLASS_HEIGHT, GLASS_THICKNESS, type Project, type Room, type Wall } from '../src/model/types.ts';
import { box, door, project } from './helpers.ts';
import { wallNormal } from '../src/model/geometry.ts';

// A 10' × 8' bathroom; a 5' wide wet room across its left end, closed off by a glass wall at x = 60.
function bath(wet?: Room['wet']): Project {
  const walls = box(120, 96);
  const h = walls[0].thickness / 2;
  const glass: Wall = { id: 'g', a: { x: 60, y: h }, b: { x: 60, y: 96 - h }, kind: 'interior', glass: true, thickness: GLASS_THICKNESS, height: GLASS_HEIGHT };
  const g = GLASS_THICKNESS / 2;
  const rooms: Room[] = [
    { id: 'B', name: 'Bath', type: 'bath', points: [{ x: h, y: h }, { x: 120 - h, y: h }, { x: 120 - h, y: 96 - h }, { x: h, y: 96 - h }] },
    { id: 'W', name: 'Wet room', type: 'bath', points: [{ x: h, y: h }, { x: 60 - g, y: h }, { x: 60 - g, y: 96 - h }, { x: h, y: 96 - h }], wet },
  ];
  return syncThickness(project([...walls, glass], [], { rooms, outlets: [] }));
}

test('a glass wall is not framed, keeps its thickness and is priced by its glass', () => {
  const p = bath();
  const plain = { ...p, walls: p.walls.filter((w) => !w.glass) };
  assert.equal(framingTakeoff(p).totals.studs, framingTakeoff(plain).totals.studs);
  assert.equal(framingTakeoff(p).walls.length, 4);
  assert.equal(p.walls.find((w) => w.glass)!.thickness, GLASS_THICKNESS);
  const g = p.walls.find((w) => w.glass)!;
  const len = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
  const withDoor = { ...p, openings: [door('g', 40, 28, 76)] };
  const lines = materialsList(withDoor);
  const panel = lines.find((l) => l.item.startsWith('Frameless glass panel'))!;
  assert.equal(panel.qty, Math.ceil((len * GLASS_HEIGHT - 28 * 76) / 144));
  assert.equal(lines.find((l) => l.item.startsWith('Frameless glass shower door'))?.qty, 1);
  // The glass door isn't in the door schedule, and the glass wall takes no drywall.
  assert.ok(!lines.some((l) => l.category === 'Openings' && /^Door /.test(l.item)));
  assert.equal(drywallWallArea(p), drywallWallArea(plain));
});

test('a wet room: tile, membrane, cement board in place of drywall, and its drain', () => {
  const dry = bath();
  const p = bath({ drain: 'linear' });
  const s = wetSummary(p, p.rooms[1]);
  const t = p.walls[0].thickness;
  const wallH = p.walls[0].height;
  // Three framed sides (top, left, bottom) tiled full height; the glass side isn't.
  const lf = (60 - GLASS_THICKNESS / 2 - t / 2) * 2 + (96 - t);
  assert.ok(Math.abs(s.walls - (lf * wallH) / 144) < 0.5, `wall tile ${s.walls}`);
  assert.ok(Math.abs(s.glassEdge - (96 - t)) < 0.01);
  assert.ok(Math.abs(drywallWallArea(dry) - drywallWallArea(p) - s.walls) < 0.5, `drywall comes off behind the tile: ${drywallWallArea(dry)} ${drywallWallArea(p)} ${s.walls}`);
  const lines = materialsList(p);
  for (const item of ['Floor tile (wet room)', 'Wall tile (wet room)', 'Waterproofing membrane (sheet or liquid)', '1/2" cement backer board, 3×5', 'Linear shower drain + trap (allowance)']) {
    assert.ok(lines.some((l) => l.item === item), item);
  }
  const centre = materialsList(bath({ drain: 'centre' }));
  assert.ok(centre.some((l) => l.item.startsWith('Centre floor drain')));
});

test('R307.2: wet-room tile must reach 6 ft', () => {
  const low = ircChecks(bath({ drain: 'linear', tileHeight: 60 })).find((c) => c.rule === 'Wet room finish');
  assert.equal(low?.status, 'fail');
  const high = ircChecks(bath({ drain: 'linear', tileHeight: 84 })).find((c) => c.rule === 'Wet room finish');
  assert.equal(high?.status, 'pass');
  assert.equal(ircChecks(bath({ drain: 'linear' })).find((c) => c.rule === 'Wet room finish')?.status, 'pass');
  assert.ok(ircChecks(bath()).some((c) => c.section === 'R308.4.5'));
});

test('NEC 406.9(C): no receptacle within 3 ft of the wet room', () => {
  const p = bath({ drain: 'linear' });
  const left = p.walls.find((w) => w.a.x === 0 && w.b.x === 0)!;
  const right = p.walls.find((w) => w.a.x === 120 && w.b.x === 120)!;
  // Which side of each wall faces into the bath.
  const inside = (w: Wall): 1 | -1 => {
    const n = wallNormal(w);
    return n.x * (60 - w.a.x) + n.y * (48 - w.a.y) > 0 ? 1 : -1;
  };
  const near = { ...p, outlets: [{ id: 'o1', wallId: left.id, offset: 48, side: inside(left), kind: 'gfci' as const, height: 16, auto: false }] };
  const nearCheck = ircChecks(near).filter((c) => c.section === 'NEC 406.9(C)');
  assert.ok(nearCheck.some((c) => c.status === 'fail' && c.targetId === 'o1'), JSON.stringify(nearCheck));
  const far = { ...p, outlets: [{ id: 'o2', wallId: right.id, offset: 48, side: inside(right), kind: 'gfci' as const, height: 40, auto: false }] };
  const farCheck = ircChecks(far).filter((c) => c.section === 'NEC 406.9(C)');
  assert.ok(farCheck.every((c) => c.status === 'pass'), JSON.stringify(farCheck));
});
