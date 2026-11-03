# 🏠 Home Builder

A browser home-planning tool. Draw the floorplan (or trace a photo of one), and the
app derives everything downstream from it: wall framing, a materials list,
receptacle layout and International Residential Code checks. Floorplanning came
first; framing, materials, structure and landscape grow out from the same model.

The editor runs client-side. **Projects** (☰ in the top bar) keeps any number of
projects on this device (IndexedDB) and, for invited users who sign in, in their
account so they open on any device. Everything autosaves; projects can also be
saved / opened as `.homebuilder.json` files.

### Accounts (invite-only)

A small Cloudflare Worker in `api/` (Hono + D1 + private R2, the Brookeslist /
Voice Studio flavor): PBKDF2 passwords, HMAC'd session tokens in an HttpOnly
cookie, login lockout, single-use invite codes. Project metadata is in D1; each
project's JSON (which can include a floorplan image) is an R2 object.

- Account projects autosave ~1.5 s after an edit. If another device saved a newer
  copy, the editor stops and asks: load that version, or keep yours.
- Signing out closes an account project, so it doesn't stay on a shared screen.
- Admins mint invite codes in Account → Invite someone; the link opens the
  sign-up form with the code filled in. Without an admin yet:
  `cd api && npm run invite -- --env dev`. Make the first admin with
  `npm run create-user -- --env dev --role admin --email … --password '…'`
  (run it yourself; the password goes on the command line).

## Run it

```bash
npm install
npm run dev      # http://localhost:5180
npm test         # calc tests (node --test, no browser)
npm run build    # typecheck + production build to dist/

cd api && npm install
npm run migrate:local && npm run dev   # API on http://localhost:8787 (the app's default in dev)
npm run invite -- --local              # a sign-up code for the local DB
```

From the umbrella folder the desktop app's preview config is `home-builder` in
`../.claude/launch.json`.

## What it does today

| Tab | What you get |
|---|---|
| **Plan** | SVG editor: Wall (click-click, type a length + ↵, Shift = any angle), Room (click inside closed walls to make a room of exactly that shape — L-shapes and angled walls included — or drag a rectangle; walls already on the plan are reused, never doubled), Door, Window, Outlet, Switch, Light and Alarm tools; endpoint + 6" grid snapping; drag wall ends, openings and outlets; drag a whole wall to slide it sideways (walls tied to it — corners and Ts — stretch to follow, room outlines too); Split in two / Join in the wall panel (openings, outlets and switches stay where they are in the plan); undo/redo; per-wall stud size and height; per-room use and ceiling. |
| **Floorplan image / PDF** | *Import floorplan* takes a photo, scan or **PDF**. For a PDF, pick the sheet from page thumbnails and, if the title block gives a drawing scale (1/8" … 1" = 1'-0"), it comes in at true size with no calibrating. *Straighten* fixes a photo taken at an angle: click the four corners of anything that's really a rectangle, optionally type its real width and depth (which also sets the scale), and the picture is warped flat and cropped to it. *Calibrate scale*: click both ends of a known dimension and type its real length. Then trace over it. |
| **Site** | Lot outline (quick rectangle around the house or draw any polygon) with per-edge setbacks → dashed buildable envelope; hardscape / bed areas (pavers, concrete, gravel, mulch, sod, deck) with depth; ~40-species plant library drawn at mature spread; lot coverage and impervious %. Quantities roll into the Estimate. |
| **3D** | Orbitable three.js model (lazy-loaded): walls cut around doors and windows, glass, floors, and every ceiling type. Cut-away at 4 ft. |
| **Framing** | Per-wall takeoff and a dimensioned framing elevation (commons on layout, 3-stud corners, ladder backing at tees, king/jack studs, headers, cripples, sills, plates, rough openings), plus a roof summary (area, squares, rise, truss/rafter count and length, ridge, hips) and a foundation summary (footprint, perimeter, concrete, anchor bolts). Over a crawlspace: a **floor framing plan** (joists at spacing, broken over auto or chosen girder lines, piers, longest span) and the staggered 4×8 **subfloor sheet layout**. |
| **Estimate** | Materials list priced from editable unit prices (sample US big-box defaults until you type your own), markup and tax, by category; CSV with prices. Lumber, sheathing, wrap, batts, drywall incl. vaulted/tray/coffered ceilings, receptacles + boxes, door/window schedule, gable-end infill studs above the plate (vaulted/cathedral rooms, rafter gable ends), roof (trusses or rafters + ridge + ceiling joists, hurricane ties, sheathing, underlayment, shingles, starter, ridge cap, drip edge, fascia, soffit), foundation (slab concrete + 4" base + 6-mil poly + mesh + edge rebar, or footing + poured/block stem wall + vents; anchor bolts, PT sill, sill seal), floor framing (joists by stock length, rim, 3-ply girders, blocking, piers + pads, T&G subfloor sheets from the layout, adhesive), and landscape (pavers + base + sand + edging + polymeric sand, concrete yd³, gravel tons + fabric, mulch yd³, sod pallets, plant schedule). |
| **Dimensions** | Toolbar switch **℄ / In / Out**, saved with the project. *℄*: wall centrelines (what you draw and type). *In*: each wall's room-side face, split where walls tee in, so rooms read their clear sizes; both sides of an interior wall unless they match; overall strings to the outside face. *Out*: exterior walls and the overall strings to the outside face, interior walls on centrelines. Faces are the finished faces (wall thickness incl. drywall), mitred at corners, pulled back at Ts and run to the drawn end of a free wall. The wall panel lists both face lengths under the (centreline) length. |
| **Print / PDF** | From the Plan tab: a Letter-landscape sheet at the largest architectural scale that fits, with dimension strings, scale bar and title block. The title block says what the dimensions measure. |
| **Code check** | IRC rules with section refs and click-to-locate: R303.1 light/vent, R304 room size, R305 ceiling height (incl. R305.1.1 sloped), R308.4 safety glazing, R310 bedroom escape openings, R311.2 egress door, R602.3 wall height/spacing, R602.7 header reminder, E3901 receptacle spacing incl. E3901.4 countertop spaces and islands, E3901.7 outdoor receptacles front and back (height warned above 6'-6" from the floor, as grade isn't modelled), E3902 GFCI (incl. outdoors), R306.2 kitchen sink, and foundation minimums: R506.1 slab ≥ 3-1/2", R403.1.1 footing ≥ 12" × 6", R403.1.4 ≥ 12" below grade, R403.1.4.1 frost depth (you enter it). Plus site checks: house inside the setback envelope, coverage, plant hardiness zone, trees too close to the foundation, plants overlapping at maturity. Lists what is *not* checked. |

### Walls

- New walls take the **Ext / Int** toggle in the toolbar. The first room you draw on an empty plan is exterior (the house outline); after that it flips to interior.
- Stud size: project defaults for exterior (2x6) and interior (2x4), overridable per wall (2x4 / 2x6 / 2x8). Finished thickness follows the stud: depth + 1" of finishes.
- Height: project default for new walls (97-1/8" — the standard "8 ft" wall that takes a 92-5/8" precut), per-wall override, and "apply to every wall".

### Roof

Set under **Roof** in the Plan tab's project panel (nothing selected): gable, hip, shed or none; pitch; eave and rake overhangs; ridge direction; trusses or rafters (size, spacing). It shows in 3D (toggle *Roof*), on the Framing tab and in the Estimate, and feeds the R905.2.2 shingle-slope check.

### Ceilings (per room)

Flat, **vaulted** (single slope across the short side), **cathedral** (ridge down the long axis), **tray** (depth + inset) and **coffered** (grid spacing + beam depth). They change drywall area, add tray/coffer framing lumber, and feed the R305 ceiling-height check.

### Outlets

**Auto outlets** lays out receptacles in every room per IRC E3901 (no point on a wall run more than 6 ft from one; doorways break runs; kitchens: GFCIs along each counter space, else countertop spacing on every wall if no counters are drawn; one GFCI in baths; hall ≥ 10 ft gets one; outside, one GFCI at the front and one at the back of the house per E3901.7, beside an exterior door where there is one, at 18"). *Front of the house* in the Project panel says which side of the plan faces the street (bottom by default). Any receptacle on the outside face of an exterior wall counts as outdoor; the estimate adds an in-use (bubble) cover for each. Re-running replaces only auto-placed ones — anything you add, drag or edit becomes manual and is kept. Auto outlets draw with a dashed ring.

### Kitchen counters

The **Counter** tool (K): drag along a wall for a counter on that wall face (25" deep; a plain click gives 6 ft), or drag in open floor for an island. Select a counter to set its length and depth and **add a sink or range**; drag a wall counter to slide it along the wall, or an island to move it. Counters show in the 3D view (36" high) and the estimate (base cabinets LF, countertop sq ft, sink, range: sample allowance prices).

Sinks and ranges split a counter into separate countertop spaces. In a kitchen with counters, **Auto outlets** puts GFCIs at 44" along every space 12" or wider, no point more than 24" from one (E3901.4), and general 12 ft spacing on the walls off the counters (still GFCI). Each island space at least 24" × 12" gets one receptacle, drawn on the island and counted in the estimate. Code editions differ on island receptacles, so the check is a note. **R306.2** checks the kitchen has a sink.

A counter can also hold a **dishwasher** (24", sits under the countertop, so it doesn't split a space; dashed **DW**) or a **fridge** (36", breaks the run like a sink or range; **REF**, 70" tall in 3D). The estimate takes both out of the base-cabinet run, takes the fridge out of the countertop, and adds dishwasher and refrigerator allowances.

Wall counters ride along with their wall: drag it, drag an end, change its length or its studs and the counter keeps its place along the wall, on the new face, cut back if the wall got shorter. Islands stay put.

The Code check adds two **NKBA guidelines** (they warn, never fail): the **work triangle** between sink, range and fridge (each leg 4–9 ft, 26 ft or less in all, measured centre to centre) and the **clearance around each island** (42" work aisle to the nearest counter, 36" walkway to a wall). Peninsulas still count as islands.

### Lights, switches and alarms

**Auto lights** puts a ceiling light in every room (at the centre, or the point furthest from the walls in an L-shape), a wall switch 6" past the latch side of the room's main door at 48", and a 3-way pair in halls and garages with two or more doors. Smoke alarms go in each bedroom and one outside each sleeping area, about 3 ft out from the bedroom doors (doors within 20 ft share one). With no bedrooms there is one on the floor. Those outside alarms become **combination smoke / CO** when the Project panel says there are fuel-burning appliances, or a garage has a door into the house (R315).

Dashed curves show which lights each switch runs. Select a switch to tick or untick lights. A new light joins the switches already running its room, and a new switch runs the lights of the room it faces. Two switches on one light count as 3-ways, and more add 4-ways in between. Re-running keeps anything you dragged, edited or placed by hand, as with outlets.

Every outdoor door (a door in an exterior wall; anything wider than 6 ft counts as a vehicle door and is skipped) gets an **exterior wall light** beside it on the outside face, switched from inside at that door — on the room's own switch when it's already there. Select a light to make it a **ceiling fan** (with a light kit; counts as the room's light, priced with a fan-rated box) or an exterior light. Select a switch to tick **switched receptacles** in its room too; they get a small S, and in bedrooms, living rooms and other rooms they satisfy E3903.2 instead of a ceiling light. Ticking an auto receptacle makes it yours, so Auto outlets keeps it.

The checks cover the following:
- **E3903.2 / E3903.3:** a wall-switched light in each habitable room, bath, hall and garage. Bedrooms and living rooms pass with a switched receptacle instead, and only warn without either.
- **E3903.4:** a wall-switched exterior light beside each outdoor door (within 8 ft), vehicle doors excepted.
- **R314.3:** a smoke alarm in each bedroom, outside each sleeping area and on each storey, and not within 3 ft of a bath door.
- **R315.3:** a CO alarm outside sleeping areas when one is required.

"Immediate vicinity" has no number in the code, so the app reports the distance and leaves the call to the inspector.

## Code layout

```
src/model/     types (the Project document), geometry, units (ft-in parse/format), store (reducer + undo), persist,
               library (IndexedDB projects + which one is open), cloud (API client)
src/account/   useWorkspace (open/save/sync), Projects + Account dialogs
api/           Cloudflare Worker: auth, invites, project storage (wrangler.toml has dev + prod envs)
src/calc/      framing, materials, pricing, ceilings, electrical, lighting, regions, irc, roof, site, sheet, model3d — pure functions of Project, unit-tested in test/
src/data/      plant library
src/editor/    PlanCanvas (SVG editor), PlanDrawing (shared with print), Inspector, hit testing
src/site/      Site tab (lot, areas, plants)
src/views/     Framing / Estimate / Code check reports, print sheet, 3D view
docs/research/ competitor research that feeds BACKLOG.md
```

**Model rule:** `Project` stores only what the user drew (walls, openings, rooms,
outlets, settings, underlay). Every number on the report tabs is derived — never
store a derived value. All lengths are inches.

## Caveats (on purpose)

- **Estimating, not engineering.** Header sizes are a single-storey rule of thumb, *not* IRC Table R602.7(1) (which needs ground snow load and building width). The Code check tab says so on every plan.
- **IRC checks are a design aid, not a plan review.** Values match the 2018/2021/2024 IRC for the rules implemented; jurisdictions adopt with amendments. Window net-clear openings are estimated from nominal size + operation type. Only numeric requirements are encoded — no ICC code text is reproduced.
- Rooms can be any shape the walls close (Room tool → click inside), but ceiling slopes and the R304 min-dimension check still use the room's bounding box, so an L-shaped room's narrow leg isn't checked on its own.
- Setbacks are local zoning, entered by you; the envelope inset is exact for convex lots, approximate for concave ones. Plant sizes are typical figures, not cultivar-specific.
- Floor joists and girders are laid out and counted, not sized. "Auto" girders keep spans to 12 ft as a layout default, not a span check (IRC R502.3).
- Foundation sizes are your inputs; the checker tests only the code minimums, not soil bearing or storeys (Table R403.1), and runs one foundation under the exterior walls (no interior bearing footings yet).
- The roof covers the exterior walls' bounding rectangle — an L-shaped plan gets one roof over its whole box (no valleys yet). Rafters, ceiling joists and trusses are counted, not sized: check IRC R802 span tables or the truss supplier.

## Deploy

GitHub Pages flavor (see `jarvis-dashboard/NEW-PROJECT.md`): `.github/workflows/pages.yml`
on `dev` publishes `main` → `homebuilder.dabrewer.dev/` and `dev` → `/dev/`. Needs a
**public** repo (free-plan Pages), the `github-pages` environment allowing `dev`, and a
DNS-only CNAME `homebuilder.dabrewer.dev` → `brewerindustries.github.io`. Each build
gets `VITE_API_BASE` (dev → `homebuilder-api-dev.dabrewer.dev`, prod →
`homebuilder-api.dabrewer.dev`).

API: `cd api && npm run deploy:dev` (custom domain + cert are created by wrangler).
Dev D1 `home-builder-dev`, R2 `home-builder-projects-dev`, `SESSION_SECRET` set.
**Prod is not set up yet:** D1 `home-builder-prod` and R2 `home-builder-projects-prod`
exist but still need `npm run migrate:prod`, `wrangler secret put SESSION_SECRET`
and `npm run deploy`. Wrangler uses its OAuth login. Unset `CLOUDFLARE_API_TOKEN`
(the DNS-only token) when you run it.

Roadmap: [BACKLOG.md](BACKLOG.md).
