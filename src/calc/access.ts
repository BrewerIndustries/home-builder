import { isMultiStorey, isTopStorey } from '../model/storeys.ts';
import type { Furniture, Project } from '../model/types.ts';
import { formatFtIn } from '../model/units.ts';
import type { CodeCheck } from './irc.ts';
import { equipmentSpaces } from './lighting.ts';

// Lighting v6: getting to equipment in the attic and under the floor.
//   M1305.1.3 an attic with an appliance in it: an opening at least 20" × 30"
//             (and big enough to take the largest piece out), a passageway at
//             least 30" high and 22" wide, no more than 20 ft long, from the
//             opening to the appliance, and a level 30" × 30" service space at
//             its control side. The hatch is placed on the plan (a ceiling
//             symbol on the top floor); the passageway's length is typed in.
//   M1305.1.4 under-floor appliances need an access opening and passageway too —
//             listed as a note to size from the adopted code, without figures.

/** M1305.1.3, inches. */
export const ATTIC_OPENING = { w: 20, l: 30 };
export const ATTIC_PASSAGE = { h: 30, w: 22, maxLength: 240 };
export const SERVICE_SPACE = 30;

export const isAtticAccess = (f: Furniture) => f.kind === 'attic-access';

export function accessChecks(project: Project): CodeCheck[] {
  const out: CodeCheck[] = [];
  const spaces = new Map(equipmentSpaces(project));
  const hatches = project.furniture.filter(isAtticAccess);
  const equipment = spaces.get('attic') === 'equipment';
  for (const f of hatches) {
    const [short, long] = [Math.min(f.w, f.d), Math.max(f.w, f.d)];
    const size = `${formatFtIn(f.w)} × ${formatFtIn(f.d)}`;
    if (isMultiStorey(project) && !isTopStorey(project)) {
      out.push({ rule: 'Attic access on the top floor', section: 'M1305.1.3', status: 'warn', message: `${size} hatch: there's a floor above this one — the attic access belongs in the top floor's ceiling`, targetId: f.id });
    }
    if (!equipment) {
      out.push({
        rule: 'Attic access opening',
        section: 'M1305.1.3',
        status: 'info',
        message: `${size} hatch${spaces.has('attic') ? '' : ' (no roof on this plan)'} — the M1305.1.3 sizes apply when an appliance is in the attic (say so in the Project panel)`,
        targetId: f.id,
      });
      continue;
    }
    const big = short >= ATTIC_OPENING.w - 0.01 && long >= ATTIC_OPENING.l - 0.01;
    out.push({
      rule: 'Attic access opening (20" × 30")',
      section: 'M1305.1.3',
      status: big ? 'pass' : 'fail',
      message: `${size} clear${big ? '' : ' — wants 20" × 30" at least'}; it also has to be big enough to take out the largest appliance`,
      targetId: f.id,
    });
    const p = f.passage;
    out.push({
      rule: 'Attic passageway (30" high, 22" wide, 20 ft max)',
      section: 'M1305.1.3',
      status: p === undefined ? 'info' : p <= ATTIC_PASSAGE.maxLength + 0.01 ? 'pass' : 'fail',
      message:
        p === undefined
          ? 'type how far it is from the hatch to the appliance (select the hatch): the passageway runs at most 20 ft, 30" high and 22" wide, with solid flooring'
          : `${formatFtIn(p)} from the hatch to the appliance${p <= ATTIC_PASSAGE.maxLength + 0.01 ? '' : ' — 20 ft at most: move the hatch or the appliance'}; keep it 30" high and 22" wide, with solid flooring`,
      targetId: f.id,
    });
    out.push({ rule: 'Service space at the appliance', section: 'M1305.1.3', status: 'info', message: `a level ${SERVICE_SPACE}" × ${SERVICE_SPACE}" working space at the appliance's control side`, targetId: f.id });
  }
  // With no hatch placed, lightingChecks lists what the access needs (M1305.1.3).
  if (spaces.get('crawlspace') === 'equipment') {
    out.push({
      rule: 'Under-floor equipment access',
      section: 'M1305.1.4',
      status: 'info',
      message: 'appliances in the crawlspace need an access opening and an unobstructed passageway to them, and a level service space at the control side — size them from M1305.1.4 in your adopted code (the crawlspace access is not drawn on the plan)',
    });
  }
  return out;
}
