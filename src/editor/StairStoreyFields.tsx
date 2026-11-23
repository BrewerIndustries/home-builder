import { ATTIC_OPENING, ATTIC_PASSAGE } from '../calc/access.ts';
import { FLIGHT_WIDTH, flightWidth, isTurning, pathLength, turnLandingDepth } from '../calc/stairShape.ts';
import { openingLength, stairGeometry, stairTarget } from '../calc/stairs.ts';
import type { Furniture, Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { Field } from './Inspector.tsx';
import { LengthInput } from './LengthInput.tsx';

/** Straight, L or U; which way it turns, how wide each flight is and how deep a U's landing. Switching shape resizes it for 11" treads. */
export function StairShapeFields({ f, up }: { f: Furniture; up(patch: Partial<Furniture>): void }) {
  const shape = f.shape ?? 'straight';
  const R = f.risers ?? 13;
  const reshape = (s: 'straight' | 'L' | 'U') => {
    const b = f.flight ?? FLIGHT_WIDTH;
    const n1 = Math.round(f.landing ?? f.landings?.[0] ?? R / 2);
    const n2 = R - n1;
    if (s === 'straight') return up({ shape: undefined, turn: undefined, flight: undefined, landingDepth: undefined, w: b, d: (R - 1) * 11 });
    if (s === 'L') return up({ shape: 'L', landing: n1, w: b + Math.max(1, n2 - 1) * 11, d: b + Math.max(1, n1 - 1) * 11 });
    return up({ shape: 'U', landing: n1, w: 2 * b + 4, d: b + Math.max(1, n1 - 1, n2 - 1) * 11 });
  };
  const turning = isTurning(f);
  return (
    <>
      <Field label="Shape" hint="L: a quarter turn on a square landing. U: a half turn, the second flight beside the first">
        <select value={shape} onChange={(e) => reshape(e.target.value as 'straight' | 'L' | 'U')}>
          <option value="straight">Straight</option>
          <option value="L">L — turns at the landing</option>
          <option value="U">U — turns back at the landing</option>
        </select>
      </Field>
      {turning && (
        <>
          <Field label="Turns" hint="Walking up from the foot">
            <select value={f.turn ?? 'right'} onChange={(e) => up({ turn: e.target.value === 'left' ? 'left' : undefined })}>
              <option value="right">To the right</option>
              <option value="left">To the left</option>
            </select>
          </Field>
          <Field label="Flight width" hint={`Each flight, 3' 0" clear at least (R311.7.1); now ${formatFtIn(flightWidth(f))}`}>
            <LengthInput value={f.flight ?? FLIGHT_WIDTH} min={12} onChange={(v) => up({ flight: v === FLIGHT_WIDTH ? undefined : v })} />
          </Field>
          {f.shape === 'U' && (
            <Field label="Landing depth" hint={`In the direction of travel: at least the flight width and 3' 0" (R311.7.6)`}>
              <LengthInput value={turnLandingDepth(f)} min={12} onChange={(v) => up({ landingDepth: v })} />
            </Field>
          )}
        </>
      )}
    </>
  );
}

/** Attic access: how far the passageway runs to the appliance (M1305.1.3). */
export function AtticAccessFields({ f, up }: { f: Furniture; up(patch: Partial<Furniture>): void }) {
  return (
    <Field label="Passageway to the appliance" hint={`If an appliance is in the attic: at most ${formatFtIn(ATTIC_PASSAGE.maxLength)} long, ${ATTIC_PASSAGE.h}" high and ${ATTIC_PASSAGE.w}" wide (M1305.1.3). Opening at least ${ATTIC_OPENING.w}" × ${ATTIC_OPENING.l}"`}>
      <LengthInput value={f.passage ?? 0} min={0} onChange={(v) => up({ passage: v > 0 ? v : undefined })} />
    </Field>
  );
}

/** Stairs between storeys: the floor opening over the flight, checked for 6' 8" headroom (R311.7.2). */
export function StairOpeningField({ project, f, up }: { project: Project; f: Furniture; up(patch: Partial<Furniture>): void }) {
  const g = stairGeometry(project, f);
  const target = stairTarget(project, f);
  const where = f.down ? 'this floor' : target ? `the ${target.name.toLowerCase()}` : 'the floor above';
  return (
    <Field label="Floor opening" hint={`In ${where}, back from the top of the stair; 6' 8" headroom needs ${formatFtIn(g.opening)} (R311.7.2). Whole stair when unset`}>
      <LengthInput value={openingLength(f)} min={0} onChange={(v) => up({ floorOpening: v >= pathLength(f) - 0.01 ? undefined : v })} />
    </Field>
  );
}
