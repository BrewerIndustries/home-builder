import { stairGeometry, stairTarget } from '../calc/stairs.ts';
import type { Furniture, Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import { Field } from './Inspector.tsx';
import { LengthInput } from './LengthInput.tsx';

/** Stairs between storeys: the floor opening over the flight, checked for 6' 8" headroom (R311.7.2). */
export function StairOpeningField({ project, f, up }: { project: Project; f: Furniture; up(patch: Partial<Furniture>): void }) {
  const g = stairGeometry(project, f);
  const target = stairTarget(project, f);
  const where = f.down ? 'this floor' : target ? `the ${target.name.toLowerCase()}` : 'the floor above';
  return (
    <Field label="Floor opening" hint={`In ${where}, back from the top of the stair; 6' 8" headroom needs ${formatFtIn(g.opening)} (R311.7.2). Whole stair when unset`}>
      <LengthInput value={f.floorOpening ?? f.d} min={0} onChange={(v) => up({ floorOpening: v >= f.d - 0.01 ? undefined : v })} />
    </Field>
  );
}
