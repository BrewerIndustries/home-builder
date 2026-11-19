import type { LumberSize, Opening } from '../model/types.ts';
import type { Member, WallFraming } from './framing.ts';
import type { MaterialLine } from './materials.ts';

// Barn door blocking. The track runs twice the door width on the wall face and
// is bolted into framing along its length: over the door the header takes the
// bolts; over the slide, where there are only studs, a continuous row of solid
// blocking does, laid flat at the header's height (wide face to the drywall).
// An estimating aid: the track kit's instructions set the real mounting height.

/**
 * The blocking over a barn door's slide, in wall elevation (x from wall.a, y up),
 * or null when the slide is off the wall or covered by the header. `header` is
 * where the door's header runs along the wall.
 */
export function barnBlocking(o: Opening, wallLength: number, y: number, depth: number, header: [number, number], plateUnderside: number): Member | null {
  if (o.kind !== 'door' || o.operation !== 'barn') return null;
  const towardA = (o.swing?.hinge ?? 'a') === 'a';
  const jamb = towardA ? o.offset - o.width / 2 : o.offset + o.width / 2;
  const [from, to] = towardA ? [Math.max(0, jamb - o.width), header[0]] : [header[1], Math.min(wallLength, jamb + o.width)];
  if (to - from < 1) return null;
  const h = Math.min(depth, plateUnderside - 1);
  return { kind: 'blocking', x: from, y: Math.min(y, plateUnderside - h), w: to - from, h };
}

/** Linear feet of barn door blocking, by the stock it's cut from (the wall's studs). */
export function blockingLines(walls: WallFraming[]): MaterialLine[] {
  const bySize = new Map<LumberSize, { len: number; n: number }>();
  for (const f of walls) {
    for (const m of f.members) {
      if (m.kind !== 'blocking') continue;
      const t = bySize.get(f.studSize) ?? { len: 0, n: 0 };
      t.len += m.w;
      t.n += 1;
      bySize.set(f.studSize, t);
    }
  }
  return [...bySize].map(([size, t]): MaterialLine => ({
    category: 'Lumber',
    item: `Barn door track blocking, ${size}`,
    qty: Math.ceil(t.len / 12),
    unit: 'lf',
    basis: `solid blocking between the studs over ${t.n} barn door slide${t.n === 1 ? '' : 's'}, at header height, rounded up to whole feet`,
  }));
}
