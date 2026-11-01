# 🏠 Home Builder

A browser home-planning tool. Draw the floorplan (or trace a photo of one), and the
app derives everything downstream from it: wall framing, a materials list,
receptacle layout and International Residential Code checks. Floorplanning came
first; framing, materials, structure and landscape grow out from the same model.

Everything runs client-side. Projects autosave to the browser and can be saved /
opened as `.homebuilder.json` files.

## Run it

```bash
npm install
npm run dev      # http://localhost:5180
npm test         # calc tests (node --test, no browser)
npm run build    # typecheck + production build to dist/
```

From the umbrella folder the desktop app's preview config is `home-builder` in
`../.claude/launch.json`.

## What it does today

| Tab | What you get |
|---|---|
| **Plan** | SVG editor: Wall (click-click, type a length + ↵, Shift = any angle), Room (drag a rectangle — walls already on the plan are reused, never doubled), Door, Window, Outlet tools; endpoint + 6" grid snapping; drag wall ends, openings and outlets; undo/redo; per-wall stud size and height; per-room use and ceiling. |
| **Floorplan image** | *Import floorplan image* drops a picture under the plan (downscaled JPEG, saved with the project). *Calibrate scale*: click both ends of a known dimension and type its real length. Then trace over it. |
| **Framing** | Per-wall takeoff: commons on layout, 3-stud corners, ladder backing at tees, king/jack studs, doubled headers, cripples, plates. |
| **Materials** | Studs (as precuts where the height matches), plates, header stock, OSB, house wrap, batts by cavity depth, drywall incl. vaulted/tray/coffered ceiling surface, receptacles + boxes, door/window schedule. CSV download. |
| **Code check** | IRC rules with section refs and click-to-locate: R303.1 light/vent, R304 room size, R305 ceiling height (incl. R305.1.1 sloped), R308.4 safety glazing, R310 bedroom escape openings, R311.2 egress door, R602.3 wall height/spacing, R602.7 header reminder, E3901 receptacle spacing, E3902 GFCI. Lists what is *not* checked. |

### Walls

- New walls take the **Ext / Int** toggle in the toolbar. The first room you draw on an empty plan is exterior (the house outline); after that it flips to interior.
- Stud size: project defaults for exterior (2x6) and interior (2x4), overridable per wall (2x4 / 2x6 / 2x8). Finished thickness follows the stud: depth + 1" of finishes.
- Height: project default for new walls (97-1/8" — the standard "8 ft" wall that takes a 92-5/8" precut), per-wall override, and "apply to every wall".

### Ceilings (per room)

Flat, **vaulted** (single slope across the short side), **cathedral** (ridge down the long axis), **tray** (depth + inset) and **coffered** (grid spacing + beam depth). They change drywall area, add tray/coffer framing lumber, and feed the R305 ceiling-height check.

### Outlets

**Auto outlets** lays out receptacles in every room per IRC E3901 (no point on a wall run more than 6 ft from one; doorways break runs; kitchens at countertop 4 ft spacing with GFCIs; one GFCI in baths; hall ≥ 10 ft gets one). Re-running replaces only auto-placed ones — anything you add, drag or edit becomes manual and is kept. Auto outlets draw with a dashed ring.

## Code layout

```
src/model/     types (the Project document), geometry, units (ft-in parse/format), store (reducer + undo), persist
src/calc/      framing, materials, ceilings, electrical, irc — pure functions of Project, unit-tested in test/
src/editor/    PlanCanvas (SVG editor), Inspector, hit testing
src/views/     Framing / Materials / Code check reports
docs/research/ competitor research that feeds BACKLOG.md
```

**Model rule:** `Project` stores only what the user drew (walls, openings, rooms,
outlets, settings, underlay). Every number on the report tabs is derived — never
store a derived value. All lengths are inches.

## Caveats (on purpose)

- **Estimating, not engineering.** Header sizes are a single-storey rule of thumb, *not* IRC Table R602.7(1) (which needs ground snow load and building width). The Code check tab says so on every plan.
- **IRC checks are a design aid, not a plan review.** Values match the 2018/2021/2024 IRC for the rules implemented; jurisdictions adopt with amendments. Window net-clear openings are estimated from nominal size + operation type. Only numeric requirements are encoded — no ICC code text is reproduced.
- Rooms are drawn as rectangles; ceiling slopes and min-dimension checks use the room's bounding box.
- Gable-end wall framing above the plate for vaulted/cathedral rooms isn't in the takeoff yet.

## Deploy

GitHub Pages flavor (see `jarvis-dashboard/NEW-PROJECT.md`): `.github/workflows/pages.yml`
on `dev` publishes `main` → `homebuilder.dabrewer.dev/` and `dev` → `/dev/`. Needs a
**public** repo (free-plan Pages), the `github-pages` environment allowing `dev`, and a
DNS-only CNAME `homebuilder.dabrewer.dev` → `brewerindustries.github.io`.

Roadmap: [BACKLOG.md](BACKLOG.md).
