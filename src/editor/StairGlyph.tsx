import { flightSides, stairSegments, type Rect } from '../calc/stairShape.ts';
import type { Furniture } from '../model/types.ts';

// Lighting v6 plan symbols, in the item's own frame (FurnitureGlyph rotates them):
// an L or U stair — each flight with its treads, the landing, handrails, and the
// walk line from the foot with an arrow at the top — and an attic access hatch.

export function TurningStairGlyph({ f, px }: { f: Furniture; px(n: number): number }) {
  const sw = px(1);
  const segs = stairSegments(f);
  const box = (r: Rect, key: string) => <rect key={key} x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} strokeWidth={sw} />;
  const sides = { none: [], left: ['left'], right: ['right'], both: ['left', 'right'] } as const;
  const rails = sides[f.handrails ?? 'right'];
  const walk = [segs[0].from, ...segs.map((s) => (s.kind === 'landing' ? { x: (s.rect.x0 + s.rect.x1) / 2, y: (s.rect.y0 + s.rect.y1) / 2 } : s.to))];
  const end = segs[segs.length - 1];
  const tip = end.to;
  const back = { x: tip.x - end.dir.x * 6, y: tip.y - end.dir.y * 6 };
  const across = { x: end.dir.y * 4, y: -end.dir.x * 4 };
  return (
    <>
      {segs.map((s, i) => {
        if (s.kind === 'landing') {
          return (
            <g key={i}>
              {box(s.rect, 'r')}
              <text x={(s.rect.x0 + s.rect.x1) / 2} y={(s.rect.y0 + s.rect.y1) / 2 + 6} fontSize={Math.min(6, (s.rect.x1 - s.rect.x0) / 6)} textAnchor="middle" dominantBaseline="central" className="stair-label">
                LDG
              </text>
            </g>
          );
        }
        const n = Math.max(1, s.risers - 1);
        const tread = s.len / n;
        const half = s.dir.x === 0 ? (s.rect.x1 - s.rect.x0) / 2 : (s.rect.y1 - s.rect.y0) / 2;
        const nrm = { x: s.dir.y, y: -s.dir.x };
        const { left, right } = flightSides(s);
        const inset = (pts: [{ x: number; y: number }, { x: number; y: number }], k: number) => pts.map((p) => ({ x: p.x - nrm.x * 2 * k, y: p.y - nrm.y * 2 * k }));
        return (
          <g key={i}>
            {box(s.rect, 'r')}
            {Array.from({ length: n - 1 }, (_, k) => {
              const c = { x: s.from.x + s.dir.x * tread * (k + 1), y: s.from.y + s.dir.y * tread * (k + 1) };
              return <line key={k} x1={c.x + nrm.x * half} y1={c.y + nrm.y * half} x2={c.x - nrm.x * half} y2={c.y - nrm.y * half} strokeWidth={sw} />;
            })}
            {s.risers >= 4 &&
              rails.map((side) => {
                const [a, b] = inset(side === 'left' ? left : right, side === 'left' ? 1 : -1);
                return <line key={side} className="stair-rail" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={px(1.5)} />;
              })}
          </g>
        );
      })}
      <polyline points={walk.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" strokeWidth={sw} />
      <polyline points={`${back.x + across.x},${back.y + across.y} ${tip.x},${tip.y} ${back.x - across.x},${back.y - across.y}`} fill="none" strokeWidth={sw} />
      <text x={segs[0].from.x} y={segs[0].from.y - 8} fontSize={Math.min(8, (segs[0].rect.x1 - segs[0].rect.x0) / 4)} textAnchor="middle" dominantBaseline="central" className="stair-label">
        {f.down ? 'DN' : 'UP'}
      </text>
    </>
  );
}

/** A ceiling hatch: dashed (it's overhead), crossed, labelled. */
export function AtticHatchGlyph({ f, px }: { f: Furniture; px(n: number): number }) {
  const [l, t, r, b] = [-f.w / 2, -f.d / 2, f.w / 2, f.d / 2];
  const sw = px(1);
  return (
    <>
      <rect x={l} y={t} width={f.w} height={f.d} strokeWidth={sw} strokeDasharray={`${px(4)} ${px(3)}`} fill="none" />
      <line x1={l} y1={t} x2={r} y2={b} strokeWidth={sw} strokeDasharray={`${px(4)} ${px(3)}`} />
      <line x1={r} y1={t} x2={l} y2={b} strokeWidth={sw} strokeDasharray={`${px(4)} ${px(3)}`} />
      <text x={0} y={0} fontSize={Math.min(6, f.w / 5)} textAnchor="middle" dominantBaseline="central" className="stair-label">
        ATTIC
      </text>
    </>
  );
}
