import { useState, type Dispatch } from 'react';
import { foundationOf } from '../calc/foundation.ts';
import { roofOf } from '../calc/roof.ts';
import type { Action } from '../model/store.ts';
import { applyStandards, type ApplyStandards } from '../model/standards.ts';
import { LUMBER_SIZES, standardsOf, type FoundationType, type LumberSize, type Project, type ProjectStandards, type RoofType, type WindowStyle } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { Modal } from '../ui/Modal.tsx';
import { Field } from './Inspector.tsx';
import { LengthInput } from './LengthInput.tsx';

// Project setup: the standards a project starts from — ceiling height, door and
// window sizes, the roof and attic, the structure. New walls, doors and windows
// are drawn to them; "Apply to what's drawn" brings existing ones into line.

const WINDOW_STYLES: [WindowStyle, string][] = [
  ['single-hung', 'Single-hung'],
  ['slider', 'Slider'],
  ['casement', 'Casement'],
  ['fixed', 'Fixed'],
];

export function ProjectSetupDialog({ project, dispatch, onClose }: { project: Project; dispatch: Dispatch<Action>; onClose(): void }) {
  const s = standardsOf(project);
  const roof = roofOf(project);
  const found = foundationOf(project);
  const set = (patch: Partial<ProjectStandards>) => dispatch({ type: 'setStandards', patch });
  const close = () => {
    if (!project.standards?.seen) set({ seen: true });
    onClose();
  };
  const [what, setWhat] = useState<ApplyStandards>({ interiorDoors: true, exteriorDoors: true, openings: false, windows: false, walls: false, widths: false });
  const [done, setDone] = useState<string | null>(null);
  const tick = (k: keyof ApplyStandards, label: string) => (
    <label className="link-row">
      <input type="checkbox" checked={!!what[k]} onChange={(e) => setWhat({ ...what, [k]: e.target.checked })} /> {label}
    </label>
  );
  const apply = () => {
    const r = applyStandards(project, what);
    if (r.changed) dispatch({ type: 'replaceProject', project: r.project });
    setDone(r.changed ? `Changed ${r.changed} item${r.changed === 1 ? '' : 's'} (Undo puts them back).` : 'Everything already matches.');
  };
  const mismatch =
    s.roofVent === 'sealed' && s.attic === 'cold'
      ? 'A cold roof needs a vented attic: with sealed eaves and ridge, moist air trapped above the ceiling insulation condenses on the cold deck (R806.1). Vent it, or make it a warm roof.'
      : s.roofVent === 'vented' && s.attic === 'warm'
        ? 'A warm roof with vented eaves and ridge needs a vent space between the insulation and the deck (a vented-over-deck roof). Most warm roofs are sealed instead (R806.5).'
        : null;

  return (
    <Modal title="Project setup" onClose={close}>
      <div className="setup">
        <p className="muted small">The standards this project is drawn to. New walls, doors and windows take these sizes. Change them any time; use “Apply to what's drawn” below to bring existing work into line.</p>

        <section>
          <h3>Heights</h3>
          <div className="setup-grid">
            <Field label="Ceiling height" hint="Floor to ceiling: the height of every new wall (plate to plate). 8' 1-1/8&quot; is a standard 8' wall; 9' and 10' are common upgrades">
              <LengthInput value={project.framing.wallHeight} min={72} onChange={(v) => dispatch({ type: 'setFraming', patch: { wallHeight: v } })} />
            </Field>
          </div>
        </section>

        <section>
          <h3>Doors</h3>
          <div className="setup-grid">
            <Field label="Interior door width">
              <LengthInput value={s.interiorDoorWidth} min={18} onChange={(v) => set({ interiorDoorWidth: v })} />
            </Field>
            <Field label="Interior door height" hint="6' 8&quot; standard; 8' with 9'+ ceilings">
              <LengthInput value={s.interiorDoorHeight} min={60} onChange={(v) => set({ interiorDoorHeight: v })} />
            </Field>
            <Field label="Exterior door width" hint="36&quot; for the egress door (R311.2)">
              <LengthInput value={s.exteriorDoorWidth} min={24} onChange={(v) => set({ exteriorDoorWidth: v })} />
            </Field>
            <Field label="Exterior door height">
              <LengthInput value={s.exteriorDoorHeight} min={60} onChange={(v) => set({ exteriorDoorHeight: v })} />
            </Field>
          </div>
        </section>

        <section>
          <h3>Windows</h3>
          <div className="setup-grid">
            <Field label="Width">
              <LengthInput value={s.windowWidth} min={12} onChange={(v) => set({ windowWidth: v })} />
            </Field>
            <Field label="Height">
              <LengthInput value={s.windowHeight} min={12} onChange={(v) => set({ windowHeight: v })} />
            </Field>
            <Field label="Head height" hint={`Floor to the top of the window, usually lined up with the door heads. Sill at ${formatFtIn(Math.max(0, s.windowHead - s.windowHeight))}`}>
              <LengthInput value={s.windowHead} min={24} onChange={(v) => set({ windowHead: v })} />
            </Field>
            <Field label="Style">
              <select value={s.windowStyle} onChange={(e) => set({ windowStyle: e.target.value as WindowStyle })}>
                {WINDOW_STYLES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <section>
          <h3>Roof &amp; attic</h3>
          <div className="setup-grid">
            <Field label="Attic" hint={s.attic === 'cold' ? 'Insulation lies on the ceiling; the attic above stays outside the heated space' : 'Insulation follows the roof deck; the attic is inside the heated space (good for ducts up there)'}>
              <select value={s.attic} onChange={(e) => set({ attic: e.target.value as 'cold' | 'warm' })}>
                <option value="cold">Cold roof (insulated ceiling)</option>
                <option value="warm">Warm roof (insulated roof deck)</option>
              </select>
            </Field>
            <Field label="Eaves &amp; ridge" hint={s.roofVent === 'vented' ? 'Soffit vents at the eaves, a ridge vent at the top (R806.2 sizes them)' : 'Roof-to-wall junction and ridge sealed; solid soffits, no vents'}>
              <select value={s.roofVent} onChange={(e) => set({ roofVent: e.target.value as 'vented' | 'sealed' })}>
                <option value="vented">Vented eaves + ridge vent</option>
                <option value="sealed">Sealed (unvented)</option>
              </select>
            </Field>
            <Field label="Roof">
              <select value={roof.type} onChange={(e) => dispatch({ type: 'setRoof', patch: { type: e.target.value as RoofType } })}>
                <option value="gable">Gable</option>
                <option value="hip">Hip</option>
                <option value="shed">Shed</option>
                <option value="none">None (flat / not drawn)</option>
              </select>
            </Field>
            <Field label="Pitch" hint="Rise per 12 of run">
              <input type="number" min={1} max={24} value={roof.pitch} onChange={(e) => dispatch({ type: 'setRoof', patch: { pitch: Math.max(1, Math.min(24, Number(e.target.value) || roof.pitch)) } })} />
            </Field>
            <Field label="Eave overhang">
              <LengthInput value={roof.overhang} onChange={(v) => dispatch({ type: 'setRoof', patch: { overhang: v } })} />
            </Field>
            <Field label="Framing">
              <select value={roof.framing} onChange={(e) => dispatch({ type: 'setRoof', patch: { framing: e.target.value as 'trusses' | 'rafters' } })}>
                <option value="trusses">Trusses</option>
                <option value="rafters">Rafters (stick framed)</option>
              </select>
            </Field>
          </div>
          {mismatch && <p className="warn-text small">{mismatch}</p>}
        </section>

        <section>
          <h3>Structure</h3>
          <div className="setup-grid">
            <Field label="Stud spacing">
              <select value={project.framing.studSpacing} onChange={(e) => dispatch({ type: 'setFraming', patch: { studSpacing: Number(e.target.value) as 16 | 24 } })}>
                <option value={16}>16" o.c.</option>
                <option value={24}>24" o.c.</option>
              </select>
            </Field>
            <Field label="Exterior studs">
              <select value={project.framing.exteriorStud} onChange={(e) => dispatch({ type: 'setFraming', patch: { exteriorStud: e.target.value as LumberSize } })}>
                {LUMBER_SIZES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Interior studs">
              <select value={project.framing.interiorStud} onChange={(e) => dispatch({ type: 'setFraming', patch: { interiorStud: e.target.value as LumberSize } })}>
                {LUMBER_SIZES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Foundation">
              <select value={found.type} onChange={(e) => dispatch({ type: 'setFoundation', patch: { type: e.target.value as FoundationType } })}>
                <option value="slab">Slab on grade</option>
                <option value="crawl">Crawlspace</option>
                <option value="basement">Basement</option>
                <option value="none">None</option>
              </select>
            </Field>
          </div>
        </section>

        <section>
          <h3>Apply to what's drawn</h3>
          <p className="muted small">New work already follows the settings above. Tick what to bring into line on every floor:</p>
          <div className="setup-ticks">
            {tick('interiorDoors', `Interior doors → ${formatFtIn(s.interiorDoorHeight)} high`)}
            {tick('exteriorDoors', `Exterior doors → ${formatFtIn(s.exteriorDoorHeight)} high`)}
            {tick('openings', `Doorless openings (interior) → ${formatFtIn(s.interiorDoorHeight)} high`)}
            {tick('windows', `Windows → ${formatFtIn(s.windowHeight)} high, head at ${formatFtIn(s.windowHead)}`)}
            {tick('walls', `Walls → ${formatFtIn(project.framing.wallHeight)} (railings and glass left alone)`)}
            {tick('widths', 'Widths too (doors and windows), not just heights')}
          </div>
          <div className="row">
            <button className="primary" onClick={apply}>
              Apply
            </button>
            {done && <span className="muted small">{done}</span>}
          </div>
        </section>

        <div className="row setup-foot">
          <button className="primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
