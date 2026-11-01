import { homography, orderCorners, project, quadSize } from './homography.ts';
import type { Point, Underlay } from './types.ts';

// Browser-side image work for the underlay: PDF pages (pdf.js, loaded on demand)
// and perspective straightening. Results are JPEG data URLs, like readUnderlay.

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;

const JPEG_Q = 0.82;
/** PDFs are often big sheets; give them more pixels than photos. */
export const PDF_MAX_SIDE = 3200;

export async function openPdf(file: File): Promise<PdfDoc> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (e) {
    throw new Error((e as Error).name === 'PasswordException' ? 'That PDF is password-protected.' : 'That file could not be read as a PDF.');
  }
}

/** Render one page (1-based) so its longest side is `maxSide` px. `pxPerPt` = render pixels per PDF point (1/72"). */
export async function renderPage(doc: PdfDoc, n: number, maxSide: number): Promise<{ canvas: HTMLCanvasElement; pxPerPt: number }> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const pxPerPt = maxSide / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale: pxPerPt });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 'print' intent renders without requestAnimationFrame, which stalls in background tabs.
  await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print' }).promise;
  return { canvas, pxPerPt };
}

/**
 * Underlay from a rendered PDF page. With a drawing scale (paper inches per
 * real foot, e.g. 0.25 for 1/4" = 1'-0") the image comes in at true size;
 * otherwise 50 ft wide, to be calibrated.
 */
export function pdfUnderlay(canvas: HTMLCanvasElement, pxPerPt: number, at: Point, paperInPerFoot?: number): Underlay {
  const w = canvas.width;
  const h = canvas.height;
  // real inches per pixel = (1 / pxPerPt points) × (1/72 paper in per point) × (12 / paperInPerFoot real in per paper in)
  const scale = paperInPerFoot ? 12 / paperInPerFoot / (72 * pxPerPt) : 600 / w;
  return {
    src: canvas.toDataURL('image/jpeg', JPEG_Q),
    pxWidth: w,
    pxHeight: h,
    x: at.x - (w * scale) / 2,
    y: at.y - (h * scale) / 2,
    scale,
    opacity: 0.5,
    visible: true,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the floorplan image'));
    img.src = src;
  });
}

/**
 * Straighten the underlay: `corners` are four plan-space clicks on what is really
 * a rectangle in the picture. The image is warped and cropped to that rectangle.
 * With the rectangle's real width (TL→TR) and depth (TL→BL) it is also scaled.
 */
export async function straightenUnderlay(u: Underlay, corners: Point[], real?: { w: number; h: number }): Promise<Underlay> {
  const quad = orderCorners(corners);
  const srcQuad = quad.map((p) => ({ x: (p.x - u.x) / u.scale, y: (p.y - u.y) / u.scale }));
  let { w, h } = quadSize(srcQuad);
  if (real) h = (w * real.h) / real.w;
  const k = Math.min(1, 2400 / Math.max(w, h));
  const W = Math.max(1, Math.round(w * k));
  const H = Math.max(1, Math.round(h * k));

  const img = await loadImage(u.src);
  const src = document.createElement('canvas');
  src.width = u.pxWidth;
  src.height = u.pxHeight;
  const sctx = src.getContext('2d')!;
  sctx.drawImage(img, 0, 0, u.pxWidth, u.pxHeight);
  const sd = sctx.getImageData(0, 0, u.pxWidth, u.pxHeight).data;

  // Map each output pixel back into the source picture and sample bilinearly.
  const hm = homography(
    [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ],
    srcQuad,
  );
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const octx = out.getContext('2d')!;
  const od = octx.createImageData(W, H);
  const sw = u.pxWidth;
  const sh = u.pxHeight;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = project(hm, { x: x + 0.5, y: y + 0.5 });
      const fx = Math.min(sw - 1.001, Math.max(0, p.x - 0.5));
      const fy = Math.min(sh - 1.001, Math.max(0, p.y - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        od.data[o + c] = (sd[i00 + c] * (1 - ax) + sd[i10 + c] * ax) * (1 - ay) + (sd[i01 + c] * (1 - ax) + sd[i11 + c] * ax) * ay;
      }
      od.data[o + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  const scale = real ? real.w / W : u.scale / k;
  return { ...u, src: out.toDataURL('image/jpeg', JPEG_Q), pxWidth: W, pxHeight: H, x: quad[0].x, y: quad[0].y, scale };
}
