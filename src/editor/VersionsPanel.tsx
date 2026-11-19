import { useMemo, useState } from 'react';
import { changeOrder, diffPlans, type ChangeOrder, type PlanChange } from '../calc/planDiff.ts';
import { money } from '../calc/pricing.ts';
import { changeOrderHtml, KIND_LABEL, signed } from '../calc/changeOrderHtml.ts';
import type { Project } from '../model/types.ts';
import { CURRENT, deleteVersion, nextVersionName, renameVersion, restoreVersion, saveVersion, versionBytes, versionProject } from '../model/versions.ts';

// Plan versions: save named snapshots, compare any two (what was added, removed
// and changed, and the estimate difference as a printable change order), and
// restore one (a single undo step).

const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function VersionsPanel({ project, replace }: { project: Project; replace(p: Project): void }) {
  const versions = project.versions ?? [];
  const [name, setName] = useState('');
  const [from, setFrom] = useState<string>(versions.at(-1)?.id ?? CURRENT);
  const [to, setTo] = useState<string>(CURRENT);
  const label = (id: string) => (id === CURRENT ? 'Current plan' : (versions.find((v) => v.id === id)?.name ?? '—'));
  const cmp = useMemo(() => {
    const [a, b] = [versionProject(project, from), versionProject(project, to)];
    if (!a || !b || from === to) return null;
    return { changes: diffPlans(a, b), co: changeOrder(a, b, project.pricing) };
  }, [project, from, to]);

  return (
    <>
      <section className="lib">
        <h3>Versions</h3>
        <p className="muted small">A version is a dated snapshot of the plan, saved with the project (without the traced floorplan image). Compare two to get a change order; restore one to put the plan back (undo takes it back again).</p>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={nextVersionName(project)} aria-label="Version name" />
          <button
            className="primary"
            onClick={() => {
              const next = saveVersion(project, name);
              replace(next);
              setFrom(next.versions!.at(-1)!.id);
              setTo(CURRENT);
              setName('');
            }}
          >
            Save version
          </button>
        </div>
        {versions.length > 0 && (
          <ul className="lib-list">
            {[...versions].reverse().map((v) => (
              <li key={v.id}>
                <input
                  key={v.name}
                  defaultValue={v.name}
                  aria-label="Version name"
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== v.name && replace(renameVersion(project, v.id, e.target.value))}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                <span className="muted small">
                  {when(v.at)}
                  {v.option ? ` · ${v.option}` : ''} · {Math.max(1, Math.round(versionBytes(v) / 1024))} KB
                </span>
                <span style={{ flex: 1 }} />
                <button onClick={() => confirm(`Put the plan back as it was in "${v.name}"? (Undo reverses it.)`) && replace(restoreVersion(project, v.id))}>Restore</button>
                <button
                  className="link"
                  onClick={() => {
                    if (!confirm(`Delete version "${v.name}"?`)) return;
                    replace(deleteVersion(project, v.id));
                    if (from === v.id) setFrom(CURRENT);
                    if (to === v.id) setTo(CURRENT);
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {versions.length > 0 && (
        <section className="lib">
          <h3>Compare</h3>
          <div className="row">
            <VersionSelect value={from} onChange={setFrom} project={project} label="From" />
            <span>→</span>
            <VersionSelect value={to} onChange={setTo} project={project} label="To" />
            <span style={{ flex: 1 }} />
            {cmp && (
              <button onClick={() => printChangeOrder(project.name, label(from), label(to), cmp.changes, cmp.co)} title="Open the change order as a printable page">
                Print change order
              </button>
            )}
          </div>
          {!cmp ? (
            <p className="muted small">Pick two different plans.</p>
          ) : (
            <>
              <Changes changes={cmp.changes} />
              <CoTable co={cmp.co} />
            </>
          )}
        </section>
      )}
    </>
  );
}

function VersionSelect({ value, onChange, project, label }: { value: string; onChange(v: string): void; project: Project; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value={CURRENT}>Current plan</option>
      {(project.versions ?? []).map((v) => (
        <option key={v.id} value={v.id}>
          {v.name} ({when(v.at)})
        </option>
      ))}
    </select>
  );
}

function Changes({ changes }: { changes: PlanChange[] }) {
  if (!changes.length) return <p className="muted small">No changes to the plan.</p>;
  return (
    <>
      {(['added', 'removed', 'changed'] as const).map((k) => {
        const list = changes.filter((c) => c.kind === k);
        return list.length ? (
          <div key={k}>
            <strong className="small">
              {KIND_LABEL[k]} ({list.length})
            </strong>
            <ul className="changes">
              {list.map((c) => (
                <li key={`${c.kind}${c.id}`}>{c.text}</li>
              ))}
            </ul>
          </div>
        ) : null;
      })}
    </>
  );
}

function CoTable({ co }: { co: ChangeOrder }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Change order</th>
            <th className="num">Was</th>
            <th className="num">Now</th>
            <th className="num">Unit price</th>
            <th className="num">Change</th>
          </tr>
        </thead>
        <tbody>
          {co.lines.map((l) => (
            <tr key={`${l.category}|${l.item}`}>
              <td>
                {l.item} <span className="muted small">{l.category}</span>
              </td>
              <td className="num">
                {l.before} {l.unit}
              </td>
              <td className="num">
                {l.after} {l.unit}
              </td>
              <td className="num">{money(l.unitPrice)}</td>
              <td className={`num ${l.delta > 0 ? 'up' : l.delta < 0 ? 'down' : ''}`}>{signed(l.delta)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={4}>Materials</td>
            <td className="num">{signed(co.subtotal)}</td>
          </tr>
          <tr>
            <td colSpan={4}>Tax + markup</td>
            <td className="num">{signed(co.tax + co.markup)}</td>
          </tr>
          <tr className="total">
            <td colSpan={4}>
              Change order total <span className="muted small">({money(co.before.total)} → {money(co.after.total)})</span>
            </td>
            <td className="num">{signed(co.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function printChangeOrder(project: string, from: string, to: string, changes: PlanChange[], co: ChangeOrder) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(changeOrderHtml(project, from, to, changes, co));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}
