import { useEffect, useMemo, useState, type Dispatch } from 'react';
import { createPortal } from 'react-dom';
import { cutListCsv, fullCutList, KEEP_OFFCUT, keptOffcuts, type CutListGroup, type KeptOffcut } from '../calc/cutlist.ts';
import { downloadBlob, slug } from '../model/persist.ts';
import type { Action } from '../model/store.ts';
import type { Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';

// The Framing tab's cut list: walls, roof and floor groups packed onto stock,
// the offcuts worth keeping as blocking stock, CSV, and a printable cut sheet
// (a print-only page portaled next to #root; see .cut-sheet in styles.css).

const ft = (n: number) => `${n / 12}'`;
const key = (g: CutListGroup) => `${g.section}|${g.size}`;

/** Plates, jacks, cripples, sills, header plies, roof and floor members packed onto stock lengths, with the waste. */
export function CutList({ project, dispatch }: { project: Project; dispatch: Dispatch<Action> }) {
  const groups = useMemo(() => fullCutList(project), [project]);
  const kept = useMemo(() => keptOffcuts(groups), [groups]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const done = () => document.body.classList.remove('print-cut-sheet');
    window.addEventListener('afterprint', done);
    return () => window.removeEventListener('afterprint', done);
  }, []);
  if (!groups.length) return null;
  const csv = () => downloadBlob(new Blob([cutListCsv(groups, formatFtIn)], { type: 'text/csv' }), `${slug(project.name || 'plan')}-cut-list.csv`);
  const print = () => {
    document.body.classList.add('print-cut-sheet');
    window.print();
  };
  const sections = [...new Set(groups.map((g) => g.section))];
  return (
    <section className="cut-list">
      <div className="report-head">
        <h3>Cut list</h3>
        <div className="row">
          <button onClick={print}>Print cut sheet</button>
          <button onClick={csv}>Download CSV</button>
        </div>
      </div>
      <p className="muted">
        Plates, jacks, cripples, flat sills and header plies — plus roof members (rafters, ridge, hips, ceiling joists, fascia) and a framed floor's rim and blocking —
        packed onto 8'–16' stock (first-fit, 1/8" kerf per cut), each board then cut down to the shortest length that holds it. Runs over 16' are split; plate
        joints land on full-height studs, the top plate's at least 24" from the cap plate's (R602.3.2). Full-height studs, floor joists and trusses are bought at
        length and LVL by length, so they aren't here.
      </p>
      <label className="link-row">
        <input
          type="checkbox"
          checked={!!project.framing.cutListEstimate}
          onChange={(e) => dispatch({ type: 'setFraming', patch: { cutListEstimate: e.target.checked || undefined } })}
        />{' '}
        Price the wall boards in the Estimate (instead of plate and header LF plus the waste factor; roof and floor members keep their own lines)
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Size</th>
              <th>Boards to buy</th>
              <th className="num">Pieces</th>
              <th className="num">Stock</th>
              <th className="num">Cut</th>
              <th className="num">Waste</th>
              <th className="num">Offcuts ≥ {KEEP_OFFCUT}"</th>
            </tr>
          </thead>
          {sections.map((s) => (
            <tbody key={s}>
              {sections.length > 1 && (
                <tr className="section-row">
                  <th colSpan={7}>{s}</th>
                </tr>
              )}
              {groups
                .filter((g) => g.section === s)
                .map((g) => (
                  <tr key={key(g)} className={open === key(g) ? 'picked' : undefined} onClick={() => setOpen(open === key(g) ? null : key(g))}>
                    <td>{g.size}</td>
                    <td>{g.byStock.map((b) => `${b.n} × ${ft(b.stock)}`).join(', ')}</td>
                    <td className="num">{g.pieces}</td>
                    <td className="num">{Math.round(g.stockLength / 12)} LF</td>
                    <td className="num">{Math.round(g.usedLength / 12)} LF</td>
                    <td className="num strong">{g.wastePct.toFixed(1)}%</td>
                    <td className="num">{g.keep}</td>
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
      {groups
        .filter((g) => key(g) === open)
        .map((g) => (
          <ol key={key(g)} className="boards">
            {g.boards.map((b, i) => (
              <li key={i}>
                <div className="board" title={`${g.size} × ${ft(b.stock)}`}>
                  {b.cuts.map((c, k) => (
                    <span key={k} className="cut" style={{ flexGrow: c.length }} title={`${c.label}: ${formatFtIn(c.length)}`}>
                      {formatFtIn(c.length)}
                    </span>
                  ))}
                  <span className="offcut" style={{ flexGrow: Math.max(0, b.offcut) }} />
                </div>
                <span className="muted">
                  {ft(b.stock)} — {b.cuts.map((c) => c.label).join(', ')}; {formatFtIn(b.offcut)} left
                </span>
              </li>
            ))}
          </ol>
        ))}
      {!open && <p className="muted">Click a size to see each board's cuts.</p>}
      <KeptOffcuts kept={kept} />
      {createPortal(<CutSheet project={project} groups={groups} kept={kept} />, document.body)}
    </section>
  );
}

/** Offcuts worth keeping, summarised by size: blocking / fire-stop stock. */
function KeptOffcuts({ kept }: { kept: KeptOffcut[] }) {
  if (!kept.length) return null;
  const bySize = new Map<string, KeptOffcut[]>();
  for (const k of kept) bySize.set(k.size, [...(bySize.get(k.size) ?? []), k]);
  return (
    <>
      <h4>Blocking stock from offcuts</h4>
      <p className="muted">
        Offcuts of {KEEP_OFFCUT}" or more — set them aside for blocking, fire-stops and backing before buying more.
      </p>
      <ul className="kept-offcuts">
        {[...bySize.entries()].map(([size, list]) => (
          <li key={size}>
            <strong>{size}</strong> × {list.length}: {list.map((k) => formatFtIn(k.length)).join(', ')} ({Math.round(list.reduce((t, k) => t + k.length, 0) / 12)} LF)
          </li>
        ))}
      </ul>
    </>
  );
}

/** Print-only cut sheet: every board with its cuts, in order, and the kept offcuts. */
function CutSheet({ project, groups, kept }: { project: Project; groups: CutListGroup[]; kept: KeptOffcut[] }) {
  return (
    <div className="print-only cut-sheet">
      <div className="tb-name">{project.name || 'Plan'} — cut sheet</div>
      <div className="tb-note">
        {new Date().toLocaleDateString()} · stock 8'–16' (20' where a piece needs it) · 1/8" kerf per cut · plate joints on stud centres, top plate ≥ 24" from the cap plate's joints
      </div>
      <table className="schedule">
        <thead>
          <tr>
            <th>✓</th>
            <th>Section</th>
            <th>Size</th>
            <th>Board</th>
            <th>Stock</th>
            <th>Cuts (label — length)</th>
            <th>Offcut</th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((g) =>
            g.boards.map((b, i) => (
              <tr key={`${key(g)}|${i}`}>
                <td>☐</td>
                <td>{g.section}</td>
                <td>{g.size}</td>
                <td>{i + 1}</td>
                <td>{ft(b.stock)}</td>
                <td>{b.cuts.map((c) => `${c.label} — ${formatFtIn(c.length)}`).join(' · ')}</td>
                <td>
                  {formatFtIn(b.offcut)}
                  {b.offcut >= KEEP_OFFCUT ? ' (keep)' : ''}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
      <table className="schedule">
        <thead>
          <tr>
            <th>Section</th>
            <th>Size</th>
            <th>Buy</th>
            <th>Pieces</th>
            <th>Waste</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={key(g)}>
              <td>{g.section}</td>
              <td>{g.size}</td>
              <td>{g.byStock.map((s) => `${s.n} × ${ft(s.stock)}`).join(', ')}</td>
              <td>{g.pieces}</td>
              <td>{g.wastePct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {kept.length > 0 && (
        <div className="tb-note">
          Keep for blocking: {kept.map((k) => `${k.size} ${formatFtIn(k.length)}`).join(', ')}
        </div>
      )}
    </div>
  );
}
