import { useMemo, useState } from 'react';
import { framingTakeoff, studCount } from '../calc/framing.ts';
import { NOT_CHECKED, ircChecks, type CheckStatus } from '../calc/irc.ts';
import { materialsList, studStock } from '../calc/materials.ts';
import type { Hit } from '../editor/hitTest.ts';
import { downloadBlob, slug } from '../model/persist.ts';
import type { Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { MEMBER_LEGEND, WallElevation } from './WallElevation.tsx';

export function FramingView({ project }: { project: Project }) {
  const t = useMemo(() => framingTakeoff(project), [project]);
  const [picked, setPicked] = useState<string | 'all'>('');
  if (!project.walls.length) return <Empty />;
  const current = picked === 'all' ? t.walls : [t.walls.find((f) => f.wallId === picked) ?? t.walls[0]];
  const labelOf = (id: string) => `W${t.walls.findIndex((f) => f.wallId === id) + 1}`;
  return (
    <div className="report">
      <div className="report-head">
        <h2>Framing</h2>
        <div className="row">
          <select value={picked || t.walls[0].wallId} onChange={(e) => setPicked(e.target.value)} aria-label="Wall to show">
            {t.walls.map((f, i) => (
              <option key={f.wallId} value={f.wallId}>
                W{i + 1} — {f.kind}, {formatFtIn(f.length)}
              </option>
            ))}
            <option value="all">All walls</option>
          </select>
        </div>
      </div>
      <div className="legend">
        {MEMBER_LEGEND.map((l) => (
          <span key={l.kind}>
            <i className={`sw m-${l.kind}`} />
            {l.label}
          </span>
        ))}
      </div>
      {current.map((f) => (
        <div key={f.wallId} className="elevation-wrap">
          <WallElevation f={f} label={labelOf(f.wallId)} />
        </div>
      ))}
      <h3>Takeoff</h3>
      <p className="muted">
        {project.framing.studSpacing}" o.c. · single bottom + double top plate · kings, jacks and doubled headers at openings · 3-stud corners, ladder backing at tees.
        Header sizes are a single-storey rule of thumb — confirm against IRC Table R602.7(1).
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Wall</th>
              <th>Type</th>
              <th>Studs</th>
              <th className="num">Length</th>
              <th className="num">Height</th>
              <th className="num">Common</th>
              <th className="num">Corner/tee</th>
              <th className="num">King</th>
              <th className="num">Jack</th>
              <th className="num">Cripple</th>
              <th className="num">Total</th>
              <th>Headers</th>
            </tr>
          </thead>
          <tbody>
            {t.walls.map((f, i) => (
              <tr key={f.wallId} className={current.length === 1 && current[0].wallId === f.wallId ? 'picked' : undefined} onClick={() => setPicked(f.wallId)}>
                <td>W{i + 1}</td>
                <td>{f.kind}</td>
                <td>
                  {f.studSize} · {studStock(f.studLength)}
                </td>
                <td className="num">{formatFtIn(f.length)}</td>
                <td className="num">{formatFtIn(f.height)}</td>
                <td className="num">{f.common}</td>
                <td className="num">{f.corner}</td>
                <td className="num">{f.king}</td>
                <td className="num">{f.jack}</td>
                <td className="num">{f.cripple}</td>
                <td className="num strong">{studCount(f)}</td>
                <td>{f.headers.map((h) => `${h.plies}-${h.size} × ${formatFtIn(h.length)}`).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={10}>Total studs</td>
              <td className="num strong">{t.totals.studs}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export function MaterialsView({ project }: { project: Project }) {
  const lines = useMemo(() => materialsList(project), [project]);
  if (!project.walls.length) return <Empty />;
  const groups = [...new Set(lines.map((l) => l.category))];
  const csv = () => {
    const esc = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [['Category', 'Item', 'Qty', 'Unit', 'Basis'], ...lines.map((l) => [l.category, l.item, l.qty, l.unit, l.basis])];
    downloadBlob(new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }), `${slug(project.name)}-materials.csv`);
  };
  return (
    <div className="report">
      <div className="report-head">
        <h2>Materials</h2>
        <button onClick={csv}>Download CSV</button>
      </div>
      <p className="muted">Walls, sheathing, drywall, insulation, rough electrical and openings. Floor, roof and foundation systems aren't in the takeoff yet.</p>
      {groups.map((g) => (
        <section key={g}>
          <h3>{g}</h3>
          <div className="table-wrap">
            <table>
              <tbody>
                {lines
                  .filter((l) => l.category === g)
                  .map((l) => (
                    <tr key={l.item}>
                      <td>{l.item}</td>
                      <td className="num strong">{l.qty.toLocaleString()}</td>
                      <td>{l.unit}</td>
                      <td className="muted">{l.basis}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

const STATUS: Record<CheckStatus, { label: string; cls: string }> = {
  fail: { label: 'Fails', cls: 'st-fail' },
  warn: { label: 'Review', cls: 'st-warn' },
  info: { label: 'Note', cls: 'st-info' },
  pass: { label: 'Passes', cls: 'st-pass' },
};

export function CodeView({ project, onSelect }: { project: Project; onSelect(h: Hit): void }) {
  const checks = useMemo(() => ircChecks(project), [project]);
  if (!project.walls.length) return <Empty />;
  const order: CheckStatus[] = ['fail', 'warn', 'info', 'pass'];
  const kindOf = (id?: string): Hit | null => {
    if (!id) return null;
    if (project.rooms.some((r) => r.id === id)) return { kind: 'room', id };
    if (project.openings.some((o) => o.id === id)) return { kind: 'opening', id };
    if (project.walls.some((w) => w.id === id)) return { kind: 'wall', id };
    return null;
  };
  return (
    <div className="report">
      <h2>IRC plan check</h2>
      <p className="muted">
        International Residential Code (2018 / 2021 / 2024 values for these rules). A design aid, not a plan review — your jurisdiction's adopted edition and
        local amendments govern. Window net-clear openings are estimated from size and operation; confirm with the manufacturer.
      </p>
      {!project.rooms.length && <p className="warn-text">Most checks are per room — draw rooms with the Room tool and set each room's use.</p>}
      <div className="summary-chips">
        {order.map((s) => (
          <span key={s} className={`chip ${STATUS[s].cls}`}>
            {checks.filter((c) => c.status === s).length} {STATUS[s].label.toLowerCase()}
          </span>
        ))}
      </div>
      <ul className="checks">
        {order.flatMap((s) =>
          checks
            .filter((c) => c.status === s)
            .map((c, i) => {
              const hit = kindOf(c.targetId);
              return (
                <li key={`${s}${i}`} className={STATUS[s].cls}>
                  <span className="st">{STATUS[s].label}</span>
                  <div>
                    <div>
                      <strong>{c.rule}</strong> <span className="muted">IRC {c.section}</span>
                    </div>
                    <div className="muted">{c.message}</div>
                  </div>
                  {hit && (
                    <button className="link" onClick={() => onSelect(hit)}>
                      Show
                    </button>
                  )}
                </li>
              );
            }),
        )}
      </ul>
      <h3>Not checked yet</h3>
      <ul className="muted not-checked">
        {NOT_CHECKED.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

function Empty() {
  return (
    <div className="report empty">
      <p>Draw some walls on the Plan tab first.</p>
    </div>
  );
}
