import type { Furniture, Project } from '../model/types.ts';
import type { Box } from './model3d.ts';
import { stairGeometry } from './stairs.ts';
import { isTurning, landingOf, pathLength, pathRects, straightSteps, toPlan, type Rect } from './stairShape.ts';

// A stair in 3D: one solid block per step, from the floor up to its tread, laid
// along the walk line (flights cut across, a landing as one deep step), so it
// reads as a closed-riser stair and you can walk up it in the walkthrough. The
// last riser lands on the floor above; a stair going down drops below this floor.

/** Walk-line depth of each step (treads, the landing as one long step), foot first. */
export function stepDepths(project: Project, f: Furniture): number[] {
  const g = stairGeometry(project, f);
  if (isTurning(f)) {
    const [a, b] = g.flightRuns!;
    return [...Array(a.treads).fill(a.tread), landingOf(f)!.len, ...Array(b.treads).fill(b.tread)];
  }
  return straightSteps(f).depths;
}

/** The step blocks of one stair. */
export function stairBoxes(project: Project, f: Furniture): Box[] {
  const g = stairGeometry(project, f);
  const depths = stepDepths(project, f);
  const total = depths.reduce((t, d) => t + d, 0);
  // Scale to the drawn walk line, so rounding never leaves a gap at the top.
  const k = total > 0 ? pathLength(f) / total : 1;
  const rot = (f.rot * Math.PI) / 180;
  const boxes: Box[] = [];
  let at = 0;
  depths.forEach((d, i) => {
    const step = i + 1;
    // Going down, the foot is on this floor and each step is a riser lower.
    const top = f.down ? -step * g.riser : step * g.riser;
    const bottom = f.down ? -g.rise : 0;
    for (const r of pathRects(f, at * k, (at + d) * k)) boxes.push(block(f, r, bottom, top, rot));
    at += d;
  });
  return boxes;
}

function block(f: Furniture, r: Rect, y0: number, y1: number, rot: number): Box {
  const c = toPlan(f, { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
  const [lo, hi] = [Math.min(y0, y1), Math.max(y0, y1)];
  return { kind: 'stair', c: [c.x, (lo + hi) / 2, c.y], size: [r.x1 - r.x0, hi - lo, r.y1 - r.y0], rotY: -rot };
}

