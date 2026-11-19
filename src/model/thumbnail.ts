import type { Point, Project } from './types.ts';

// A small SVG picture of the plan (rooms filled, walls stroked) for the
// Projects dialog. Plain markup with integer coordinates in a 120 × 90 box, so
// it's a few KB at most and can sit in the project's metadata row. Shown with
// <img src=data:…>, where an SVG can't run script.

export const THUMB_W = 120;
export const THUMB_H = 90;
/** Longest thumbnail kept; the Worker refuses anything bigger. */
export const MAX_THUMB = 6000;

const PAD = 5;

export function planThumbnail(project: Project): string | null {
  const pts: Point[] = [];
  for (const w of project.walls) pts.push(w.a, w.b);
  for (const r of project.rooms) pts.push(...r.points);
  const finite = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!finite.length) return null;
  const minX = Math.min(...finite.map((p) => p.x));
  const maxX = Math.max(...finite.map((p) => p.x));
  const minY = Math.min(...finite.map((p) => p.y));
  const maxY = Math.max(...finite.map((p) => p.y));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const k = Math.min((THUMB_W - 2 * PAD) / Math.max(maxX - minX, span / 1000), (THUMB_H - 2 * PAD) / Math.max(maxY - minY, span / 1000));
  // Centre the drawing in the box.
  const ox = (THUMB_W - (maxX - minX) * k) / 2;
  const oy = (THUMB_H - (maxY - minY) * k) / 2;
  const fx = (x: number) => Math.round(ox + (x - minX) * k);
  const fy = (y: number) => Math.round(oy + (y - minY) * k);
  const seg = (a: Point, b: Point) => `M${fx(a.x)} ${fy(a.y)}L${fx(b.x)} ${fy(b.y)}`;

  const rooms = project.rooms
    .filter((r) => r.points.length >= 3)
    .map((r) => 'M' + r.points.map((p) => `${fx(p.x)} ${fy(p.y)}`).join('L') + 'Z')
    .join('');
  const ext = project.walls.filter((w) => w.kind === 'exterior').map((w) => seg(w.a, w.b)).join('');
  const int = project.walls.filter((w) => w.kind !== 'exterior').map((w) => seg(w.a, w.b)).join('');

  const build = (parts: { rooms: boolean; int: boolean }) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${THUMB_W} ${THUMB_H}">` +
    (parts.rooms && rooms ? `<path d="${rooms}" fill="#7aa7d9" fill-opacity=".3"/>` : '') +
    (parts.int && int ? `<path d="${int}" stroke="#6b7480" stroke-width="1" fill="none"/>` : '') +
    (ext ? `<path d="${ext}" stroke="#46505c" stroke-width="2.2" stroke-linecap="square" fill="none"/>` : '') +
    '</svg>';

  // Busy plans drop detail rather than blow the size cap.
  for (const parts of [{ rooms: true, int: true }, { rooms: false, int: true }, { rooms: false, int: false }]) {
    const svg = build(parts);
    if (svg.length <= MAX_THUMB && (rooms || int || ext)) return svg;
  }
  return null;
}

export function thumbSrc(svg: string): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
