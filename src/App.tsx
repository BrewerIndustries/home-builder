import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { autoOutlets } from './calc/electrical.ts';
import { ircChecks } from './calc/irc.ts';
import type { Hit } from './editor/hitTest.ts';
import { Inspector } from './editor/Inspector.tsx';
import { PlanCanvas, type PlanCanvasHandle, type Tool } from './editor/PlanCanvas.tsx';
import { downloadJson, loadSaved, readProjectFile, readUnderlay, save } from './model/persist.ts';
import { historyReducer, initHistory } from './model/store.ts';
import { emptyProject, type WallKind } from './model/types.ts';
import { PrintSheet } from './views/PrintSheet.tsx';
import { CodeView, FramingView, MaterialsView } from './views/Reports.tsx';

type Tab = 'plan' | '3d' | 'framing' | 'materials' | 'code';

// three.js is most of the 3D tab's weight — load it only when the tab opens.
const View3D = lazy(() => import('./views/View3D.tsx'));

const TAB_LABEL: Record<Tab, string> = { plan: 'Plan', '3d': '3D', framing: 'Framing', materials: 'Estimate', code: 'Code check' };

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'v', icon: '↖' },
  { id: 'wall', label: 'Wall', key: 'w', icon: '▭' },
  { id: 'room', label: 'Room', key: 'r', icon: '▢' },
  { id: 'door', label: 'Door', key: 'd', icon: '◜' },
  { id: 'window', label: 'Window', key: 'n', icon: '▤' },
  { id: 'outlet', label: 'Outlet', key: 'o', icon: '⏀' },
];

export function App() {
  const [history, dispatch] = useReducer(historyReducer, undefined, () => initHistory(loadSaved()));
  const project = history.present;
  const [tab, setTab] = useState<Tab>('plan');
  const [tool, setTool] = useState<Tool>('select');
  const [wallKind, setWallKind] = useState<WallKind>(project.walls.length ? 'interior' : 'exterior');
  const [selection, setSelection] = useState<Hit | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canvas = useRef<PlanCanvasHandle>(null);
  const projectFile = useRef<HTMLInputElement>(null);
  const imageFile = useRef<HTMLInputElement>(null);

  // Autosave, debounced so drags don't hammer storage.
  useEffect(() => {
    const t = setTimeout(() => setSaveError(save(project)), 400);
    return () => clearTimeout(t);
  }, [project]);

  // Drop a stale selection after undo / delete.
  useEffect(() => {
    if (!selection) return;
    const lists = { wall: project.walls, opening: project.openings, room: project.rooms, outlet: project.outlets };
    if (!lists[selection.kind].some((x) => x.id === selection.id)) setSelection(null);
  }, [project, selection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        dispatch({ type: 'redo' });
        e.preventDefault();
        return;
      }
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        dispatch({ type: 'delete', ids: [selection.id] });
        setSelection(null);
        e.preventDefault();
        return;
      }
      if (tab !== 'plan' || (tool === 'wall' && /[0-9]/.test(e.key))) return;
      const match = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (match) setTool(match.id);
      if (e.key === 'f') canvas.current?.fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, tab, tool]);

  const fails = useMemo(() => ircChecks(project).filter((c) => c.status === 'fail').length, [project]);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }

  async function onImportProject(file: File | undefined) {
    if (!file) return;
    try {
      dispatch({ type: 'load', project: await readProjectFile(file) });
      setSelection(null);
      requestAnimationFrame(() => canvas.current?.fit());
    } catch (e) {
      flash((e as Error).message);
    }
  }

  async function onImportImage(file: File | undefined) {
    if (!file) return;
    try {
      setTab('plan');
      const at = canvas.current?.center() ?? { x: 300, y: 200 };
      dispatch({ type: 'setUnderlay', underlay: await readUnderlay(file, at) });
      setSelection(null);
      setTool('calibrate');
      requestAnimationFrame(() => canvas.current?.fit());
    } catch (e) {
      flash((e as Error).message);
    }
  }

  function runAutoOutlets() {
    if (!project.rooms.length) {
      flash('Draw rooms first — outlets are laid out per room.');
      return;
    }
    const outlets = autoOutlets(project);
    dispatch({ type: 'replaceAutoOutlets', outlets });
    flash(`Placed ${outlets.length} receptacles. Drag to adjust, or use the Outlet tool to add more.`);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🏠</div>
        <input className="project-name" value={project.name} onChange={(e) => dispatch({ type: 'rename', name: e.target.value })} aria-label="Project name" />
        <nav className="tabs">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
              {t === 'code' && fails > 0 && <span className="count">{fails}</span>}
            </button>
          ))}
        </nav>
        <div className="actions">
          <button onClick={() => dispatch({ type: 'undo' })} disabled={!history.past.length} title="Undo (⌘Z)">
            ↶
          </button>
          <button onClick={() => dispatch({ type: 'redo' })} disabled={!history.future.length} title="Redo (⇧⌘Z)">
            ↷
          </button>
          <button onClick={() => imageFile.current?.click()}>Import floorplan image</button>
          <button onClick={() => window.print()} disabled={!project.walls.length} title="Print or save as PDF — the Plan tab prints a to-scale sheet">
            Print / PDF
          </button>
          <details className="menu">
            <summary>File</summary>
            <div className="menu-body">
              <button
                onClick={() => {
                  if (confirm('Start a new, empty project? Export first if you want to keep this one.')) {
                    dispatch({ type: 'load', project: emptyProject() });
                    setWallKind('exterior');
                  }
                }}
              >
                New project
              </button>
              <button onClick={() => projectFile.current?.click()}>Open project file…</button>
              <button onClick={() => downloadJson(project)}>Save project file</button>
            </div>
          </details>
        </div>
        <input ref={projectFile} type="file" accept=".json,application/json" hidden onChange={(e) => (onImportProject(e.target.files?.[0]), (e.target.value = ''))} />
        <input ref={imageFile} type="file" accept="image/*" hidden onChange={(e) => (onImportImage(e.target.files?.[0]), (e.target.value = ''))} />
      </header>

      {saveError && <div className="banner error">{saveError}</div>}
      {notice && <div className="toast">{notice}</div>}

      {tab === 'plan' && <PrintSheet project={project} />}
      {tab === 'plan' ? (
        <main className="workspace">
          <div className="toolbar">
            {TOOLS.map((t) => (
              <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)} title={`${t.label} (${t.key.toUpperCase()})`}>
                <span className="icon">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
            <div className="sep" />
            <div className="seg" role="group" aria-label="New wall type">
              <button className={wallKind === 'exterior' ? 'active' : ''} onClick={() => setWallKind('exterior')} title="New walls and rooms are exterior">
                Ext
              </button>
              <button className={wallKind === 'interior' ? 'active' : ''} onClick={() => setWallKind('interior')} title="New walls and rooms are interior">
                Int
              </button>
            </div>
            <div className="sep" />
            <button onClick={runAutoOutlets} title="Lay out receptacles in every room per IRC E3901">
              <span className="icon">⚡</span>
              <span>Auto outlets</span>
            </button>
            <div className="spacer" />
            <button onClick={() => canvas.current?.zoom(1.25)} title="Zoom in">
              +
            </button>
            <button onClick={() => canvas.current?.zoom(0.8)} title="Zoom out">
              −
            </button>
            <button onClick={() => canvas.current?.fit()} title="Fit (F)">
              Fit
            </button>
          </div>
          <PlanCanvas
            ref={canvas}
            project={project}
            dispatch={dispatch}
            tool={tool}
            setTool={setTool}
            wallKind={wallKind}
            selection={selection}
            setSelection={setSelection}
            onRoomCreated={() => wallKind === 'exterior' && setWallKind('interior')}
          />
          <Inspector project={project} dispatch={dispatch} selection={selection} setSelection={setSelection} setTool={setTool} />
        </main>
      ) : tab === '3d' ? (
        <main className="report-page full">
          <Suspense fallback={<p className="muted center">Loading 3D…</p>}>
            <View3D project={project} />
          </Suspense>
        </main>
      ) : (
        <main className="report-page">
          {tab === 'framing' && <FramingView project={project} />}
          {tab === 'materials' && <MaterialsView project={project} dispatch={dispatch} />}
          {tab === 'code' && (
            <CodeView
              project={project}
              onSelect={(h) => {
                setSelection(h);
                setTool('select');
                setTab('plan');
              }}
            />
          )}
        </main>
      )}
    </div>
  );
}
