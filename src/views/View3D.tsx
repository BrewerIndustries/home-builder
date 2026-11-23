import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { type Box, type Scene3D } from '../calc/model3d.ts';
import { houseScene } from '../calc/house.ts';
import { buildSiteScene } from '../calc/site3d.ts';
import { EYE, move, startPoint, type Walker } from '../calc/walk.ts';
import type { Project } from '../model/types.ts';

// Orbitable 3D model of the plan. Loaded lazily (three.js is most of its weight).
// Geometry comes from calc/model3d.ts; this file only turns it into meshes.

const CUTAWAY = 48;
/** Walking speed, inches a second (about 3 mph); Shift doubles it. */
const WALK_SPEED = 54;
/** Mouse-drag look sensitivity, radians per pixel. */
const LOOK = 0.004;

/** The walkthrough's state, shared with the render loop. */
interface Walk {
  on: boolean;
  me: Walker;
  yaw: number;
  pitch: number;
  keys: Set<string>;
  scene: Scene3D | null;
}

function palette(dark: boolean) {
  return {
    bg: dark ? 0x151920 : 0xeef1f5,
    ext: dark ? 0xd6dbe4 : 0xf4f1ea,
    int: dark ? 0xb8c0cc : 0xffffff,
    floor: dark ? 0x6b5a45 : 0xc9b08a,
    ceiling: dark ? 0xe6e9ef : 0xfbfbfb,
    gable: dark ? 0xd6dbe4 : 0xf4f1ea,
    beam: dark ? 0xc9b08a : 0xe9dcc6,
    glass: 0x7fb3e6,
    roof: dark ? 0x5a4f4a : 0x6e5f58,
    counter: dark ? 0x8a7a62 : 0xd8ccb6,
    fixture: dark ? 0xe8edf2 : 0xfdfdfd,
    furniture: dark ? 0x6f7f96 : 0x9fb0c6,
    door: dark ? 0x9c7a55 : 0xb88f62,
    stair: dark ? 0x8a6a48 : 0xc49a6c,
    // Site (Landscape v2)
    lawn: dark ? 0x2f4a2a : 0x8fbf72,
    pavers: 0xc9a98a,
    concrete: 0xc8c8c4,
    gravel: 0xddd3c0,
    mulch: 0x6b4630,
    sod: dark ? 0x3d6b34 : 0x6fae5a,
    decking: 0xb9875a,
    trunk: 0x5b4030,
    tree: 0x3f8f4a,
    shrub: 0x2f6b3a,
    perennial: 0xc06aa8,
    grass: 0xc8b26a,
    groundcover: 0x5d9a8a,
    retaining: dark ? 0x8d8a84 : 0xa9a49a,
    // Foundation (below the floor)
    footing: dark ? 0x7d7b77 : 0xa8a6a0,
    foundation: dark ? 0x9a9893 : 0xc4c2bc,
    girder: dark ? 0x8a7a62 : 0xc9b08a,
  };
}

export default function View3D({ project }: { project: Project }) {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<{ group: THREE.Group; fit(s: Scene3D): void; walk(on: boolean): void } | null>(null);
  const walkRef = useRef<Walk>({ on: false, me: { x: 0, z: 0, y: 0 }, yaw: 0, pitch: 0, keys: new Set(), scene: null });
  const [walking, setWalking] = useState(false);
  const [ceilings, setCeilings] = useState(false);
  const [cutaway, setCutaway] = useState(false);
  const [showRoof, setShowRoof] = useState(true);
  const [showSite, setShowSite] = useState(true);
  const [showFoundation, setShowFoundation] = useState(true);
  const scene3d = useMemo(() => houseScene(project), [project]);
  const site3d = useMemo(() => buildSiteScene(project), [project]);
  const fitted = useRef(false);
  walkRef.current.scene = scene3d;

  // One renderer per mount.
  useEffect(() => {
    const el = host.current!;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(palette(dark).bg);
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 50000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, 2, 1.4);
    scene.add(sun);
    const group = new THREE.Group();
    scene.add(group);
    fitted.current = false; // a fresh camera needs framing (also covers StrictMode's double mount)

    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Walkthrough: WASD / arrows to walk, drag to look round, Shift to hurry.
    const wk = walkRef.current;
    let last = performance.now();
    const step = (dt: number) => {
      const k = wk.keys;
      const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
      const side = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
      const turn = (k.has('arrowleft') ? 1 : 0) - (k.has('arrowright') ? 1 : 0);
      wk.yaw += turn * 1.6 * dt;
      const speed = WALK_SPEED * (k.has('shift') ? 2 : 1) * dt;
      const [s, c] = [Math.sin(wk.yaw), Math.cos(wk.yaw)];
      // Camera looks down -Z at yaw 0: forward (-sin, -cos), right (cos, -sin) on the plan.
      const dx = (-s * fwd + c * side) * speed;
      const dz = (-c * fwd - s * side) * speed;
      if (wk.scene) wk.me = move(wk.scene, wk.me, dx, dz, dt);
      camera.position.set(wk.me.x, wk.me.y + EYE, wk.me.z);
      camera.rotation.set(wk.pitch, wk.yaw, 0, 'YXZ');
    };
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (wk.on) step(dt);
      else controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    const keyDown = (e: KeyboardEvent) => {
      if (!wk.on || typing(e) || e.metaKey || e.ctrlKey) return;
      const key = e.key.toLowerCase();
      if (key === 'escape') {
        world.current?.walk(false);
        setWalking(false);
        return;
      }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
        wk.keys.add(key);
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const keyUp = (e: KeyboardEvent) => wk.keys.delete(e.key.toLowerCase());
    const blur = () => wk.keys.clear();
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (!wk.on) return;
      drag = { x: e.clientX, y: e.clientY };
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const moveLook = (e: PointerEvent) => {
      if (!wk.on || !drag) return;
      wk.yaw -= (e.clientX - drag.x) * LOOK;
      wk.pitch = Math.max(-1.3, Math.min(1.3, wk.pitch - (e.clientY - drag.y) * LOOK));
      drag = { x: e.clientX, y: e.clientY };
    };
    const up = () => (drag = null);
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', moveLook);
    renderer.domElement.addEventListener('pointerup', up);

    world.current = {
      group,
      fit(s) {
        const [x0, , z0] = s.bounds.min;
        const [x1, y1, z1] = s.bounds.max;
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        const r = Math.max(x1 - x0, z1 - z0, y1, 120);
        controls.target.set(cx, y1 / 3, cz);
        camera.position.set(cx - r * 0.75, r * 0.95, cz + r * 1.05);
        controls.update();
      },
      walk(on) {
        wk.on = on;
        wk.keys.clear();
        controls.enabled = !on;
        camera.fov = on ? 70 : 45;
        camera.updateProjectionMatrix();
        if (on) {
          if (wk.scene) wk.me = startPoint(wk.scene);
          wk.pitch = 0;
          wk.yaw = 0;
        } else if (wk.scene) {
          this.fit(wk.scene);
        }
      },
    };
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
      ro.disconnect();
      controls.dispose();
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      world.current = null;
    };
  }, []);

  // Rebuild meshes whenever the plan or view options change.
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const c = palette(dark);
    for (const child of [...w.group.children]) {
      w.group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide, ...extra });

    const addBox = (b: Box) => {
      let [, cy] = b.c;
      let [sx, sy, sz] = b.size;
      if (b.kind === 'beam' && !ceilings) return;
      const below = b.kind === 'footing' || b.kind === 'foundation' || b.kind === 'girder';
      if (below && !showFoundation) return;
      if (cutaway && b.kind !== 'beam') {
        const y0 = cy - sy / 2;
        const y1 = Math.min(cy + sy / 2, CUTAWAY);
        if (y1 <= y0) return;
        cy = (y0 + y1) / 2;
        sy = y1 - y0;
      }
      const color = below ? c[b.kind as 'footing' | 'foundation' | 'girder'] : b.kind === 'wall-ext' ? c.ext : b.kind === 'wall-int' || b.kind === 'rim' ? c.int : b.kind === 'glass' ? c.glass : b.kind === 'counter' ? c.counter : b.kind === 'fixture' ? c.fixture : b.kind === 'furniture' ? c.furniture : b.kind === 'door' ? c.door : b.kind === 'stair' ? c.stair : c.beam;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        b.kind === 'glass' ? mat(color, { transparent: true, opacity: 0.35, roughness: 0.1 }) : mat(color),
      );
      m.position.set(b.c[0], cy, b.c[2]);
      m.rotation.y = b.rotY;
      w.group.add(m);
    };
    scene3d.boxes.forEach(addBox);

    for (const f of scene3d.flats) {
      if (f.kind === 'ceiling' && (!ceilings || cutaway)) continue;
      if (f.y < 0 && !showFoundation) continue; // basement slab
      const shape = new THREE.Shape(f.outline.map((p) => new THREE.Vector2(p.x, p.y)));
      for (const h of f.holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(f.kind === 'floor' ? c.floor : c.ceiling));
      m.rotation.x = Math.PI / 2; // shape XY → plan XZ
      m.position.y = f.y + (f.kind === 'floor' ? -0.5 : 0);
      w.group.add(m);
    }

    for (const f of scene3d.faces) {
      if (cutaway) continue;
      // Roof faces (and the roof's gable-end walls) belong to the roof toggle; the rest to ceilings.
      const isRoof = f.kind === 'roof' || f.roofPart;
      if (isRoof ? !showRoof : !ceilings) continue;
      const g = new THREE.BufferGeometry();
      const v: number[] = [];
      for (let i = 1; i < f.pts.length - 1; i++) v.push(...f.pts[0], ...f.pts[i], ...f.pts[i + 1]);
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.computeVertexNormals();
      w.group.add(new THREE.Mesh(g, mat(f.kind === 'roof' ? c.roof : f.kind === 'gable' ? c.gable : c.ceiling)));
    }

    if (showSite) {
      for (const f of site3d.flats) {
        const m = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(f.outline.map((p) => new THREE.Vector2(p.x, p.y)))), mat(f.kind === 'lot' ? c.lawn : c[f.kind]));
        m.rotation.x = Math.PI / 2;
        m.position.y = f.y;
        w.group.add(m);
      }
      for (const b of site3d.walls) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(...b.size), mat(c.retaining));
        m.position.set(...b.c);
        m.rotation.y = b.rotY;
        w.group.add(m);
      }
      for (const p of site3d.plants) {
        const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat(c[p.form], { transparent: p.form === 'tree', opacity: 0.85 }));
        canopy.scale.set(p.r, p.ry, p.r);
        canopy.position.set(...p.c);
        w.group.add(canopy);
        if (p.trunk > 0) {
          const t = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(3, p.r * 0.06), Math.max(4, p.r * 0.08), p.trunk, 8), mat(c.trunk));
          t.position.set(p.c[0], p.c[1] - p.ry - p.trunk / 2, p.c[2]);
          w.group.add(t);
        }
      }
    }

    if (!fitted.current && (scene3d.boxes.length || site3d.bounds)) {
      fitted.current = true;
      w.fit(scene3d.boxes.length ? scene3d : { ...scene3d, bounds: site3d.bounds! });
    }
  }, [scene3d, site3d, ceilings, cutaway, showRoof, showSite, showFoundation]);

  return (
    <div className="view3d">
      <div className="view3d-bar">
        <label>
          <input type="checkbox" checked={showRoof} onChange={(e) => setShowRoof(e.target.checked)} /> Roof
        </label>
        <label>
          <input type="checkbox" checked={ceilings} onChange={(e) => setCeilings(e.target.checked)} /> Ceilings
        </label>
        <label>
          <input type="checkbox" checked={cutaway} onChange={(e) => setCutaway(e.target.checked)} /> Cut walls at 4 ft
        </label>
        {scene3d.boxes.some((b) => b.kind === 'footing' || b.kind === 'foundation') && (
          <label title="Footings, stem / basement walls, girders and piers below the floor — orbit underneath to see them">
            <input type="checkbox" checked={showFoundation} onChange={(e) => setShowFoundation(e.target.checked)} /> Foundation
          </label>
        )}
        {site3d.bounds && (
          <label>
            <input type="checkbox" checked={showSite} onChange={(e) => setShowSite(e.target.checked)} /> Site
          </label>
        )}
        <button
          className={walking ? 'active' : ''}
          disabled={!project.walls.length}
          onClick={() => {
            const on = !walking;
            if (on) {
              setCeilings(true);
              setCutaway(false);
            }
            world.current?.walk(on);
            setWalking(on);
          }}
          title="Walk round inside the plan at eye height (5' 4&quot;)"
        >
          {walking ? 'Exit walkthrough' : '🚶 Walk through'}
        </button>
        {!walking && <button onClick={() => world.current?.fit(scene3d)}>Reset view</button>}
        <span className="muted small">{walking ? 'W A S D / ↑ ↓ to walk · ← → or drag to look round · Shift to hurry · stairs carry you up · Esc to stop' : 'Drag to orbit · right-drag to pan · scroll to zoom'}</span>
      </div>
      <div className="view3d-canvas" ref={host} />
      {!project.walls.length && !site3d.bounds && <p className="view3d-empty muted">Draw some walls on the Plan tab first.</p>}
    </div>
  );
}
