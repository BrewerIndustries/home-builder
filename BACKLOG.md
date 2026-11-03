# Backlog

Ordered roughly by value. Competitor research behind these lives in
`docs/research/` (design software; builder, estimating & landscape tools).

## Next up

- [x] **Landscape module v1** — lot (rectangle or drawn), per-edge setbacks + envelope check, coverage / impervious %, hardscape areas with depth takeoff (pavers + base/sand/edging, concrete, gravel + fabric, mulch, sod, deck area), ~40-species plant library at mature spread with zone / foundation / crowding checks, landscape lines in the estimate.
- [ ] **Landscape v2** — lot from survey bearings + plat/aerial underlay; easements; retaining wall block, topsoil, edging as lines; grade/drainage (R401.3 6"-in-10-ft); grow the plant library (~300 species, regional native flag); planting beds with auto-spaced fill; site in the 3D view and on the print sheet.
- [ ] **Sprinkler / irrigation layout tool** — zones over lawn and bed areas, spray / rotor / drip heads with throw radius and head-to-head coverage, pipe runs from the valve manifold and backflow device, zone flow (GPM) against the water supply, parts list in the estimate.
- [x] **Wall framing elevations** — dimensioned SVG per wall on the Framing tab.
- [x] **Dimension strings + to-scale PDF export with a title block.**
- [x] **Price catalog → priced estimate** — editable unit prices, markup, tax, CSV. (XLSX still open.)
- [ ] **IRC span tables** — headers R602.7(1) (needs snow load + building width inputs), joists R502, rafters R802; replace the header rule of thumb.
- [x] **PDF underlay + perspective correction** — pdf.js page picker with drawing-scale presets; four-corner straighten with optional real size. (Vector PDFs could later yield walls directly.)
- [x] **3D view** (three.js) incl. vaulted / cathedral / tray / coffered ceilings. (Rooms with nested rooms still get a flat ceiling.)

## Structure & takeoff

- [x] Roof model (gable / hip / shed): squares, sheathing, trim, rafter or truss counts; gable-end wall framing above the plate for vaulted rooms
- [ ] Roof v2: per-wing roofs with valleys for L/T plans, dormers, roof on the print sheet, attic ventilation (R806)
- [x] Foundation / concrete takeoff: slab or crawlspace footing + stem wall, anchor bolts (R403.1.6), PT sill, vents (R408.1), min-size + frost-depth checks
- [ ] Foundation v2: interior bearing footings / piers, basement walls, footing sizing from soil + storeys (Table R403.1, needs verified values), foundation in 3D
- [x] Floor joist layout + subfloor sheet layout (crawlspace floors: joists over girders, piers, staggered T&G sheets; framing plan on the Framing tab)
- [ ] Floor v2: joist hangers / cantilevers, openings for stairs, I-joists, floor insulation, framed floors on upper storeys
- [ ] Cut lists optimised to stock lengths, with waste report
- [ ] Layered wall assemblies (drywall / stud / sheathing / siding) instead of the +1" finish rule
- [ ] Wall bracing (R602.10)
- [ ] Multiple floors (ghosted floor below) + stairs tool checked against R311.7

## Electrical

- [x] **Switches, lighting outlets, switch-to-light links (E3903)** — Light / Switch tools, dashed switch legs, auto 3-way pairs in halls and garages, single-pole / 3-way / 4-way counts in the estimate.
- [x] **Auto smoke / CO alarm placement (R314 / R315)** — every bedroom, one shared alarm outside each sleeping area, one per storey; combination smoke / CO where there are fuel-burning appliances or an attached garage; 3 ft bathroom-door check.
- [x] Lighting v2: exterior lights at outdoor doors (E3903.4), switched receptacles as the E3903.2 alternative, ceiling fans
- [ ] Lighting v3: stairway switches at each level (needs stairs / storeys); attic and crawlspace equipment lights; fan-only (no light kit) option
- [x] Countertop and island modelling so kitchen receptacles follow real counters, not every wall
- [x] Counters v2: follow wall drags; fridge and dishwasher; work-triangle and island-clearance guideline checks
- [x] Counters v3: L-shaped runs (shared corner), peninsulas (connecting-edge rule), appliance-in-corner warning, wall cabinets + range hood, NKBA landing areas
- [ ] Counters v4: draw an L in one drag; corner cabinets (lazy susan / blind) in the estimate; tall pantry / oven cabinets; island seating overhang and knee space; island / peninsula receptacle note even before any outlets are placed
- [x] Outdoor receptacles front + back (E3901.7): auto GFCI beside an exterior door, front-of-house setting, in-use covers in the estimate
- [ ] Dedicated appliance circuits, AFCI; outdoor receptacles v2: decks / balconies / porches, height above real grade
- [ ] Circuits, NEC 220 load calc, panel schedule

## Editor

- [x] Room from enclosed walls (click inside) and non-rectangular rooms
- [ ] Non-rectangular rooms v2: R304 min dimension and ceiling slopes on the real outline (not the bounding box); auto-name / auto-type rooms from size and doors
- [x] Drag a whole wall (move both ends together); split / join walls
- [ ] Wall edits v2: split at a clicked point (not just the middle); snap a dragged wall to grid / other walls; show the move distance while dragging
- [x] Inside / outside dimension modes (centreline / inside faces / outside face)
- [x] Dimensions v2: type a length as inside / outside in the wall panel; opening chains on exterior walls; room clear sizes; finished vs framing faces
- [ ] Dimensions v3: dimension strings across the whole plan through interior walls; clear sizes for L-shaped rooms; opening chains on interior walls; drag a dimension line to move it
- [ ] Existing / demo / new phasing; design options ("plan B") with cost compare
- [ ] Plan versions with change-order diffs
- [ ] Furniture / fixture symbols (also fixes bath basin + kitchen counter inputs)
- [ ] AI plan recognition: suggest walls / doors / windows from the underlay image (after PDF + perspective)

## Housekeeping

- [x] Public GitHub repo, Pages (dev + main branch policies), CNAME DNS, HTTPS — dev live 2026-11-01
- [ ] Create `main` (prod) via the first approved dev → main PR; prod URL shows a placeholder until then
- [x] Invite-only accounts + multiple projects (device library + account sync), dev API live 2026-11-01
- [ ] Prod API: migrate prod D1, set SESSION_SECRET, deploy the Worker (before/with the first main promotion)
- [ ] Accounts follow-ups: share a project read-only by link, project thumbnails, password reset by email, cache account projects for offline
- [ ] Code-edition picker (2018 / 2021 / 2024) once a rule actually differs between editions
