import { basinCentres } from '../calc/furniture.ts';
import type { Furniture } from '../model/types.ts';
import { LengthInput } from './LengthInput.tsx';

// Fixtures v7 inspector options: a stall shower as a curbless walk-in (and its
// open side), and where the two basins sit on a double vanity.

const round = (n: number) => Math.round(n * 1000) / 1000;

export function FixtureOptions({ f, up }: { f: Furniture; up(patch: Partial<Furniture>): void }) {
  if (f.kind === 'shower') {
    return (
      <>
        <label className="link-row">
          <input type="checkbox" checked={!!f.walkIn} onChange={(e) => up(e.target.checked ? { walkIn: true } : { walkIn: undefined, entry: undefined })} /> Curbless walk-in — no curb or
          door, one side open (still 900 sq in and a 30" circle, P2708.1)
        </label>
        {f.walkIn && (
          <label className="field">
            <span>Open side</span>
            <select value={f.entry ?? 'front'} onChange={(e) => up({ entry: e.target.value === 'front' ? undefined : (e.target.value as 'left' | 'right') })}>
              <option value="front">Front</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
            <small className="muted">Needs 24" clear in front of it (R307.1)</small>
          </label>
        )}
      </>
    );
  }
  if (f.kind === 'lavatory' && f.basins === 2) {
    // Shown as each basin's centre from its own end of the vanity.
    const [a, b] = basinCentres(f);
    const set = (left: number, right: number) => up({ basinAt: [round(left), round(right)] });
    return (
      <>
        <label className="field">
          <span>Left basin centre</span>
          <LengthInput value={round(a + f.w / 2)} onChange={(v) => set(v - f.w / 2, b)} />
          <small className="muted">From the left end of the vanity</small>
        </label>
        <label className="field">
          <span>Right basin centre</span>
          <LengthInput value={round(f.w / 2 - b)} onChange={(v) => set(a, f.w / 2 - v)} />
          <small className="muted">From the right end; each basin is checked for a receptacle within 36" of its own bowl (E3901.6)</small>
        </label>
        {f.basinAt && <button onClick={() => up({ basinAt: undefined })}>Centre the basins in each half</button>}
      </>
    );
  }
  return null;
}
