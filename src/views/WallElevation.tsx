import type { MemberKind, WallFraming } from '../calc/framing.ts';
import { formatFtIn } from '../model/units.ts';

// Framing elevation of one wall, viewed from the side the wall's normal points to.
// Drawn in inches with y flipped so the floor is at the bottom.

const FILL: Record<MemberKind, string> = {
  plate: 'var(--m-plate)',
  common: 'var(--m-stud)',
  corner: 'var(--m-corner)',
  king: 'var(--m-king)',
  jack: 'var(--m-jack)',
  cripple: 'var(--m-cripple)',
  header: 'var(--m-header)',
  sill: 'var(--m-plate)',
};

export const MEMBER_LEGEND: { kind: MemberKind; label: string }[] = [
  { kind: 'common', label: 'Common stud' },
  { kind: 'corner', label: 'Corner / tee backer' },
  { kind: 'king', label: 'King' },
  { kind: 'jack', label: 'Jack' },
  { kind: 'cripple', label: 'Cripple' },
  { kind: 'header', label: 'Header' },
  { kind: 'plate', label: 'Plate / sill' },
];

export function WallElevation({ f, label }: { f: WallFraming; label: string }) {
  const pad = { l: 14, r: 14, t: 26, b: 40 };
  const W = f.length + pad.l + pad.r;
  const H = f.height + pad.t + pad.b;
  const Y = (y: number) => pad.t + f.height - y; // floor at the bottom
  const X = (x: number) => pad.l + x;
  const commons = f.members.filter((m) => m.kind === 'common').map((m) => m.x + m.w / 2);
  const font = Math.max(4, Math.min(7, f.length / 60));

  return (
    <svg className="elevation" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Framing elevation of wall ${label}`}>
      {f.members.map((m, i) => (
        <rect key={i} x={X(m.x)} y={Y(m.y + m.h)} width={m.w} height={m.h} fill={FILL[m.kind]} className="member" />
      ))}
      {f.openings.map((o) => (
        <g key={o.id}>
          <rect x={X(o.x)} y={Y(o.y + o.h)} width={o.w} height={o.h} className="ro" />
          <text x={X(o.x + o.w / 2)} y={Y(o.y + o.h / 2)} fontSize={font} textAnchor="middle" className="ro-label">
            {o.kind === 'door' ? 'Door' : 'Window'} RO
          </text>
          <text x={X(o.x + o.w / 2)} y={Y(o.y + o.h / 2) + font * 1.3} fontSize={font * 0.9} textAnchor="middle" className="ro-label">
            {formatFtIn(o.w)} × {formatFtIn(o.h)}
          </text>
        </g>
      ))}
      {f.members
        .filter((m) => m.kind === 'header')
        .map((m, i) => (
          <text key={`h${i}`} x={X(m.x + m.w / 2)} y={Y(m.y + m.h / 2)} fontSize={font * 0.85} textAnchor="middle" dominantBaseline="central" className="header-label">
            {f.headers[i].plies}-{f.headers[i].size}
          </text>
        ))}

      {/* Layout marks: stud centres measured from the start of the wall. */}
      {commons.map((x, i) => (
        <g key={i}>
          <line x1={X(x)} x2={X(x)} y1={Y(0) + 3} y2={Y(0) + 8} className="tick" />
          {(i % 2 === 0 || f.length < 200) && (
            <text x={X(x)} y={Y(0) + 8 + font} fontSize={font * 0.8} textAnchor="middle" className="dim-text">
              {Math.round(x * 8) / 8}
            </text>
          )}
        </g>
      ))}
      <line x1={X(0)} x2={X(f.length)} y1={Y(0) + 26} y2={Y(0) + 26} className="dim-line" />
      <line x1={X(0)} x2={X(0)} y1={Y(0) + 22} y2={Y(0) + 30} className="dim-line" />
      <line x1={X(f.length)} x2={X(f.length)} y1={Y(0) + 22} y2={Y(0) + 30} className="dim-line" />
      <text x={X(f.length / 2)} y={Y(0) + 24} fontSize={font} textAnchor="middle" className="dim-text">
        {formatFtIn(f.length)}
      </text>
      <text x={X(0)} y={pad.t - 10} fontSize={font * 1.2} className="elev-title">
        {label} · {f.kind} · {f.studSize} @ {formatFtIn(f.height)} · studs cut {formatFtIn(f.studLength)}
      </text>
    </svg>
  );
}
