import type { Dispatch, ReactNode } from 'react';
import { ceilingInfo } from '../calc/ceilings.ts';
import { narrowest } from '../calc/outline.ts';
import { BED_SIZES, FURNITURE, FURNITURE_KINDS, furnitureChecks, furnitureRoom, placeFurniture } from '../calc/furniture.ts';
import { guessRoom } from '../calc/roomGuess.ts';
import { frameWall, studCount } from '../calc/framing.ts';
import { netClearOpening } from '../calc/irc.ts';
import { exclusiveArea } from '../calc/regions.ts';
import { wallAreas } from '../calc/materials.ts';
import { roofOf } from '../calc/roof.ts';
import { foundationOf } from '../calc/foundation.ts';
import { dist, wallLength } from '../model/geometry.ts';
import { isLight, roomAt, switchRoom, switchWays } from '../calc/lighting.ts';
import { roomOutletCount } from '../calc/electrical.ts';
import { outletPosition } from './outletGeometry.ts';
import type { Action } from '../model/store.ts';
import {
  LUMBER_SIZES,
  RAFTER_SIZES,
  type RafterSize,
  type Roof,
  type RoofType,
  type Foundation,
  JOIST_SIZES,
  type JoistSize,
  studFor,
  uid,
  type Ceiling,
  type CeilingType,
  type LumberSize,
  type OutletKind,
  type FixtureKind,
  type Furniture,
  type SpaceUse,
  type CornerCabinet,
  type FurnitureKind,
  type Project,
  type Counter,
  type Cutout,
  type CutoutKind,
  type RoomType,
  type WindowStyle,
  type FrontSide,
} from '../model/types.ts';
import { formatFtIn, formatSqFt, parseFtIn } from '../model/units.ts';
import type { Hit } from './hitTest.ts';
import { AngleInput, LengthInput } from './LengthInput.tsx';
import { centrelineForFace, faceSpans, outerSides } from '../calc/faces.ts';
import { joinCandidates, rotateWall, splitPoint, wallAngle } from '../model/wallEdit.ts';
import { cornerCabinets, counterDir, counterLength, counterRoom, counterSpaces, CUTOUT_LABEL, CUTOUT_WIDTH, flipCounter, freeSpaces, KNEE_SPACE, MIN_COUNTER_SPACE, peninsulaJoin, seats, upperSpans } from '../calc/counters.ts';
import type { Tool } from './PlanCanvas.tsx';

interface Props {
  project: Project;
  dispatch: Dispatch<Action>;
  selection: Hit | null;
  setSelection(h: Hit | null): void;
  setTool(t: Tool): void;
}

const ROOM_TYPES: RoomType[] = ['bedroom', 'living', 'kitchen', 'bath', 'hall', 'garage', 'utility', 'other'];
const CEILINGS: { value: CeilingType; label: string }[] = [
  { value: 'flat', label: 'Flat' },
  { value: 'vaulted', label: 'Vaulted (single slope)' },
  { value: 'cathedral', label: 'Cathedral (ridge)' },
  { value: 'tray', label: 'Tray' },
  { value: 'coffered', label: 'Coffered' },
];

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Inspector({ project, dispatch, selection, setSelection, setTool }: Props) {
  const del = (id: string) => {
    dispatch({ type: 'delete', ids: [id] });
    setSelection(null);
  };

  if (selection?.kind === 'wall') {
    const w = project.walls.find((x) => x.id === selection.id);
    if (!w) return null;
    const f = frameWall(w, project);
    const def = w.kind === 'exterior' ? project.framing.exteriorStud : project.framing.interiorStud;
    const splitAt = splitPoint(project, w);
    const faces = faceSpans(project).filter((x) => x.wall.id === w.id);
    const outer = outerSides(project).get(w.id);
    const faceText = (side: 1 | -1) =>
      faces
        .filter((x) => x.side === side)
        .map((x) => formatFtIn(x.length))
        .join(' + ') || '—';
    // Faces you can type a length for: one unbroken piece on that side.
    const single = (side: 1 | -1) => {
      const mine = faces.filter((x) => x.side === side);
      return mine.length === 1 ? mine[0] : null;
    };
    const faceFields: { label: string; length: number; side: 1 | -1 }[] = [];
    if (outer) {
      const o = single(outer);
      const i = single(-outer as 1 | -1);
      if (o) faceFields.push({ label: 'Outside face', length: o.length, side: o.side });
      if (i) faceFields.push({ label: 'Inside face', length: i.length, side: i.side });
    } else {
      const [l, r] = [single(1), single(-1)];
      if (l && r && Math.abs(l.length - r.length) < 0.5) faceFields.push({ label: 'Face length', length: l.length, side: 1 });
    }
    const faceWord = project.dimFaces === 'framing' ? 'framing' : 'finished';
    return (
      <aside className="inspector">
        <h3>Wall W{project.walls.indexOf(w) + 1}</h3>
        <Field label="Type">
          <select value={w.kind} onChange={(e) => dispatch({ type: 'updateWall', id: w.id, patch: { kind: e.target.value as typeof w.kind } })}>
            <option value="exterior">Exterior (bearing)</option>
            <option value="interior">Interior (partition)</option>
          </select>
        </Field>
        <Field label="Studs" hint={`Finished thickness ${formatFtIn(w.thickness)}`}>
          <select
            value={w.stud ?? ''}
            onChange={(e) => dispatch({ type: 'updateWall', id: w.id, patch: { stud: (e.target.value || undefined) as LumberSize | undefined } })}
          >
            <option value="">Default for {w.kind} ({def})</option>
            {LUMBER_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Length" hint={`Centreline. Faces: ${outer ? `outside ${faceText(outer)}, inside ${faceText(-outer as 1 | -1)}` : `${faceText(1)} / ${faceText(-1)}`}`}>
          <LengthInput value={wallLength(w)} min={1} onChange={(v) => dispatch({ type: 'setWallLength', id: w.id, length: v })} />
        </Field>
        {faceFields.map((f) => (
          <Field key={f.label} label={f.label} hint={`To the ${faceWord} face. Typing here moves the wall's end like the centreline length does.`}>
            <LengthInput
              value={f.length}
              min={1}
              onChange={(v) => {
                const length = centrelineForFace(project, w.id, f.side, v);
                if (length) dispatch({ type: 'setWallLength', id: w.id, length });
              }}
            />
          </Field>
        ))}
        <Field label="Angle" hint="0° points right, 90° up the plan. Turns about the start, keeping the length — or Alt-drag an end to swing it round the other (15° steps, Shift = any angle).">
          <div className="row">
            <AngleInput value={wallAngle(w)} onChange={(v) => dispatch({ type: 'moveVertex', ...rotateWall(w, v, 'a') })} />
            <button title="Turn 90° anticlockwise about the start" onClick={() => dispatch({ type: 'moveVertex', ...rotateWall(w, wallAngle(w) + 90, 'a') })}>
              ⟲ 90°
            </button>
            <button title="Turn 90° clockwise about the start" onClick={() => dispatch({ type: 'moveVertex', ...rotateWall(w, wallAngle(w) - 90, 'a') })}>
              ⟳ 90°
            </button>
          </div>
        </Field>
        <Field label="Wall height" hint="Plate to plate. 97-1/8&quot; = standard 8' wall">
          <LengthInput value={w.height} min={24} onChange={(v) => dispatch({ type: 'updateWall', id: w.id, patch: { height: v } })} />
        </Field>
        <div className="stat-grid">
          <Stat label="Studs" value={studCount(f)} />
          <Stat label="Stud cut" value={formatFtIn(f.studLength)} />
          <Stat label="Headers" value={f.headers.map((h) => h.size).join(', ') || '—'} />
        </div>
        {f.notes.map((n) => (
          <p key={n} className="warn-text">
            {n}
          </p>
        ))}
        <div className="row">
          <button
            disabled={splitAt === null}
            title={splitAt === null ? 'Too short, or openings leave no room for a split' : `Two walls meeting ${formatFtIn(splitAt)} from the start`}
            onClick={() => {
              if (splitAt === null) return;
              const newId = uid('w');
              dispatch({ type: 'splitWall', id: w.id, at: splitAt, newId });
              setSelection({ kind: 'wall', id: newId });
            }}
          >
            Split in two
          </button>
          {joinCandidates(project, w).map((o) => (
            <button key={o.id} onClick={() => dispatch({ type: 'joinWalls', id: w.id, otherId: o.id })} title="Merge into one straight wall; openings and outlets stay put">
              Join W{project.walls.indexOf(o) + 1}
            </button>
          ))}
        </div>
        <button className="danger" onClick={() => del(w.id)}>
          Delete wall
        </button>
      </aside>
    );
  }

  if (selection?.kind === 'opening') {
    const o = project.openings.find((x) => x.id === selection.id);
    if (!o) return null;
    const up = (patch: Partial<typeof o>) => dispatch({ type: 'updateOpening', id: o.id, patch });
    const nc = o.kind === 'window' ? netClearOpening(o) : null;
    return (
      <aside className="inspector">
        <h3>{o.kind === 'door' ? 'Door' : 'Window'}</h3>
        <Field label="Width">
          <LengthInput value={o.width} min={12} onChange={(v) => up({ width: v })} />
        </Field>
        <Field label="Height">
          <LengthInput value={o.height} min={12} onChange={(v) => up({ height: v })} />
        </Field>
        {o.kind === 'window' && (
          <>
            <Field label="Sill height">
              <LengthInput value={o.sill} onChange={(v) => up({ sill: v })} />
            </Field>
            <Field label="Operation" hint={nc ? `Est. net clear ${(nc.area).toFixed(1)} sq ft (${formatFtIn(nc.width)} × ${formatFtIn(nc.height)})` : undefined}>
              <select value={o.style ?? 'single-hung'} onChange={(e) => up({ style: e.target.value as WindowStyle })}>
                <option value="single-hung">Single / double hung</option>
                <option value="slider">Slider</option>
                <option value="casement">Casement</option>
                <option value="fixed">Fixed</option>
              </select>
            </Field>
          </>
        )}
        <Field label="Centre from wall start">
          <LengthInput value={o.offset} onChange={(v) => up({ offset: v })} />
        </Field>
        {o.kind === 'door' && (
          <div className="row">
            <button onClick={() => up({ swing: { side: (o.swing?.side ?? 1) === 1 ? -1 : 1, hinge: o.swing?.hinge ?? 'a' } })}>Flip swing side</button>
            <button onClick={() => up({ swing: { side: o.swing?.side ?? 1, hinge: (o.swing?.hinge ?? 'a') === 'a' ? 'b' : 'a' } })}>Flip hinge</button>
          </div>
        )}
        <button className="danger" onClick={() => del(o.id)}>
          Delete {o.kind}
        </button>
      </aside>
    );
  }

  if (selection?.kind === 'outlet') {
    const o = project.outlets.find((x) => x.id === selection.id);
    if (!o) return null;
    const up = (patch: Partial<typeof o>) => dispatch({ type: 'updateOutlet', id: o.id, patch: { ...patch, auto: false } });
    return (
      <aside className="inspector">
        <h3>Receptacle {o.auto && <span className="badge">auto</span>}</h3>
        <Field label="Type">
          <select value={o.kind} onChange={(e) => up({ kind: e.target.value as OutletKind })}>
            <option value="duplex">Duplex 15A</option>
            <option value="gfci">GFCI 20A</option>
            <option value="dedicated">Dedicated 20A</option>
            <option value="240v">240V</option>
          </select>
        </Field>
        <Field label="Height to centre">
          <LengthInput value={o.height} onChange={(v) => up({ height: v })} />
        </Field>
        <button onClick={() => up({ side: o.side === 1 ? -1 : 1 })}>Move to other face of wall</button>
        <p className="muted small">Drag it along the wall to move it. Editing an auto-placed receptacle keeps it when you re-run auto-layout.</p>
        <button className="danger" onClick={() => del(o.id)}>
          Delete receptacle
        </button>
      </aside>
    );
  }

  if (selection?.kind === 'switch') {
    const sw = project.switches.find((x) => x.id === selection.id);
    const w = sw && project.walls.find((x) => x.id === sw.wallId);
    if (!sw || !w) return null;
    const up = (patch: Partial<typeof sw>) => dispatch({ type: 'updateSwitch', id: sw.id, patch: { ...patch, auto: false } });
    const at = outletPosition(w, sw);
    const ways = switchWays(project).get(sw.id) ?? 1;
    // Nearest lights first; the ones it already runs always show.
    const lights = project.fixtures
      .filter((f) => isLight(f.kind))
      .map((f) => ({ f, d: dist(f.at, at), room: roomAt(project, f.at) }))
      .sort((a, b) => a.d - b.d)
      .filter((x, i) => i < 8 || sw.controls.includes(x.f.id));
    // Receptacles in the switch's room (any it already runs always show).
    const home = switchRoom(project, sw);
    const walls = new Map(project.walls.map((x) => [x.id, x]));
    const receptacles = project.outlets
      .map((o) => ({ o, d: dist(outletPosition(walls.get(o.wallId)!, o), at) }))
      .filter(({ o }) => walls.has(o.wallId) && (sw.controls.includes(o.id) || (home && roomOutletCount({ ...project, outlets: [o] }, home) > 0)))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
    return (
      <aside className="inspector">
        <h3>
          Switch {ways > 1 && <span className="badge">{ways}-way</span>} {sw.auto && <span className="badge">auto</span>}
        </h3>
        <div className="field">
          <span>Controls</span>
          <div className="link-list">
            {lights.length ? (
              lights.map(({ f, d, room }) => (
                <label key={f.id} className="link-row">
                  <input
                    type="checkbox"
                    checked={sw.controls.includes(f.id)}
                    onChange={(e) => up({ controls: e.target.checked ? [...sw.controls, f.id] : sw.controls.filter((c) => c !== f.id) })}
                  />
                  {f.kind === 'fan' ? 'Fan' : f.kind === 'outdoor' ? 'Outside light' : 'Light'}
                  {room?.name ? ` · ${room.name}` : ''} <span className="muted">· {formatFtIn(d, { compact: true })} away</span>
                </label>
              ))
            ) : (
              <span className="muted small">No lights yet — add one with the Light tool.</span>
            )}
          </div>
          <small className="muted">Tick every light this switch runs. Two switches on one light make a 3-way pair.</small>
        </div>
        {receptacles.length > 0 && (
          <div className="field">
            <span>Switched receptacles</span>
            <div className="link-list">
              {receptacles.map(({ o, d }) => (
                <label key={o.id} className="link-row">
                  <input
                    type="checkbox"
                    checked={sw.controls.includes(o.id)}
                    onChange={(e) => {
                      // A receptacle a switch runs is the user's now: re-running Auto outlets keeps it.
                      if (o.auto) dispatch({ type: 'updateOutlet', id: o.id, patch: { auto: false } });
                      up({ controls: e.target.checked ? [...sw.controls, o.id] : sw.controls.filter((c) => c !== o.id) });
                    }}
                  />
                  Receptacle <span className="muted">· {formatFtIn(d, { compact: true })} away</span>
                </label>
              ))}
            </div>
            <small className="muted">In bedrooms, living rooms and other rooms (not kitchens, baths, halls or garages) a switched receptacle can stand in for the ceiling light (E3903.2).</small>
          </div>
        )}
        <Field label="Height to centre">
          <LengthInput value={sw.height} onChange={(v) => up({ height: v })} />
        </Field>
        <button onClick={() => up({ side: sw.side === 1 ? -1 : 1 })}>Move to other face of wall</button>
        <button className="danger" onClick={() => del(sw.id)}>
          Delete switch
        </button>
      </aside>
    );
  }

  if (selection?.kind === 'fixture') {
    const f = project.fixtures.find((x) => x.id === selection.id);
    if (!f) return null;
    const room = roomAt(project, f.at);
    const by = project.switches.filter((s) => s.controls.includes(f.id)).length;
    return (
      <aside className="inspector">
        <h3>
          {f.kind === 'light' ? 'Ceiling light' : f.kind === 'fan' ? 'Ceiling fan' : f.kind === 'outdoor' ? 'Exterior light' : 'Alarm'} {f.auto && <span className="badge">auto</span>}
        </h3>
        <Field label="Type">
          <select value={f.kind} onChange={(e) => dispatch({ type: 'updateFixture', id: f.id, patch: { kind: e.target.value as FixtureKind, auto: false } })}>
            <option value="light">Lighting outlet</option>
            <option value="fan">Ceiling fan</option>
            <option value="outdoor">Exterior wall light</option>
            <option value="smoke">Smoke alarm</option>
            <option value="smoke-co">Smoke / CO alarm</option>
            <option value="co">CO alarm</option>
          </select>
        </Field>
        {f.kind === 'fan' && (
          <label className="link-row">
            <input type="checkbox" checked={f.lightKit !== false} onChange={(e) => dispatch({ type: 'updateFixture', id: f.id, patch: { lightKit: e.target.checked ? undefined : false, auto: false } })} />
            Light kit {f.lightKit === false && <span className="muted small">— fan only: not the room's lighting outlet</span>}
          </label>
        )}
        <p className="muted small">
          {room ? `In ${room.name || room.type}. ` : 'Not inside a room. '}
          {isLight(f.kind) && (by ? `Switched from ${by} place${by > 1 ? 's' : ''}.` : 'No switch yet — select a switch and tick this light.')}
        </p>
        <p className="muted small">Drag it to move. Edited auto items are kept when you re-run Auto lights.</p>
        <button className="danger" onClick={() => del(f.id)}>
          Delete {f.kind === 'fan' ? 'fan' : isLight(f.kind) ? 'light' : 'alarm'}
        </button>
      </aside>
    );
  }

  if (selection?.kind === 'counter') {
    const c = project.counters.find((x) => x.id === selection.id);
    if (!c) return null;
    const len = counterLength(c);
    const up = (patch: Partial<Counter>) => dispatch({ type: 'updateCounter', id: c.id, patch });
    const setLength = (v: number) => {
      const d = counterDir(c);
      up({ b: { x: c.a.x + d.x * v, y: c.a.y + d.y * v } });
    };
    const setCutout = (id: string, patch: Partial<Cutout>) => up({ cutouts: c.cutouts.map((k) => (k.id === id ? { ...k, ...patch } : k)) });
    const addCutout = (kind: CutoutKind) => up({ cutouts: [...c.cutouts, { id: uid('cx'), kind, offset: len / 2, width: CUTOUT_WIDTH[kind] }] });
    const room = counterRoom(project, c);
    const corners = cornerCabinets(project).filter((k) => k.a.id === c.id || k.b.id === c.id);
    const spaces = (c.island ? freeSpaces(project, c) : counterSpaces(c)).filter(([s, e]) => e - s >= MIN_COUNTER_SPACE).length;
    return (
      <aside className="inspector">
        <h3>{c.island ? (peninsulaJoin(project, c) ? 'Peninsula' : 'Island') : 'Counter'}</h3>
        <Field label="Length">
          <LengthInput value={len} min={MIN_COUNTER_SPACE} onChange={setLength} />
        </Field>
        <Field label="Depth" hint={c.island ? undefined : '25" = 24" base cabinet + 1" overhang'}>
          <LengthInput value={c.depth} min={MIN_COUNTER_SPACE} onChange={(v) => up({ depth: v })} />
        </Field>
        {c.cutouts.map((k) => (
          <div key={k.id} className="field">
            <span>{CUTOUT_LABEL[k.kind]} — centre from the start, width</span>
            <div className="row">
              <LengthInput value={k.offset} min={0} onChange={(v) => setCutout(k.id, { offset: v })} />
              <LengthInput value={k.width} min={12} onChange={(v) => setCutout(k.id, { width: v })} />
              <button className="link danger" onClick={() => up({ cutouts: c.cutouts.filter((x) => x.id !== k.id) })} title="Remove">
                ×
              </button>
            </div>
          </div>
        ))}
        {!c.island && (
          <label className="link-row">
            <input type="checkbox" checked={c.uppers !== false} onChange={(e) => up({ uppers: e.target.checked })} /> Wall cabinets above
            {c.uppers !== false && (
              <span className="muted"> · {formatFtIn(upperSpans(project, c).reduce((s, [a, b]) => s + b - a, 0), { compact: true })}, skipping windows and the range hood</span>
            )}
          </label>
        )}
        <div className="row wrap">
          <button onClick={() => addCutout('sink')}>Add sink</button>
          <button onClick={() => addCutout('range')}>Add range</button>
          <button onClick={() => addCutout('dishwasher')}>Add dishwasher</button>
          <button onClick={() => addCutout('fridge')}>Add fridge</button>
          <button onClick={() => addCutout('pantry')} title="Full-height pantry cabinet: no countertop or wall cabinets there">Add tall pantry</button>
          <button onClick={() => addCutout('oven')} title="Full-height wall-oven cabinet">Add wall oven</button>
        </div>
        {corners.map((k) => {
          const other = k.a.id === c.id ? k.b : k.a;
          // Both counters at a corner show the choice. It's stored on whichever already has it, else on the one with
          // fewer corners (a U's middle run meets two, so its ends hold their own choice).
          const count = (id: string) => cornerCabinets(project).filter((x) => x.a.id === id || x.b.id === id).length;
          const owner = k.a.corner ? k.a : k.b.corner ? k.b : count(other.id) < count(c.id) ? other : c;
          return (
            <Field key={other.id} label={`Corner with the ${other.island ? 'peninsula' : 'counter'}`} hint="One corner base cabinet, priced on its own">
              <select value={k.kind} onChange={(e) => dispatch({ type: 'updateCounter', id: owner.id, patch: { corner: e.target.value as CornerCabinet } })}>
                <option value="lazy-susan">Lazy susan</option>
                <option value="blind">Blind corner</option>
              </select>
            </Field>
          );
        })}
        {c.island && (
          <>
            <Field label="Seating overhang" hint={`Knee space at the front, no cabinets under; ${KNEE_SPACE}" suits a 36" counter (NKBA). 0 = no seating`}>
              <LengthInput value={c.seating ?? 0} min={0} onChange={(v) => up({ seating: v > 0 ? Math.min(v, c.depth - MIN_COUNTER_SPACE) : undefined })} />
            </Field>
            {(c.seating ?? 0) > 0 && (
              <p className="muted small">
                {seats(project, c).length} seat{seats(project, c).length === 1 ? '' : 's'} at 24" each.{' '}
                <button className="link" onClick={() => up(flipCounter(c))}>
                  Seats on the other side
                </button>
              </p>
            )}
          </>
        )}
        <div className="stat-grid">
          <Stat label="Countertop" value={`${Math.round((len * c.depth) / 144)} sq ft`} />
          <Stat label="Counter spaces" value={spaces} />
        </div>
        <p className="muted small">
          {room ? `In ${room.name || room.type}${room.type === 'kitchen' ? '' : ' — set the room to Kitchen for the countertop receptacle rules'}. ` : 'Not inside a room. '}
          {c.island ? 'Drag to move. Island receptacles are counted from its spaces.' : 'Drag to slide it along the wall. Run Auto outlets to place countertop receptacles.'}
        </p>
        <button className="danger" onClick={() => del(c.id)}>
          Delete {c.island ? 'island' : 'counter'}
        </button>
      </aside>
    );
  }

  if (selection?.kind === 'furniture') {
    const f = project.furniture.find((x) => x.id === selection.id);
    if (!f) return null;
    const spec = FURNITURE[f.kind];
    const up = (patch: Partial<Furniture>) => dispatch({ type: 'updateFurniture', id: f.id, patch });
    const room = furnitureRoom(project, f);
    const checks = furnitureChecks(project).filter((c) => c.targetId === f.id);
    const bed = BED_SIZES.find(([, w, d]) => w === f.w && d === f.d)?.[0] ?? '';
    return (
      <aside className="inspector">
        <h3>{spec.label}</h3>
        <Field label="Type">
          <select value={f.kind} onChange={(e) => up({ kind: e.target.value as FurnitureKind, w: FURNITURE[e.target.value as FurnitureKind].w, d: FURNITURE[e.target.value as FurnitureKind].d })}>
            {FURNITURE_KINDS.map((k) => (
              <option key={k} value={k}>
                {FURNITURE[k].label}
              </option>
            ))}
          </select>
        </Field>
        {f.kind === 'bed' && (
          <Field label="Size">
            <select value={bed} onChange={(e) => {
              const size = BED_SIZES.find(([n]) => n === e.target.value);
              if (size) up({ w: size[1], d: size[2] });
            }}>
              {!bed && <option value="">Custom</option>}
              {BED_SIZES.map(([n, w, d]) => (
                <option key={n} value={n}>
                  {n} ({w}" × {d}")
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Width">
          <LengthInput value={f.w} min={6} onChange={(v) => up({ w: v })} />
        </Field>
        <Field label="Depth" hint={f.kind === 'stairs' ? 'The run, from the foot (on this floor) to the far end' : 'Front to back'}>
          <LengthInput value={f.d} min={6} onChange={(v) => up({ d: v })} />
        </Field>
        {f.kind === 'stairs' && (
          <>
            <Field label="Risers" hint="Six or more: a light switch at each floor level (E3903.3)">
              <input type="number" min={1} max={30} value={f.risers ?? 13} onChange={(e) => up({ risers: Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 1))) })} />
            </Field>
            <Field label="Goes">
              <select value={f.down ? 'down' : 'up'} onChange={(e) => up({ down: e.target.value === 'down' ? true : undefined })}>
                <option value="up">Up from this floor</option>
                <option value="down">Down from this floor</option>
              </select>
            </Field>
          </>
        )}
        <div className="row wrap">
          <button onClick={() => up({ rot: (f.rot + 270) % 360 })} title="Turn 90° anticlockwise">
            ⟲ 90°
          </button>
          <button onClick={() => up({ rot: (f.rot + 90) % 360 })} title="Turn 90° clockwise">
            ⟳ 90°
          </button>
          <button onClick={() => up(placeFurniture(project, f, f.at))} title="Back it flat against the nearest wall">
            Against wall
          </button>
        </div>
        {checks.map((c, i) => (
          <p key={i} className={`small check-${c.status}`}>
            {c.status === 'pass' ? '✓' : '✗'} {c.section}: {c.message}
          </p>
        ))}
        <p className="muted small">
          {room ? `In ${room.name || room.type}. ` : 'Not inside a room. '}
          {spec.fixture ? 'Priced in the estimate; ' : 'Drawn on the plan and in 3D only; '}drag to move — it backs onto the wall you drop it by (Shift keeps it free-standing).
        </p>
        <button className="danger" onClick={() => del(f.id)}>
          Delete {spec.label.toLowerCase()}
        </button>
      </aside>
    );
  }

  if (selection?.kind === 'room') {
    const r = project.rooms.find((x) => x.id === selection.id);
    if (!r) return null;
    const c: Ceiling = r.ceiling ?? { type: 'flat' };
    const info = ceilingInfo(project, r);
    const narrow = narrowest(r.points);
    const setCeiling = (patch: Partial<Ceiling>) => dispatch({ type: 'updateRoom', id: r.id, patch: { ceiling: { ...c, ...patch } } });
    return (
      <aside className="inspector">
        <h3>Room</h3>
        <Field label="Name">
          <input value={r.name} onChange={(e) => dispatch({ type: 'updateRoom', id: r.id, patch: { name: e.target.value } })} />
        </Field>
        <Field label="Use" hint="Drives code checks and outlet layout">
          <select value={r.type} onChange={(e) => dispatch({ type: 'updateRoom', id: r.id, patch: { type: e.target.value as RoomType } })}>
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <div className="row">
          <button title="Garage, kitchen, closet, hall, bath, living or bedroom, from the size, doors and counters" onClick={() => dispatch({ type: 'updateRoom', id: r.id, patch: guessRoom(project, r) })}>
            Guess name &amp; use
          </button>
        </div>
        <div className="stat-grid">
          <Stat label="Floor" value={formatSqFt(exclusiveArea(project, r))} />
          {narrow && <Stat label="Narrowest" value={formatFtIn(narrow.width)} />}
          <Stat label="Ceiling surface" value={formatSqFt(info.surface)} />
        </div>
        <h4>Ceiling</h4>
        <Field label="Style">
          <select value={c.type} onChange={(e) => setCeiling({ type: e.target.value as CeilingType })}>
            {CEILINGS.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={c.type === 'vaulted' || c.type === 'cathedral' ? 'Low side height' : 'Ceiling height'} hint="Blank = wall height">
          <LengthInput value={c.height ?? info.low + (c.type === 'coffered' ? c.cofferDepth ?? 8 : 0)} min={48} onChange={(v) => setCeiling({ height: v })} />
        </Field>
        {(c.type === 'vaulted' || c.type === 'cathedral') && (
          <Field label={c.type === 'vaulted' ? 'High side height' : 'Ridge height'}>
            <LengthInput value={info.high} min={info.low} onChange={(v) => setCeiling({ peak: v })} />
          </Field>
        )}
        {c.type === 'tray' && (
          <>
            <Field label="Tray depth">
              <LengthInput value={c.trayDepth ?? 12} min={2} onChange={(v) => setCeiling({ trayDepth: v })} />
            </Field>
            <Field label="Inset from walls">
              <LengthInput value={c.trayInset ?? 24} min={6} onChange={(v) => setCeiling({ trayInset: v })} />
            </Field>
          </>
        )}
        {c.type === 'coffered' && (
          <>
            <Field label="Beam grid spacing">
              <LengthInput value={c.cofferSpacing ?? 48} min={24} onChange={(v) => setCeiling({ cofferSpacing: v })} />
            </Field>
            <Field label="Beam depth">
              <LengthInput value={c.cofferDepth ?? 8} min={2} onChange={(v) => setCeiling({ cofferDepth: v })} />
            </Field>
          </>
        )}
        <p className="muted small">{info.label}</p>
        <button className="danger" onClick={() => del(r.id)}>
          Delete room label (keeps walls)
        </button>
      </aside>
    );
  }

  // Nothing selected: project summary + defaults.
  const areas = wallAreas(project);
  const fr = project.framing;
  const u = project.underlay;
  const extLF = project.walls.filter((w) => w.kind === 'exterior').reduce((s, w) => s + wallLength(w), 0);
  return (
    <aside className="inspector">
      <h3>Project</h3>
      <div className="stat-grid">
        <Stat label="Floor area" value={`${Math.round(areas.floor).toLocaleString()} sq ft`} />
        <Stat label="Exterior walls" value={`${Math.round(extLF / 12)} LF`} />
        <Stat label="Rooms" value={project.rooms.length} />
        <Stat label="Receptacles" value={project.outlets.length} />
        <Stat label="Lights / alarms" value={`${project.fixtures.filter((f) => isLight(f.kind)).length} / ${project.fixtures.filter((f) => !isLight(f.kind)).length}`} />
      </div>

      <h4>Wall defaults</h4>
      <Field label="Exterior studs">
        <select value={fr.exteriorStud} onChange={(e) => dispatch({ type: 'setFraming', patch: { exteriorStud: e.target.value as LumberSize } })}>
          {LUMBER_SIZES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="Interior studs">
        <select value={fr.interiorStud} onChange={(e) => dispatch({ type: 'setFraming', patch: { interiorStud: e.target.value as LumberSize } })}>
          {LUMBER_SIZES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="Stud spacing">
        <select value={fr.studSpacing} onChange={(e) => dispatch({ type: 'setFraming', patch: { studSpacing: Number(e.target.value) as 16 | 24 } })}>
          <option value={16}>16" o.c.</option>
          <option value={24}>24" o.c.</option>
        </select>
      </Field>
      <Field label="New wall height">
        <LengthInput value={fr.wallHeight} min={24} onChange={(v) => dispatch({ type: 'setFraming', patch: { wallHeight: v } })} />
      </Field>
      {project.walls.some((w) => w.height !== fr.wallHeight) && (
        <button
          onClick={() => {
            dispatch({ type: 'checkpoint' });
            for (const w of project.walls) dispatch({ type: 'updateWall', id: w.id, patch: { height: fr.wallHeight } });
          }}
        >
          Apply {formatFtIn(fr.wallHeight)} to every wall
        </button>
      )}
      <Field label="Waste allowance">
        <select value={fr.waste} onChange={(e) => dispatch({ type: 'setFraming', patch: { waste: Number(e.target.value) } })}>
          {[0, 0.05, 0.1, 0.15, 0.2].map((w) => (
            <option key={w} value={w}>
              {Math.round(w * 100)}%
            </option>
          ))}
        </select>
      </Field>
      <p className="muted small">Mixed walls? Select a wall to give it its own stud size or height.</p>
      {project.walls.some((w) => w.stud && w.stud !== (w.kind === 'exterior' ? fr.exteriorStud : fr.interiorStud)) && (
        <p className="muted small">
          {project.walls.filter((w) => w.stud).length} wall(s) override the default ({[...new Set(project.walls.map((w) => studFor(w, fr)))].join(', ')} in use).
        </p>
      )}

      <Field label="Dimension faces" hint="What inside / outside dimensions measure to: the drywall and sheathing, or the studs 1/2&quot; inside them">
        <select value={project.dimFaces ?? 'finished'} onChange={(e) => dispatch({ type: 'setDimFaces', faces: e.target.value as 'finished' | 'framing' })}>
          <option value="finished">Finished faces</option>
          <option value="framing">Framing (stud) faces</option>
        </select>
      </Field>

      <h4>Electrical</h4>
      <Field label="Fuel-burning appliances" hint="Gas or oil furnace, water heater or range, or a fireplace — CO alarms follow from this (R315)">
        <select
          value={project.electrical?.fuelAppliances === undefined ? '' : project.electrical.fuelAppliances ? 'yes' : 'no'}
          onChange={(e) => dispatch({ type: 'setElectrical', patch: { fuelAppliances: e.target.value === '' ? undefined : e.target.value === 'yes' } })}
        >
          <option value="">Not answered</option>
          <option value="yes">Yes</option>
          <option value="no">No — all electric</option>
        </select>
      </Field>
      <Field label="Front of the house" hint="The plan side facing the street — outdoor receptacles go front and back (E3901.7)">
        <select value={project.electrical?.front ?? 'bottom'} onChange={(e) => dispatch({ type: 'setElectrical', patch: { front: e.target.value as FrontSide } })}>
          <option value="bottom">Bottom of the plan</option>
          <option value="top">Top of the plan</option>
          <option value="left">Left of the plan</option>
          <option value="right">Right of the plan</option>
        </select>
      </Field>

      {roofOf(project).type !== 'none' && (
        <Field label="Attic used for" hint="Storage, or equipment that needs servicing (furnace, air handler) — then it needs a light switched at the access (E3903.4)">
          <SpaceUseSelect value={project.electrical?.attic} set={(attic) => dispatch({ type: 'setElectrical', patch: { attic } })} />
        </Field>
      )}
      {foundationOf(project).type === 'crawl' && (
        <Field label="Crawlspace used for" hint="Storage, or equipment that needs servicing — then it needs a light switched at the access (E3903.4)">
          <SpaceUseSelect value={project.electrical?.crawl} set={(crawl) => dispatch({ type: 'setElectrical', patch: { crawl } })} />
        </Field>
      )}

      <RoofFields roof={roofOf(project)} set={(patch) => dispatch({ type: 'setRoof', patch })} />
      <FoundationFields f={foundationOf(project)} set={(patch) => dispatch({ type: 'setFoundation', patch })} />

      {u && (
        <>
          <h4>Floorplan image</h4>
          <Field label={`Opacity ${Math.round(u.opacity * 100)}%`}>
            <input type="range" min={0.1} max={1} step={0.05} value={u.opacity} onChange={(e) => dispatch({ type: 'updateUnderlay', patch: { opacity: Number(e.target.value) }, transient: true })} />
          </Field>
          <div className="row">
            <button onClick={() => setTool('calibrate')}>Calibrate scale</button>
            <button onClick={() => setTool('straighten')} title="Fix a photo taken at an angle">
              Straighten
            </button>
            <button onClick={() => setTool('moveImage')}>Move</button>
          </div>
          <div className="row">
            <button onClick={() => dispatch({ type: 'updateUnderlay', patch: { visible: !u.visible } })}>{u.visible ? 'Hide' : 'Show'}</button>
            <button className="danger" onClick={() => dispatch({ type: 'setUnderlay', underlay: undefined })}>
              Remove
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

const ROOF_TYPES: { value: RoofType; label: string }[] = [
  { value: 'gable', label: 'Gable' },
  { value: 'hip', label: 'Hip' },
  { value: 'shed', label: 'Shed' },
  { value: 'none', label: 'None' },
];

function FoundationFields({ f, set }: { f: Foundation; set(patch: Partial<Foundation>): void }) {
  return (
    <>
      <h4>Foundation</h4>
      <Field label="Type">
        <select value={f.type} onChange={(e) => set({ type: e.target.value as Foundation['type'], footingDepth: e.target.value === 'crawl' ? Math.max(f.footingDepth, 24) : f.footingDepth })}>
          <option value="slab">Slab on grade (thickened edge)</option>
          <option value="crawl">Crawlspace (footing + stem wall)</option>
          <option value="none">None / not in this estimate</option>
        </select>
      </Field>
      {f.type === 'slab' && (
        <div className="row">
          <Field label="Slab">
            <LengthInput value={f.slabThickness} min={1} onChange={(v) => set({ slabThickness: v })} />
          </Field>
          <Field label="Edge width">
            <LengthInput value={f.edgeWidth} min={1} onChange={(v) => set({ edgeWidth: v })} />
          </Field>
          <Field label="Edge depth">
            <LengthInput value={f.edgeDepth} min={1} onChange={(v) => set({ edgeDepth: v })} />
          </Field>
        </div>
      )}
      {f.type === 'crawl' && (
        <>
          <div className="row">
            <Field label="Footing width">
              <LengthInput value={f.footingWidth} min={1} onChange={(v) => set({ footingWidth: v })} />
            </Field>
            <Field label="Footing thick">
              <LengthInput value={f.footingThickness} min={1} onChange={(v) => set({ footingThickness: v })} />
            </Field>
          </div>
          <div className="row">
            <Field label="Stem height">
              <LengthInput value={f.stemHeight} min={1} onChange={(v) => set({ stemHeight: v })} />
            </Field>
            <Field label="Stem">
              <select value={f.stemMaterial} onChange={(e) => set({ stemMaterial: e.target.value as Foundation['stemMaterial'], stemThickness: e.target.value === 'cmu' ? 7.625 : 8 })}>
                <option value="poured">Poured 8"</option>
                <option value="cmu">8" block</option>
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="Floor joists">
              <select value={f.joistSize} onChange={(e) => set({ joistSize: e.target.value as JoistSize })}>
                {JOIST_SIZES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Spacing">
              <select value={f.joistSpacing} onChange={(e) => set({ joistSpacing: Number(e.target.value) as Foundation['joistSpacing'] })}>
                {[12, 16, 19.2, 24].map((s) => (
                  <option key={s} value={s}>
                    {s}" o.c.
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="Joists run">
              <select value={f.joistDir} onChange={(e) => set({ joistDir: e.target.value as Foundation['joistDir'] })}>
                <option value="auto">Across the short side</option>
                <option value="x">Left–right</option>
                <option value="y">Top–bottom</option>
              </select>
            </Field>
            <Field label="Girder lines">
              <select value={String(f.girders)} onChange={(e) => set({ girders: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })}>
                <option value="auto">Auto (spans ≤ 12')</option>
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="Piers o.c.">
              <LengthInput value={f.pierSpacing} min={24} onChange={(v) => set({ pierSpacing: v })} />
            </Field>
            <Field label="Subfloor">
              <select value={f.subfloor} onChange={(e) => set({ subfloor: e.target.value as Foundation['subfloor'] })}>
                <option value="osb">23/32" OSB</option>
                <option value="plywood">23/32" plywood</option>
              </select>
            </Field>
          </div>
          <small className="muted">Joists and girders are laid out and counted, not sized — check spans with the IRC R502.3 tables or your lumber yard.</small>
        </>
      )}
      {f.type !== 'none' && (
        <div className="row">
          <Field label="Footing bottom below grade">
            <LengthInput value={f.footingDepth} min={0} onChange={(v) => set({ footingDepth: v })} />
          </Field>
          <Field label="Local frost depth">
            <input
              defaultValue={f.frostDepth === undefined ? '' : formatFtIn(f.frostDepth)}
              key={f.frostDepth ?? 'unset'}
              placeholder={`e.g. 36" — ask your building dept.`}
              onBlur={(e) => {
                const v = e.target.value.trim() ? parseFtIn(e.target.value) : null;
                set({ frostDepth: v ?? undefined });
              }}
            />
          </Field>
        </div>
      )}
    </>
  );
}

function RoofFields({ roof, set }: { roof: Roof; set(patch: Partial<Roof>): void }) {
  return (
    <>
      <h4>Roof</h4>
      <div className="row">
        <Field label="Type">
          <select value={roof.type} onChange={(e) => set({ type: e.target.value as RoofType })}>
            {ROOF_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Pitch">
          <select value={roof.pitch} onChange={(e) => set({ pitch: Number(e.target.value) })} disabled={roof.type === 'none'}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14].map((p) => (
              <option key={p} value={p}>
                {p}/12
              </option>
            ))}
          </select>
        </Field>
      </div>
      {roof.type !== 'none' && (
        <>
          <div className="row">
            <Field label="Eave overhang">
              <LengthInput value={roof.overhang} onChange={(v) => set({ overhang: v })} />
            </Field>
            {roof.type !== 'hip' && (
              <Field label="Rake overhang">
                <LengthInput value={roof.rake} onChange={(v) => set({ rake: v })} />
              </Field>
            )}
          </div>
          <Field label={roof.type === 'shed' ? 'Slope runs' : 'Ridge'}>
            <select value={roof.ridge} onChange={(e) => set({ ridge: e.target.value as Roof['ridge'] })}>
              <option value="auto">Along the long side</option>
              <option value="x">Left–right</option>
              <option value="y">Top–bottom</option>
            </select>
          </Field>
          <div className="row">
            <Field label="Framing">
              <select value={roof.framing} onChange={(e) => set({ framing: e.target.value as Roof['framing'] })}>
                <option value="trusses">Trusses</option>
                <option value="rafters">Rafters</option>
              </select>
            </Field>
            <Field label="Spacing">
              <select value={roof.spacing} onChange={(e) => set({ spacing: Number(e.target.value) as 16 | 24 })}>
                <option value={16}>16" o.c.</option>
                <option value={24}>24" o.c.</option>
              </select>
            </Field>
          </div>
          {roof.framing === 'rafters' && (
            <Field label="Rafter size" hint="Counted, not sized — check IRC R802 span tables.">
              <select value={roof.rafterSize} onChange={(e) => set({ rafterSize: e.target.value as RafterSize })}>
                {RAFTER_SIZES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
    </>
  );
}

export function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function SpaceUseSelect({ value, set }: { value: SpaceUse | undefined; set(v: SpaceUse | undefined): void }) {
  return (
    <select value={value ?? ''} onChange={(e) => set(e.target.value === '' ? undefined : (e.target.value as SpaceUse))}>
      <option value="">Not answered</option>
      <option value="none">Nothing</option>
      <option value="storage">Storage</option>
      <option value="equipment">Equipment</option>
    </select>
  );
}
