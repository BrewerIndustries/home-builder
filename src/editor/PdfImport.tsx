import { useEffect, useState } from 'react';
import { PDF_MAX_SIDE, pdfUnderlay, renderPage } from '../model/imaging.ts';
import type { Point, Underlay } from '../model/types.ts';
import { Modal } from '../ui/Modal.tsx';

// Pick a page of a PDF plan set and, if the sheet says so, its drawing scale.

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;

/** Paper inches per real foot. */
const SCALES: { label: string; value: number }[] = [
  { label: '1/8" = 1\'-0"', value: 1 / 8 },
  { label: '3/16" = 1\'-0"', value: 3 / 16 },
  { label: '1/4" = 1\'-0"', value: 1 / 4 },
  { label: '3/8" = 1\'-0"', value: 3 / 8 },
  { label: '1/2" = 1\'-0"', value: 1 / 2 },
  { label: '1" = 1\'-0"', value: 1 },
];
const MAX_THUMBS = 40;

export function PdfImport({ doc, at, onImport, onClose }: { doc: PdfDoc; at: Point; onImport(u: Underlay, calibrated: boolean): void; onClose(): void }) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (let n = 1; n <= Math.min(doc.numPages, MAX_THUMBS) && !cancelled; n++) {
        const { canvas } = await renderPage(doc, n, 220);
        if (!cancelled) setThumbs((t) => [...t, canvas.toDataURL('image/jpeg', 0.7)]);
      }
    })().catch((e) => setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [doc]);

  async function go() {
    setBusy(true);
    try {
      const { canvas, pxPerPt } = await renderPage(doc, page, PDF_MAX_SIDE);
      onImport(pdfUnderlay(canvas, pxPerPt, at, scale || undefined), !!scale);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Import PDF · ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}`} onClose={onClose}>
      {error && <p className="banner error">{error}</p>}
      {doc.numPages > 1 && <p className="muted small">Pick the floor plan sheet{doc.numPages > MAX_THUMBS ? ` (first ${MAX_THUMBS} shown)` : ''}.</p>}
      <div className="pdf-pages">
        {Array.from({ length: Math.min(doc.numPages, MAX_THUMBS) }, (_, i) => (
          <button key={i} className={page === i + 1 ? 'active' : ''} onClick={() => setPage(i + 1)} title={`Page ${i + 1}`}>
            {thumbs[i] ? <img src={thumbs[i]} alt={`Page ${i + 1}`} /> : <span className="muted">…</span>}
            <span className="small">{i + 1}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Drawing scale (from the sheet's title block)</span>
        <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
          <option value={0}>Unknown — I'll calibrate with a known dimension</option>
          {SCALES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <small className="muted">Only right if the PDF is the original sheet size (not "fit to page"). Check one dimension after importing.</small>
      </label>
      <button className="primary" disabled={busy} onClick={go}>
        {busy ? 'Rendering…' : `Import page ${page}`}
      </button>
    </Modal>
  );
}
