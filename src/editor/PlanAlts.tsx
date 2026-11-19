import { useMemo, useState, type Dispatch } from 'react';
import { compareOptions } from '../calc/optionCompare.ts';
import { money } from '../calc/pricing.ts';
import { addOption, deleteOption, optionsOf, renameOption, switchOption } from '../model/options.ts';
import { phaseCounts, phaseOf, planElementIds, setPhase } from '../model/phase.ts';
import type { Action } from '../model/store.ts';
import type { Project } from '../model/types.ts';
import { Modal } from '../ui/Modal.tsx';
import './phasing.css';

// Design options ("Option A" / "Plan B"): switch between alternates of the plan,
// copy the current one, and compare their estimates side by side. Also the
// whole-plan remodel phase shortcuts.

export function PlanAltsDialog({ project, dispatch, onClose }: { project: Project; dispatch: Dispatch<Action>; onClose(): void }) {
  const replace = (next: Project) => dispatch({ type: 'replaceProject', project: next });
  return (
    <Modal title="Design options" onClose={onClose}>
      <div className="plan-alt">
        <OptionsPanel project={project} replace={replace} />
        <PhasesPanel project={project} replace={replace} />
      </div>
    </Modal>
  );
}

function OptionsPanel({ project, replace }: { project: Project; replace(p: Project): void }) {
  const opts = optionsOf(project);
  const [name, setName] = useState('');
  const cmp = useMemo(() => compareOptions(project), [project]);
  const active = cmp.options.find((o) => o.active)!;
  const delta = (n: number, base: number) => {
    const d = Math.round((n - base) * 100) / 100;
    if (!d) return null;
    return <div className={`small ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? '+' : '−'}{money(Math.abs(d))}</div>;
  };
  return (
    <section className="lib">
      <h3>Options</h3>
      <p className="muted small">
        Each option is a full copy of the plan that you can change on its own. The plan editor always shows the active option; all of them save with the project and share its price list.
      </p>
      <ul className="lib-list">
        {opts.list.map((o) => {
          const isActive = o.id === opts.active;
          return (
            <li key={o.id} className={isActive ? 'open' : undefined}>
              <input
                key={o.name}
                defaultValue={o.name}
                aria-label="Option name"
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== o.name && replace(renameOption(project, o.id, e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <span className="muted small">{isActive ? 'active — shown in the editor' : ''}</span>
              <span style={{ flex: 1 }} />
              {!isActive && <button onClick={() => replace(switchOption(project, o.id))}>Switch to</button>}
              {!isActive && (
                <button className="link" onClick={() => confirm(`Delete ${o.name}? Its plan is discarded (undo brings it back).`) && replace(deleteOption(project, o.id))}>
                  Delete
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New option name (optional)" aria-label="New option name" />
        <button
          className="primary"
          onClick={() => {
            replace(addOption(project, name));
            setName('');
          }}
          title="Copy the active plan into a new option and switch to it"
        >
          Copy as new option
        </button>
      </div>

      {cmp.options.length > 1 && (
        <>
          <h3>Cost compare</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  {cmp.options.map((o) => (
                    <th key={o.id} className="num">
                      {o.name}
                      {o.active ? ' ●' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cmp.categories.map((c) => (
                  <tr key={c}>
                    <td>{c}</td>
                    {cmp.options.map((o) => (
                      <td key={o.id} className="num">
                        {money(o.byCategory[c] ?? 0)}
                        {!o.active && delta(o.byCategory[c] ?? 0, active.byCategory[c] ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td>Materials subtotal</td>
                  {cmp.options.map((o) => (
                    <td key={o.id} className="num">
                      {money(o.est.subtotal)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Tax + markup</td>
                  {cmp.options.map((o) => (
                    <td key={o.id} className="num">
                      {money(o.est.tax + o.est.markup)}
                    </td>
                  ))}
                </tr>
                <tr className="total">
                  <td>Total</td>
                  {cmp.options.map((o) => (
                    <td key={o.id} className="num">
                      {money(o.est.total)}
                      {!o.active && delta(o.est.total, active.est.total)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">● the active option. Differences are against it. Each estimate counts new work and demolition only, like the Estimate tab.</p>
        </>
      )}
    </section>
  );
}

function PhasesPanel({ project, replace }: { project: Project; replace(p: Project): void }) {
  const ids = planElementIds(project);
  const c = phaseCounts(project);
  return (
    <section className="lib">
      <h3>Remodel phases</h3>
      <p className="muted small">
        Pick an item on the plan and mark it Existing, Demolish or New from the toolbar. Existing items draw grey and aren't priced; demolition draws dashed and adds a demolition allowance to the estimate.
      </p>
      <div className="row">
        <span className="small">
          {c.existing} existing · {c.demo} demolish · {c.new} new
        </span>
        <span style={{ flex: 1 }} />
        <button disabled={!c.new} onClick={() => replace(setPhase(project, ids.filter((id) => phaseOf(project, id) === 'new'), 'existing'))} title="Start a remodel: draw the house as it stands, mark it all existing, then draw the new work">
          Mark everything existing
        </button>
        <button disabled={!c.existing && !c.demo} onClick={() => confirm('Make every item new work again?') && replace(setPhase(project, ids, 'new'))}>
          Clear phases
        </button>
      </div>
    </section>
  );
}
