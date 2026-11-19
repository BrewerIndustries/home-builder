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
- [x] Lighting v3: stairs symbol + stairway switches at each level (other level counted); water-heater rooms, attic and crawlspace equipment lights (E3903.4); fan-only (no light kit) option; outdoor-door lights refiled under E3903.3
- [x] Lighting v4: furnace / air-handler symbols as E3903.4 equipment (+ M1305.1 30" working space, door gaps open); landing-level 4-way switch where a door opens off the landing (E3903.3); stair geometry checks (R311.7.1 width, R311.7.5.1 riser, R311.7.5.2 tread, R311.7.3 flight rise, R311.7.6 landing, R311.7.2 headroom as info); new stairs sized from floor-to-floor. Real storeys split out to Storeys v1
- [ ] Lighting v5: handrail (R311.7.8) and guard (R312) checks; L- and U-shaped stairs (turn at the landing); headroom checked against the floor above once storeys exist; equipment access other than the working space (attic / crawlspace passageways, M1305.1.3–.4)
- [ ] Storeys v1: real multi-storey plans (floor switcher, walls/rooms per floor, stairs linking two floors); stairway switches placed on the other floor instead of only counted; headroom checked against the floor opening above
- [x] Countertop and island modelling so kitchen receptacles follow real counters, not every wall
- [x] Counters v2: follow wall drags; fridge and dishwasher; work-triangle and island-clearance guideline checks
- [x] Counters v3: L-shaped runs (shared corner), peninsulas (connecting-edge rule), appliance-in-corner warning, wall cabinets + range hood, NKBA landing areas
- [x] Counters v4: draw an L in one drag; corner cabinets (lazy susan / blind) in the estimate; tall pantry / oven cabinets; island seating overhang and knee space; island / peninsula receptacle note even before any outlets are placed
- [x] Counters v5: U in one drag (three walls, back wall = nearest the drag); 24" diagonal corner wall cabinet at L corners (uppers no longer double-count); clearance behind seated diners (NKBA 32" / 36" / 44"); bar-height (42") seating with 12" knee space; cabinet-by-cabinet base layout (9"–36" stock widths, sink base, fillers in the estimate)
- [ ] Counters v6: wall cabinets laid out by width too (and 30" / 36" / 42" heights); drag a cabinet joint to resize neighbours; per-cabinet types (drawer base, trash pull-out) priced from the layout instead of LF; a two-level island (36" work side + 42" bar side)
- [x] Outdoor receptacles front + back (E3901.7): auto GFCI beside an exterior door, front-of-house setting, in-use covers in the estimate
- [ ] Dedicated appliance circuits, AFCI; outdoor receptacles v2: decks / balconies / porches, height above real grade
- [ ] Circuits, NEC 220 load calc, panel schedule

## Editor

- [x] Room from enclosed walls (click inside) and non-rectangular rooms
- [x] Non-rectangular rooms v2: R304 min dimension and ceiling slopes on the real outline (not the bounding box); auto-name / auto-type rooms from size and doors
- [ ] Non-rectangular rooms v3: R304.2 on clear (finished-face) dimensions; tray and coffered ceilings on the real outline; show the narrowest line on the plan; pick the slope direction per room
- [x] Drag a whole wall (move both ends together); split / join walls
- [x] Wall edits v2: double-click to split at a point; dragged walls snap in line / flush with parallel walls and the grid; live move readout
- [x] Wall edits v3: type an exact move distance while dragging; snap a dragged wall end to other walls' faces; rotate a wall about an end
- [x] Wall edits v4: typed values for opening / counter / fixture drags; rotate a whole room (walls + contents) about its centre; free-angle snap parallel / square to other walls
- [x] Wall edits v5: rotate about a picked point (draggable pivot, snaps to corners / wall ends / centre) and drag-to-rotate with a handle (15° steps, typed angle after); move a whole room (drag the selected room, arrow buttons, typed distance); mirror a room (left ↔ right, top ↔ bottom: door swings, device sides, symbol turns); typed values for outlet / switch / light drags; wall counters and backed furniture no longer re-seated onto the wrong wall after a room turn
- [ ] Wall edits v6: select several items (box / Shift-click) and move, turn or mirror them together; copy / paste a room with its contents; align and distribute; mirror about a picked line
- [x] Inside / outside dimension modes (centreline / inside faces / outside face)
- [x] Dimensions v2: type a length as inside / outside in the wall panel; opening chains on exterior walls; room clear sizes; finished vs framing faces
- [x] Dimensions v3: dimension strings across the whole plan through interior walls; clear sizes for L-shaped rooms; opening chains on interior walls; drag a dimension line to move it
- [x] Dimensions v4: partition strings at several heights through the plan (not just one each way); clear sizes for T / U rooms; user-placed dimensions (click two points); hide / show individual strings
- [x] Dimensions v5: strings through angled partitions; keep inside strings clear of room labels automatically; placed dimensions that follow the walls they were snapped to; a running (ordinate) string option
- [ ] Dimensions v6: running style for opening chains; placed dimensions pinned to openings and fixtures (not just wall ends); angular dimensions between walls; per-string chained / running choice
- [ ] Existing / demo / new phasing; design options ("plan B") with cost compare
- [ ] Plan versions with change-order diffs
- [x] Furniture / fixture symbols (also fixes bath basin + kitchen counter inputs)
- [x] Fixtures v2: symbols follow dragged walls; door-swing clearance; a kitchen sink fixture outside counters; bidet, laundry sink, freestanding range / fridge; fixture schedule on the print sheet
- [x] Fixtures v3: door-to-door swing clashes; tub clearances; WC–bidet 30" centre spacing; follow walls through a split; schedule columns for model / rough-in notes; closet rod + shelf, stairs symbol
- [x] Fixtures v4: door swing vs. fixture clearance zones (not just bodies); double / pocket / bifold door swings; schedule sort by room; closet rod double-hang and shelf-only options; tub-shower combo
- [x] Fixtures v5: pocket door framed over door + pocket (one header, no studs in the pocket, kit RO note); bypass doors; barn doors on a face track (slide-clear check on their face); corner-entry and neo-angle showers (P2708.1 on real area, 24" off the diagonal); linen cabinet / shelving unit; hardware + allowances priced
- [ ] Fixtures v6: mirror a fixture (a neo-angle's cut on the other side; a corner shower's door); curbless / walk-in showers; double vanity (two basins, each checked as a lavatory); a barn door's blocking in the framing elevation; 3D door leaves by operation
- [ ] AI plan recognition: suggest walls / doors / windows from the underlay image (after PDF + perspective)

## Housekeeping

- [x] Public GitHub repo, Pages (dev + main branch policies), CNAME DNS, HTTPS — dev live 2026-11-01
- [ ] Create `main` (prod) via the first approved dev → main PR; prod URL shows a placeholder until then
- [x] Invite-only accounts + multiple projects (device library + account sync), dev API live 2026-11-01
- [ ] Prod API: migrate prod D1, set SESSION_SECRET, deploy the Worker (before/with the first main promotion)
- [ ] Accounts follow-ups: share a project read-only by link, project thumbnails, password reset by email, cache account projects for offline
- [ ] Code-edition picker (2018 / 2021 / 2024) once a rule actually differs between editions
