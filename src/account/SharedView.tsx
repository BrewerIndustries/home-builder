import { lazy, Suspense, useEffect, useRef, useState, type Dispatch } from 'react';
import type { Hit } from '../editor/hitTest.ts';
import { PlanCanvas, type PlanCanvasHandle, type Tool } from '../editor/PlanCanvas.tsx';
import { cloud } from '../model/cloud.ts';
import { newProjectId, putLocal, saveCurrent } from '../model/library.ts';
import { downloadJson, save } from '../model/persist.ts';
import type { Action } from '../model/store.ts';
import { migrate } from '../model/store.ts';
import type { Project } from '../model/types.ts';
import { PrintSheet } from '../views/PrintSheet.tsx';
import { CodeView, FramingView, MaterialsView } from '../views/Reports.tsx';

// A project opened from a read-only share link (`?share=<token>`). No sign-in,
// nothing saved back: every edit is dropped, and the visitor can keep their own
// copy on this device (or download the file). Runs instead of <App/>, so the
// visitor's own open project is left alone.

const View3D = lazy(() => import('../views/View3D.tsx'));

type Tab = 'plan' | '3d' | 'framing' | 'materials' | 'code';
const TAB_LABEL: Record<Tab, string> = { plan: 'Plan', '3d': '3D', framing: 'Framing', materials: 'Estimate', code: 'Code check' };

const ignore: Dispatch<Action> = () => {};
const noop = () => {};

export function SharedView({ token }: { token: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('plan');
  const [selection, setSelection] = useState<Hit | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const canvas = useRef<PlanCanvasHandle>(null);

  useEffect(() => {
    cloud.shared(token).then(
      (r) => {
        setProject(migrate(r.data));
        document.title = `${r.data.name || r.project.name} · Home Builder (shared)`;
        requestAnimationFrame(() => canvas.current?.fit());
      },
      (e) => setError((e as Error).message),
    );
  }, [token]);

  async function saveCopy() {
    if (!project) return;
    const id = newProjectId();
    const copy = { ...project, name: `${project.name} (copy)` };
    await putLocal(id, copy);
    // Open it in the editor: the editor starts from the localStorage mirror and the current pointer.
    save(copy);
    saveCurrent({ source: 'local', id });
    location.replace(location.pathname);
  }

  if (!project) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">🏠</div>
          <strong>Shared plan</strong>
        </header>
        <main className="report-page">
          <p className={error ? 'banner error' : 'muted center'}>{error ?? 'Loading…'}</p>
          {error && (
            <p className="center">
              <a href={location.pathname}>Open Home Builder</a>
            </p>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🏠</div>
        <strong className="project-name shared-name" title={project.name}>
          {project.name}
        </strong>
        <span className="badge">read-only</span>
        <nav className="tabs">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </nav>
        <div className="actions">
          <button onClick={() => window.print()} disabled={!project.walls.length}>
            Print / PDF
          </button>
          <button onClick={() => downloadJson(project)} title="A .homebuilder.json file you can open in Home Builder">
            Download
          </button>
          <button className="primary" onClick={saveCopy} title="Keep your own editable copy in this browser">
            Save a copy
          </button>
        </div>
      </header>
      <div className="banner">Shared with you to view. Changes aren’t saved — use “Save a copy” to edit your own version.</div>

      {tab === 'plan' && <PrintSheet project={project} />}
      {tab === 'plan' ? (
        <main className="workspace">
          <div className="toolbar">
            <div className="spacer" />
            <button onClick={() => canvas.current?.zoom(1.25)} title="Zoom in">
              +
            </button>
            <button onClick={() => canvas.current?.zoom(0.8)} title="Zoom out">
              −
            </button>
            <button onClick={() => canvas.current?.fit()} title="Fit">
              Fit
            </button>
          </div>
          <PlanCanvas
            ref={canvas}
            project={project}
            dispatch={ignore}
            tool={tool}
            setTool={(t) => setTool(t === 'select' ? t : 'select')}
            wallKind="interior"
            furnitureKind="toilet"
            selection={selection}
            setSelection={setSelection}
            onMessage={noop}
          />
        </main>
      ) : tab === '3d' ? (
        <main className="report-page full">
          <Suspense fallback={<p className="muted center">Loading 3D…</p>}>
            <View3D project={project} />
          </Suspense>
        </main>
      ) : (
        <main className="report-page">
          {/* A disabled fieldset turns off every control in the reports at once. */}
          <fieldset disabled className="read-only">
            {tab === 'framing' && <FramingView project={project} dispatch={ignore} />}
            {tab === 'materials' && <MaterialsView project={project} dispatch={ignore} />}
          </fieldset>
          {tab === 'code' && (
            <CodeView
              project={project}
              onSelect={(h) => {
                setSelection(h);
                setTab('plan');
              }}
            />
          )}
        </main>
      )}
    </div>
  );
}
