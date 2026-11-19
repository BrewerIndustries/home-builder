import type { Dormer, Roof } from '../model/types.ts';
import { LengthInput } from './LengthInput.tsx';

// Roof v2 settings under the project panel's Roof fields: a roof per wing,
// attic vent ratio, and dormers on the main roof.

const newDormer = (type: Dormer['type'], n: number): Dormer => ({
  id: `dormer-${Date.now().toString(36)}-${n}`,
  type,
  side: 'a',
  at: 96 + n * 96,
  width: type === 'gable' ? 60 : 120,
  height: type === 'gable' ? 48 : 42,
  setback: 24,
  pitch: type === 'gable' ? 8 : 2,
});

export function RoofExtras({ roof, set }: { roof: Roof; set(patch: Partial<Roof>): void }) {
  const dormers = roof.dormers ?? [];
  const setDormer = (id: string, patch: Partial<Dormer>) => set({ dormers: dormers.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  return (
    <>
      {roof.type !== 'shed' && (
        <label className="link-row" title="Off: one roof over the outline's bounding box">
          <input type="checkbox" checked={roof.perWing !== false} onChange={(e) => set({ perWing: e.target.checked ? undefined : false })} /> Roof each wing (valleys where an L / T meets)
        </label>
      )}
      <label className="link-row" title="R806.2 lets the vent area drop to 1/300 under its exception conditions">
        <input type="checkbox" checked={!!roof.vent300} onChange={(e) => set({ vent300: e.target.checked || undefined })} /> Attic vents at 1/300 (exception met)
      </label>
      {roof.vent300 && (
        <small className="muted">
          Only when R806.2's exception applies — broadly, a vapour retarder on the warm side of the ceiling in a cold climate, or the vent area split with the right share
          up high near the ridge and the rest at the eaves. Otherwise 1/150.
        </small>
      )}
      {roof.type !== 'shed' && (
        <>
          <h4>Dormers</h4>
          {dormers.map((d, i) => (
            <div key={d.id} className="dormer-fields">
              <div className="row">
                <label className="field">
                  <span>Dormer {i + 1}</span>
                  <select value={d.type} onChange={(e) => setDormer(d.id, { type: e.target.value as Dormer['type'] })}>
                    <option value="gable">Gable</option>
                    <option value="shed">Shed</option>
                  </select>
                </label>
                <label className="field">
                  <span>Roof face</span>
                  <select value={d.side} onChange={(e) => setDormer(d.id, { side: e.target.value as Dormer['side'] })}>
                    <option value="a">Front (top / left)</option>
                    <option value="b">Back (bottom / right)</option>
                  </select>
                </label>
              </div>
              <div className="row">
                <label className="field">
                  <span>Centre from roof end</span>
                  <LengthInput value={d.at} onChange={(v) => setDormer(d.id, { at: v })} />
                </label>
                <label className="field">
                  <span>Width</span>
                  <LengthInput value={d.width} onChange={(v) => setDormer(d.id, { width: v })} />
                </label>
              </div>
              <div className="row">
                <label className="field">
                  <span>Wall height</span>
                  <LengthInput value={d.height} onChange={(v) => setDormer(d.id, { height: v })} />
                </label>
                <label className="field">
                  <span>Set back from wall</span>
                  <LengthInput value={d.setback} onChange={(v) => setDormer(d.id, { setback: v })} />
                </label>
              </div>
              <div className="row">
                <label className="field">
                  <span>Dormer pitch</span>
                  <select value={d.pitch} onChange={(e) => setDormer(d.id, { pitch: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map((p) => (
                      <option key={p} value={p}>
                        {p}/12
                      </option>
                    ))}
                  </select>
                </label>
                <button onClick={() => set({ dormers: dormers.filter((x) => x.id !== d.id) })}>Remove</button>
              </div>
            </div>
          ))}
          <div className="row">
            <button onClick={() => set({ dormers: [...dormers, newDormer('gable', dormers.length)] })}>+ Gable dormer</button>
            <button onClick={() => set({ dormers: [...dormers, newDormer('shed', dormers.length)] })}>+ Shed dormer</button>
          </div>
        </>
      )}
    </>
  );
}
