import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AccountDialog, ProjectsDialog } from './account/Dialogs.tsx';
import { useWorkspace } from './account/useWorkspace.ts';
import { PdfImport } from './editor/PdfImport.tsx';
import { openPdf } from './model/imaging.ts';
import { autoOutlets } from './calc/electrical.ts';
import { autoLighting } from './calc/lighting.ts';
import { ircChecks } from './calc/irc.ts';
import { siteChecks } from './calc/site.ts';
import type { Hit } from './editor/hitTest.ts';
import { Inspector } from './editor/Inspector.tsx';
import { PlanCanvas, type PlanCanvasHandle, type Tool } from './editor/PlanCanvas.tsx';
import { downloadJson, loadSaved, readProjectFile, readUnderlay, save } from './model/persist.ts';
import { historyReducer, initHistory } from './model/store.ts';
import type { WallKind } from './model/types.ts';
import { SiteView } from './site/SiteView.tsx';
import { PrintSheet } from './views/PrintSheet.tsx';
import { CodeView, FramingView, MaterialsView } from './views/Reports.tsx';

type Tab = 'plan' | 'site' | '3d' | 'framing' | 'materials' | 'code';

// three.js is most of the 3D tab's weight — load it only when the tab opens.
const View3D = lazy(() => import('./views/View3D.tsx'));

const TAB_LABEL: Record<Tab, string> = { plan: 'Plan', site: 'Site', '3d': '3D', framing: 'Framing', materials: 'Estimate', code: 'Code check' };

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'v', icon: '↖' },
  { id: 'wall', label: 'Wall', key: 'w', icon: '▭' },
  { id: 'room', label: 'Room', key: 'r', icon: '▢' },
  { id: 'door', label: 'Door', key: 'd', icon: '◜' },
  { id: 'window', label: 'Window', key: 'n', icon: '▤' },
  { id: 'outlet', label: 'Outlet', key: 'o', icon: '⏀' },
  { id: 'switch', label: 'Switch', key: 's', icon: 'S' },
  { id: 'light', label: 'Light', key: 'l', icon: '⊗' },
  { id: 'alarm', label: 'Alarm', key: 'a', icon: '◉' },
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
  const [dialog, setDialog] = useState<'projects' | 'account' | null>(null);
  const [pdf, setPdf] = useState<{ doc: Awaited<ReturnType<typeof openPdf>>; at: { x: number; y: number } } | null>(null);
  const [invite, setInvite] = useState(() => new URLSearchParams(location.search).get('invite') ?? undefined);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }, []);
  const ws = useWorkspace(project, dispatch, flash);

  // An invite link opens the sign-up form; drop the code from the address bar.
  useEffect(() => {
    if (!invite) return;
    setDialog('account');
    window.history.replaceState(null, '', location.pathname);
  }, [invite]);

  // Autosave, debounced so drags don't hammer storage.
  useEffect(() => {
    const t = setTimeout(() => setSaveError(save(project)), 400);
    return () => clearTimeout(t);
  }, [project]);

  // Drop a stale selection after undo / delete.
  useEffect(() => {
    if (!selection) return;
    const lists = { wall: project.walls, opening: project.openings, room: project.rooms, outlet: project.outlets, switch: project.switches, fixture: project.fixtures };
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection && tab === 'plan') {
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

  const fails = useMemo(() => [...ircChecks(project), ...siteChecks(project)].filter((c) => c.status === 'fail').length, [project]);

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
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        setPdf({ doc: await openPdf(file), at });
        return;
      }
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

  function runAutoLighting() {
    if (!project.rooms.length) {
      flash('Draw rooms first — lights and alarms are laid out per room.');
      return;
    }
    const { fixtures, switches } = autoLighting(project);
    dispatch({ type: 'replaceAutoLighting', fixtures, switches });
    const lights = fixtures.filter((f) => f.kind === 'light').length;
    flash(`Placed ${lights} lights, ${switches.length} switches and ${fixtures.length - lights} alarms. Drag to adjust.`);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🏠</div>
        <button className="projects-btn" onClick={() => setDialog('projects')} title="Your projects">
          ☰
        </button>
        <input className="project-name" value={project.name} onChange={(e) => dispatch({ type: 'rename', name: e.target.value })} aria-label="Project name" />
        <SyncChip ws={ws} />
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
          <button onClick={() => imageFile.current?.click()} title="A photo, scan or PDF of a floor plan to trace over">Import floorplan</button>
          <button onClick={() => window.print()} disabled={!project.walls.length} title="Print or save as PDF — the Plan tab prints a to-scale sheet">
            Print / PDF
          </button>
          <details className="menu">
            <summary>File</summary>
            <div className="menu-body">
              <button onClick={() => setDialog('projects')}>Projects…</button>
              <button onClick={() => projectFile.current?.click()}>Open project file…</button>
              <button onClick={() => downloadJson(project)}>Save project file</button>
            </div>
          </details>
          <button className="account-btn" onClick={() => setDialog('account')} title={ws.user ? ws.user.email : 'Sign in'}>
            {ws.user ? (ws.user.display_name || ws.user.email).slice(0, 1).toUpperCase() : 'Sign in'}
          </button>
        </div>
        <input ref={projectFile} type="file" accept=".json,application/json" hidden onChange={(e) => (onImportProject(e.target.files?.[0]), (e.target.value = ''))} />
        <input ref={imageFile} type="file" accept="image/*,application/pdf,.pdf" hidden onChange={(e) => (onImportImage(e.target.files?.[0]), (e.target.value = ''))} />
      </header>

      {saveError && <div className="banner error">{saveError}</div>}
      {ws.status === 'conflict' && (
        <div className="banner error">
          This project was changed on another device since you opened it.{' '}
          <button className="link" onClick={() => ws.resolveConflict('theirs')}>
            Load that version
          </button>{' '}
          ·{' '}
          <button className="link" onClick={() => ws.resolveConflict('mine')}>
            Keep mine (overwrite)
          </button>
        </div>
      )}
      {ws.status === 'error' && ws.syncError && <div className="banner error">Not saved to your account: {ws.syncError}</div>}
      {pdf && (
        <PdfImport
          doc={pdf.doc}
          at={pdf.at}
          onClose={() => setPdf(null)}
          onImport={(underlay, calibrated) => {
            dispatch({ type: 'setUnderlay', underlay });
            setPdf(null);
            setSelection(null);
            setTool(calibrated ? 'select' : 'calibrate');
            if (calibrated) flash('Placed at the drawing scale — check one known dimension, then trace over it.');
            requestAnimationFrame(() => canvas.current?.fit());
          }}
        />
      )}
      {dialog === 'projects' && <ProjectsDialog ws={ws} onClose={() => setDialog(null)} onSignIn={() => setDialog('account')} />}
      {dialog === 'account' && (
        <AccountDialog
          ws={ws}
          invite={invite}
          onClose={() => {
            setDialog(null);
            setInvite(undefined);
          }}
        />
      )}
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
            <button onClick={runAutoLighting} title="Lay out switched lights (IRC E3903) and smoke / CO alarms (R314, R315) in every room">
              <span className="icon">💡</span>
              <span>Auto lights</span>
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
      ) : tab === 'site' ? (
        <SiteView project={project} dispatch={dispatch} />
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

function SyncChip({ ws }: { ws: ReturnType<typeof useWorkspace> }) {
  if (ws.current.source === 'local') return <span className="sync-chip muted" title="Saved in this browser">This device</span>;
  const label = { idle: 'Account', pending: 'Saving…', saving: 'Saving…', saved: 'Saved', error: 'Not saved', conflict: 'Conflict' }[ws.status];
  return (
    <span className={`sync-chip ${ws.status === 'error' || ws.status === 'conflict' ? 'bad' : ''}`} title="Saved to your account">
      ☁ {label}
    </span>
  );
}
