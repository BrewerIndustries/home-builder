# Backlog

Ordered roughly by value. Competitor research behind these lives in
`docs/research/` (design software; builder, estimating & landscape tools).

## Next up

- [ ] **Landscape module v1** — lot boundary (drawn or from survey bearings), plat/aerial underlay, house footprint pulled from the plan; setback/easement envelope with violation highlights; lot coverage + impervious %; hardscape polygons with material + base-depth presets; one area × depth takeoff engine (pavers, base gravel/sand in yd³/tons, concrete, wall block, mulch, sod, topsoil, fabric); curated plant library (~300 species: mature size, USDA zone, sun, water, native) drawn at mature spread with spacing / too-close-to-foundation warnings; R401.3 6"-in-10-ft grade check; plant schedule.
- [ ] **Wall framing elevations** — dimensioned SVG per wall from the takeoff we already compute (what framers actually build from).
- [ ] **Dimension strings + to-scale PDF export with a title block.**
- [ ] **Price catalog → priced estimate** — editable unit prices, waste/markup, CSV/XLSX.
- [ ] **IRC span tables** — headers R602.7(1) (needs snow load + building width inputs), joists R502, rafters R802; replace the header rule of thumb.
- [ ] **PDF underlay + perspective correction** for phone photos of plans.
- [ ] **3D view** (three.js) incl. vaulted / cathedral / tray / coffered ceilings.

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
