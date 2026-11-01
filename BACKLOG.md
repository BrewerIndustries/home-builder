# Backlog

Ordered roughly by value. Competitor research behind these lives in
`docs/research/` (design software; builder, estimating & landscape tools).

## Next up

- [x] **Landscape module v1** — lot (rectangle or drawn), per-edge setbacks + envelope check, coverage / impervious %, hardscape areas with depth takeoff (pavers + base/sand/edging, concrete, gravel + fabric, mulch, sod, deck area), ~40-species plant library at mature spread with zone / foundation / crowding checks, landscape lines in the estimate.
- [ ] **Landscape v2** — lot from survey bearings + plat/aerial underlay; easements; retaining wall block, topsoil, edging as lines; grade/drainage (R401.3 6"-in-10-ft); grow the plant library (~300 species, regional native flag); planting beds with auto-spaced fill; site in the 3D view and on the print sheet.
- [x] **Wall framing elevations** — dimensioned SVG per wall on the Framing tab.
- [x] **Dimension strings + to-scale PDF export with a title block.**
- [x] **Price catalog → priced estimate** — editable unit prices, markup, tax, CSV. (XLSX still open.)
- [ ] **IRC span tables** — headers R602.7(1) (needs snow load + building width inputs), joists R502, rafters R802; replace the header rule of thumb.
- [ ] **PDF underlay + perspective correction** for phone photos of plans.
- [x] **3D view** (three.js) incl. vaulted / cathedral / tray / coffered ceilings. (Rooms with nested rooms still get a flat ceiling.)

## Structure & takeoff

- [ ] Roof model (gable / hip / shed): squares, sheathing, trim, rafter or truss layout; gable-end wall framing above the plate for vaulted rooms
- [ ] Foundation / concrete takeoff: footings, slab, stem wall, anchor bolts, sill plate
- [ ] Floor joist layout + subfloor sheet layout
- [ ] Cut lists optimised to stock lengths, with waste report
- [ ] Layered wall assemblies (drywall / stud / sheathing / siding) instead of the +1" finish rule
- [ ] Wall bracing (R602.10)
- [ ] Multiple floors (ghosted floor below) + stairs tool checked against R311.7

## Electrical

- [ ] Switches, lighting outlets, switch-to-light links (E3903)
- [ ] Auto smoke / CO alarm placement (R314 / R315)
- [ ] Countertop and island modelling so kitchen receptacles follow real counters, not every wall
- [ ] Outdoor receptacles front + back (E3901.7), dedicated appliance circuits, AFCI
- [ ] Circuits, NEC 220 load calc, panel schedule

## Editor

- [ ] Room from enclosed walls (click inside) and non-rectangular rooms
- [ ] Drag a whole wall (move both ends together); split / join walls
- [ ] Inside / outside dimension modes (currently centreline)
- [ ] Existing / demo / new phasing; design options ("plan B") with cost compare
- [ ] Plan versions with change-order diffs
- [ ] Furniture / fixture symbols (also fixes bath basin + kitchen counter inputs)
- [ ] AI plan recognition: suggest walls / doors / windows from the underlay image (after PDF + perspective)

## Housekeeping

- [x] Public GitHub repo, Pages (dev + main branch policies), CNAME DNS, HTTPS — dev live 2026-11-01
- [ ] Create `main` (prod) via the first approved dev → main PR; prod URL shows a placeholder until then
- [ ] Code-edition picker (2018 / 2021 / 2024) once a rule actually differs between editions
