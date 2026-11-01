import { migrate } from './store.ts';
import { emptyProject, type Project, type Underlay } from './types.ts';

const KEY = 'home-builder:project';

export function loadSaved(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw) as Project);
  } catch {
    // Private window, blocked storage or a corrupt save — start fresh.
  }
  return emptyProject();
}

/** Returns an error message if the browser refused the save (usually quota). */
export function save(project: Project): string | null {
  try {
    localStorage.setItem(KEY, JSON.stringify(project));
    return null;
  } catch (e) {
    return e instanceof DOMException && e.name === 'QuotaExceededError'
      ? 'Browser storage is full — the floorplan image is probably too large. Export the project to keep a copy.'
      : 'Could not save to browser storage — export the project to keep a copy.';
  }
}

export function downloadJson(project: Project) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${slug(project.name)}.homebuilder.json`);
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'house';
}

export async function readProjectFile(file: File): Promise<Project> {
  const data = JSON.parse(await file.text()) as Project;
  if (data?.version !== 1 || !Array.isArray(data.walls)) throw new Error('Not a Home Builder project file');
  return migrate(data);
}

const MAX_SIDE = 2400;

/**
 * Load a picture of a floorplan as an underlay. Downscaled to ≤ 2400 px and
 * re-encoded as JPEG so it fits in browser storage with the project. Placed at
 * `at`, initially 50 ft wide — calibrate afterwards to get true scale.
 */
export async function readUnderlay(file: File, at: { x: number; y: number }): Promise<Underlay> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file could not be read as an image'));
      el.src = url;
    });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k);
    const h = Math.round(img.naturalHeight * k);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const scale = 600 / w;
    return {
      src: canvas.toDataURL('image/jpeg', 0.82),
      pxWidth: w,
      pxHeight: h,
      x: at.x - (w * scale) / 2,
      y: at.y - (h * scale) / 2,
      scale,
      opacity: 0.5,
      visible: true,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
