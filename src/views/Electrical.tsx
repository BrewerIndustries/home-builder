import { useMemo, type Dispatch } from 'react';
import { BREAKERS, circuits } from '../calc/circuits.ts';
import { loadCalc, panelSchedule, type LoadMethod } from '../calc/loadCalc.ts';
import type { Action } from '../model/store.ts';
import type { CircuitSetting, Project } from '../model/types.ts';

// The Electrical tab: branch circuits as a printable panel schedule, and the
// NEC 220 dwelling load calculation with a service size (see calc/loadCalc.ts).

const va = (n: number) => Math.round(n).toLocaleString();

export function ElectricalView({ project, dispatch }: { project: Project; dispatch: Dispatch<Action> }) {
  const cs = useMemo(() => circuits(project), [project]);
  const method: LoadMethod = project.electrical?.loadMethod ?? 'standard';
  const calc = useMemo(() => loadCalc(project, method, cs), [project, method, cs]);
  const other = useMemo(() => loadCalc(project, method === 'standard' ? 'optional' : 'standard', cs), [project, method, cs]);
  const panel = useMemo(() => panelSchedule(cs), [cs]);
  if (!project.walls.length) {
    return (
      <div className="report empty">
        <p>Draw some walls on the Plan tab first.</p>
      </div>
    );
  }
  const sets = project.electrical?.circuits ?? {};
  const setCircuit = (key: string, patch: Partial<CircuitSetting>) => {
    const next = { ...(sets[key] ?? {}), ...patch };
    for (const k of Object.keys(next) as (keyof CircuitSetting)[]) if (next[k] === undefined) delete next[k];
    const circuits = { ...sets, [key]: next };
    if (!Object.keys(next).length) delete circuits[key];
    dispatch({ type: 'setElectrical', patch: { circuits } });
  };
  const imbalance = Math.abs(panel.phaseA - panel.phaseB);
  return (
    <div className="report">
      <div className="report-head">
        <h2>Electrical — load calculation &amp; panel schedule</h2>
        <div className="row">
          <select value={method} onChange={(e) => dispatch({ type: 'setElectrical', patch: { loadMethod: e.target.value === 'standard' ? undefined : (e.target.value as LoadMethod) } })} aria-label="Load calculation method">
            <option value="standard">Standard method</option>
            <option value="optional">Optional method (220.82)</option>
          </select>
        </div>
      </div>
      <p className="muted">
        NEC Article 220 (2020 numbering; IRC Chapter 36 follows the same method) from the rooms, receptacles, lights and appliances on the plan. Appliance loads are the
        nameplate you type on each appliance (select it on the Plan tab); until then a typical figure stands in, marked *. Ranges and wall ovens are taken at nameplate —
        the Table 220.55 demand isn't applied. A design aid: the electrician's calculation governs.
      </p>
      <label className="link-row">
        A/C or heat-pump nameplate{' '}
        <input
          key={project.electrical?.coolingVA ?? ''}
          className="price"
          inputMode="numeric"
          defaultValue={project.electrical?.coolingVA ?? ''}
          placeholder="none"
          aria-label="Cooling load in VA"
          onBlur={(e) => {
            const n = Number(e.target.value);
            dispatch({ type: 'setElectrical', patch: { coolingVA: e.target.value.trim() === '' || !Number.isFinite(n) || n <= 0 ? undefined : Math.round(n) } });
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />{' '}
        VA <span className="muted">— weighed against the heating load; adds a 2-pole condenser circuit</span>
      </label>

      <section>
        <h3>Service load ({method === 'standard' ? 'standard method' : 'optional method'})</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Load</th>
                <th className="num">Connected VA</th>
                <th className="num">Demand VA</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              {calc.lines.map((l, i) => (
                <tr key={i} className="no-pick">
                  <td>{l.label}</td>
                  <td className="num">{va(l.va)}</td>
                  <td className="num strong">{l.demand ? va(l.demand) : '—'}</td>
                  <td className="muted">{l.note}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Calculated load</td>
                <td className="num strong">{va(calc.total)}</td>
                <td>
                  ÷ 240 V = <strong>{calc.amps.toFixed(1)} A</strong> → <strong>{calc.service} A service</strong> recommended
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted small">
          The {other.method} method gives {va(other.total)} VA ({other.amps.toFixed(1)} A → {other.service} A); either is allowed. Service ratings are rounded up to
          the next common size, never under 100 A (230.79(C)).
          {calc.typical.length > 0 && ` * Typical load, not nameplate: ${calc.typical.map((a) => a.label.toLowerCase()).join(', ')}.`}
        </p>
      </section>

      <section className="panel-schedule">
        <h3>
          Panel schedule <span className="muted">{cs.length} circuits · {panel.spaces} spaces</span>
        </h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num">Ckt</th>
                <th>Description</th>
                <th className="num">Breaker</th>
                <th className="num">Poles</th>
                <th>AFCI</th>
                <th>GFCI</th>
                <th className="num">Load VA</th>
                <th className="num">Leg A</th>
                <th className="num">Leg B</th>
              </tr>
            </thead>
            <tbody>
              {panel.slots.map(({ numbers, circuit: c, a, b }) => (
                <tr key={c.key} className="no-pick">
                  <td className="num">{numbers.join('/')}</td>
                  <td>
                    <input
                      key={c.label}
                      style={{ width: "100%", minWidth: "14em" }}
                      defaultValue={c.label}
                      aria-label={`Description for circuit ${numbers.join('/')}`}
                      onBlur={(e) => setCircuit(c.key, { label: e.target.value.trim() && e.target.value.trim() !== c.label ? e.target.value.trim() : c.set.label })}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    <div className="muted small">
                      {c.receptacles ? `${c.receptacles} rec.` : ''}
                      {c.lights ? `${c.receptacles ? ' · ' : ''}${c.lights} light${c.lights === 1 ? '' : 's'}` : ''}
                      {c.appliance?.typical ? 'typical load*' : ''}
                      {Object.keys(c.set).length > 0 && (
                        <>
                          {' '}
                          <button className="link" onClick={() => setCircuit(c.key, { amps: undefined, label: undefined, afci: undefined, gfci: undefined })}>
                            reset
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="num">
                    <select value={c.amps} onChange={(e) => setCircuit(c.key, { amps: Number(e.target.value) })} aria-label="Breaker size">
                      {BREAKERS.map((x) => (
                        <option key={x} value={x}>
                          {x} A
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{c.poles}</td>
                  <td>
                    <input type="checkbox" checked={c.afci} onChange={(e) => setCircuit(c.key, { afci: e.target.checked === c.afciRequired ? undefined : e.target.checked })} aria-label="AFCI" />
                    {c.afciRequired && !c.afci && <span className="warn-text"> req.</span>}
                  </td>
                  <td>
                    <input type="checkbox" checked={c.gfci} onChange={(e) => setCircuit(c.key, { gfci: e.target.checked === c.gfciRequired ? undefined : e.target.checked })} aria-label="GFCI" />
                    {c.gfciRequired && !c.gfci && <span className="warn-text"> req.</span>}
                  </td>
                  <td className="num">
                    {va(c.va)}
                    {c.inGeneralLoad ? '†' : ''}
                  </td>
                  <td className="num">{a ? va(a) : ''}</td>
                  <td className="num">{b ? va(b) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>
                  Leg totals — {panel.phaseA + panel.phaseB ? `${Math.round((imbalance / Math.max(panel.phaseA, panel.phaseB, 1)) * 100)}% apart` : 'no load yet'}
                </td>
                <td className="num strong">{va(panel.phaseA)}</td>
                <td className="num strong">{va(panel.phaseB)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted small">
          Circuits are numbered down a two-column panel (odd left, even right); rows alternate legs A and B, so a 2-pole breaker takes two rows on one side and loads
          both legs. 2-pole circuits go in first, then 120 V circuits largest first onto the lighter leg. General circuits carry 3 VA/sq ft of their rooms; † receptacle
          circuits whose load is already in that general figure are shown at 180 VA per receptacle for balancing only. Move a receptacle, light or appliance to another
          circuit from its panel on the Plan tab. Print (top bar) prints this
          page.
        </p>
      </section>
    </div>
  );
}
