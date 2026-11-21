# Backlog

Ordered roughly by value. Competitor research behind these lives in
`docs/research/` (design software; builder, estimating & landscape tools).

## Next up

- [x] **Landscape module v1** — lot (rectangle or drawn), per-edge setbacks + envelope check, coverage / impervious %, hardscape areas with depth takeoff (pavers + base/sand/edging, concrete, gravel + fabric, mulch, sod, deck area), ~40-species plant library at mature spread with zone / foundation / crowding checks, landscape lines in the estimate.
- [x] **Landscape v2** — lot from survey bearings + plat/aerial underlay; easements; retaining wall block, topsoil, edging as lines; grade/drainage (R401.3 6"-in-10-ft); grow the plant library (~300 species, regional native flag); planting beds with auto-spaced fill; site in the 3D view and on the print sheet.
- [ ] Landscape v3: editable survey curves (arc calls), easement strips mitred at lot corners, retaining-wall block sizes from a product list, faster crowding check for big bed fills, finer native-range data
- [x] **Sprinkler / irrigation layout tool** — zones over lawn and bed areas, spray / rotor / drip heads with throw radius and head-to-head coverage, pipe runs from the valve manifold and backflow device, zone flow (GPM) against the water supply, parts list in the estimate.
- [ ] Irrigation v2: hand-edited pipe routes, valve-wire takeoff, pressure-loss sizing (not just velocity), drip zone coverage
- [x] **Wall framing elevations** — dimensioned SVG per wall on the Framing tab.
- [x] **Dimension strings + to-scale PDF export with a title block.**
- [x] **Price catalog → priced estimate** — editable unit prices, markup, tax, CSV. (XLSX still open.)
- [ ] **IRC span tables** — headers R602.7(1) (needs snow load + building width inputs), joists R502, rafters R802; replace the header rule of thumb.
- [x] **PDF underlay + perspective correction** — pdf.js page picker with drawing-scale presets; four-corner straighten with optional real size. (Vector PDFs could later yield walls directly.)
- [x] **3D view** (three.js) incl. vaulted / cathedral / tray / coffered ceilings. (Rooms with nested rooms still get a flat ceiling.)

## Structure & takeoff

- [x] Roof model (gable / hip / shed): squares, sheathing, trim, rafter or truss counts; gable-end wall framing above the plate for vaulted rooms
- [x] Roof v2: per-wing roofs with valleys for L/T plans, dormers, roof on the print sheet, attic ventilation (R806)
- [ ] Roof v3: wings wider than the roof they join; dormer overhangs and windows in the estimate; hip / valley jack rafters counted individually; roof drawn in the plan editor
- [x] Foundation / concrete takeoff: slab or crawlspace footing + stem wall, anchor bolts (R403.1.6), PT sill, vents (R408.1), min-size + frost-depth checks
- [x] Foundation v2: basement type (walls, slab, footing drain R405.1, damp/waterproofing R406, foam, window wells R310), interior bearing footings (R403.1.1 minimum), pier pad size + rebar allowance, foundation in 3D; soil / storeys inputs only point to Table R403.1
- [ ] Foundation v3: Table R403.1 footing widths (needs verified values); window wells placed on the plan; sample prices for the basement lines; post / pier lines under bearing footings
- [x] Floor joist layout + subfloor sheet layout (crawlspace floors: joists over girders, piers, staggered T&G sheets; framing plan on the Framing tab)
- [x] Floor v2: joist hangers / cantilevers, openings for stairs, I-joists, floor insulation, framed floors on upper storeys
- [ ] Floor v3: stair openings on single-storey plans over a basement; one opening per flight for L / U stairs; outrigger cantilevers along joist-parallel edges; per-storey joist size / type; floor checks in the Code check tab
- [x] Cut lists optimised to stock lengths, with waste report (Framing tab: plates / jacks / cripples / sills / header plies, FFD onto 8'–16' with 1/8" kerf, boards per stock, waste %, keepable offcuts, per-board diagram, CSV)
- [x] Cut lists v2: optional "price these boards" — the Estimate uses the cut list's boards by stock length instead of plate / header LF + waste (jacks and cripples move off the stud count); top plate joints offset ≥ 24" from the cap plate's (R602.3.2)
- [x] Cut lists v3: plate joints landed on studs; roof (rafters, ridge, fascia) and floor (rim, blocking) members in the cut list; kept offcuts listed as blocking stock; a printable cut sheet
- [ ] Cut lists v4: price roof / floor members from the cut list too; barn-door blocking and dormer studs in the cut list
- [x] Layered wall assemblies (drywall / stud / sheathing / foam / siding) per wall + project defaults; faces, clear sizes and estimate follow the layers; old projects keep the +1" rule via a legacy preset
- [ ] Wall bracing (R602.10)
- [x] Multiple floors (ghosted floor below) + stairs tool checked against R311.7 — done as Storeys v1 + Lighting v4–v6

- [x] Glass walls + wet rooms (2026-11-20): Glass wall type (not framed, priced by glass, glass doors); wet-room option on a room / area (tile, membrane, cement board for drywall, linear / centre drain); R307.2, R308.4.5, NEC 406.9(C) checks
- [ ] Wet rooms v2: tile shown in 3D; drain placed / dragged on the plan (linear drain along a chosen wall); curb vs curbless threshold; niches and benches; tile size picker
- [ ] Glass walls v2: fixed panel + door split drawn on the plan; hinge side; returns / header bar options; glass height check vs the shower head

- [x] Opening tool (2026-11-20): doorless cased or arched openings, any size

- [x] Public API + MCP server (2026-11-20): personal tokens, /v1 REST, /mcp tools, versioned + rollback-able AI edits
- [ ] API v2: OAuth for MCP clients that want it (no pasted token); live push to an open app (today: conflict on its next save); per-project token scopes; storey-aware summaries

- [x] Stairs in 3D + first-person walkthrough (2026-11-21)
- [x] Open to below + railings (2026-11-21): room flag cuts the upper floor + ceiling below; Railing wall type (36" guard, priced per LF, 3D rail/posts/infill); R312.1.1 / R312.1.2 checks
- [ ] Walkthrough v2: touch joystick for phones / iPad; walk through glass-wall doors; handrails and guards in 3D; jump to a room from a list

## Electrical

- [x] **Switches, lighting outlets, switch-to-light links (E3903)** — Light / Switch tools, dashed switch legs, auto 3-way pairs in halls and garages, single-pole / 3-way / 4-way counts in the estimate.
- [x] **Auto smoke / CO alarm placement (R314 / R315)** — every bedroom, one shared alarm outside each sleeping area, one per storey; combination smoke / CO where there are fuel-burning appliances or an attached garage; 3 ft bathroom-door check.
- [x] Lighting v2: exterior lights at outdoor doors (E3903.4), switched receptacles as the E3903.2 alternative, ceiling fans
- [x] Lighting v3: stairs symbol + stairway switches at each level (other level counted); water-heater rooms, attic and crawlspace equipment lights (E3903.4); fan-only (no light kit) option; outdoor-door lights refiled under E3903.3
- [x] Lighting v4: furnace / air-handler symbols as E3903.4 equipment (+ M1305.1 30" working space, door gaps open); landing-level 4-way switch where a door opens off the landing (E3903.3); stair geometry checks (R311.7.1 width, R311.7.5.1 riser, R311.7.5.2 tread, R311.7.3 flight rise, R311.7.6 landing, R311.7.2 headroom as info); new stairs sized from floor-to-floor. Real storeys split out to Storeys v1
- [x] Lighting v5: handrail check (R311.7.8, one side at 4+ risers; R311.7.8.1 34"–38") with left / right / both / none and height; open sides found from the walls; guard check (R312.1.1, from the first riser over 30" up, 34" along a stair, 36" round the opening going down); handrail and guard lengths priced along the slope; plan handrail lines; M1305.1.3 attic equipment access listed when the attic holds equipment
- [x] Lighting v6: L- and U-shaped stairs (turn at the landing); headroom checked against the floor above once storeys exist; attic access placed on the plan (hatch symbol + passageway); under-floor access (M1305.1.4); handrail returns / continuity
- [ ] Lighting v7: winder treads; Auto lights across every storey at once; floor framing cut round stair openings (Floor v2)
- [x] Storeys v1: real multi-storey plans (floor switcher, walls/rooms per floor, stairs linking two floors); stairway switches placed on the other floor instead of only counted; headroom checked against the floor opening above
- [ ] Storeys v2: branch circuits / load calc / panel for the whole house (today per storey); Site tab independent of the active storey; split-levels; copy a storey
- [x] Countertop and island modelling so kitchen receptacles follow real counters, not every wall
- [x] Counters v2: follow wall drags; fridge and dishwasher; work-triangle and island-clearance guideline checks
- [x] Counters v3: L-shaped runs (shared corner), peninsulas (connecting-edge rule), appliance-in-corner warning, wall cabinets + range hood, NKBA landing areas
- [x] Counters v4: draw an L in one drag; corner cabinets (lazy susan / blind) in the estimate; tall pantry / oven cabinets; island seating overhang and knee space; island / peninsula receptacle note even before any outlets are placed
- [x] Counters v5: U in one drag (three walls, back wall = nearest the drag); 24" diagonal corner wall cabinet at L corners (uppers no longer double-count); clearance behind seated diners (NKBA 32" / 36" / 44"); bar-height (42") seating with 12" knee space; cabinet-by-cabinet base layout (9"–36" stock widths, sink base, fillers in the estimate)
- [x] Counters v6: wall cabinets laid out by width too (and 30" / 36" / 42" heights); drag a cabinet joint to resize neighbours; per-cabinet types (drawer base, trash pull-out) priced from the layout instead of LF; a two-level island (36" work side + 42" bar side)
- [ ] Counters v7: typed cabinet widths; per-cabinet types / widths kept through a room mirror; corner base cabinets in the joint drag
- [x] Outdoor receptacles front + back (E3901.7): auto GFCI beside an exterior door, front-of-house setting, in-use covers in the estimate
- [x] Dedicated appliance circuits, AFCI; outdoor receptacles v2: decks / balconies / porches, height above real grade
- [ ] Circuits v2: conductor sizing, voltage drop, box fill; loads for hand-placed 240 V receptacles; sloping grade for outdoor receptacle height; move the microwave / disposer to another circuit
- [x] Circuits, NEC 220 load calc, panel schedule

## Editor

- [x] Room from enclosed walls (click inside) and non-rectangular rooms
- [x] Non-rectangular rooms v2: R304 min dimension and ceiling slopes on the real outline (not the bounding box); auto-name / auto-type rooms from size and doors
- [x] Non-rectangular rooms v3: R304.2 on clear (finished-face) dimensions; tray and coffered ceilings on the real outline; show the narrowest line on the plan; pick the slope direction per room
- [ ] Non-rectangular rooms v4: room auto-guess on clear sizes; pins to room corners kept when corners are added; under-7-ft line optional on the print sheet
- [x] Drag a whole wall (move both ends together); split / join walls
- [x] Wall edits v2: double-click to split at a point; dragged walls snap in line / flush with parallel walls and the grid; live move readout
- [x] Wall edits v3: type an exact move distance while dragging; snap a dragged wall end to other walls' faces; rotate a wall about an end
- [x] Wall edits v4: typed values for opening / counter / fixture drags; rotate a whole room (walls + contents) about its centre; free-angle snap parallel / square to other walls
- [x] Wall edits v5: rotate about a picked point (draggable pivot, snaps to corners / wall ends / centre) and drag-to-rotate with a handle (15° steps, typed angle after); move a whole room (drag the selected room, arrow buttons, typed distance); mirror a room (left ↔ right, top ↔ bottom: door swings, device sides, symbol turns); typed values for outlet / switch / light drags; wall counters and backed furniture no longer re-seated onto the wrong wall after a room turn
- [x] Wall edits v6: select several items (box / Shift-click) and move, turn or mirror them together; copy / paste a room with its contents; align and distribute; mirror about a picked line
- [ ] Wall edits v7: pick a pivot for group turns; doors / devices moved on their own inside a group; clipboard kept across tabs
- [x] Inside / outside dimension modes (centreline / inside faces / outside face)
- [x] Dimensions v2: type a length as inside / outside in the wall panel; opening chains on exterior walls; room clear sizes; finished vs framing faces
- [x] Dimensions v3: dimension strings across the whole plan through interior walls; clear sizes for L-shaped rooms; opening chains on interior walls; drag a dimension line to move it
- [x] Dimensions v4: partition strings at several heights through the plan (not just one each way); clear sizes for T / U rooms; user-placed dimensions (click two points); hide / show individual strings
- [x] Dimensions v5: strings through angled partitions; keep inside strings clear of room labels automatically; placed dimensions that follow the walls they were snapped to; a running (ordinate) string option
- [x] Dimensions v6: running opening chains (totals square to the wall); placed dimensions pin to door / window jambs and centres and fixture corners / centres and follow them; angle dimensions between walls (wall panel → arc + degrees, follow the walls, gone with either); per-string Chained / Running / As the plan
- [x] Dimensions v7: angle dimensions picked on the plan with the Dimension tool (click two walls); placed dimensions pinned to counters and rooms; ordinate (baseline) dimensions; a dimension style panel (text size, tick / arrow / dot ends)
- [ ] Dimensions v8: ordinate dimensions along a sloped axis; text-size and end-style per dimension
- [x] Existing / demo / new phasing; design options ("plan B") with cost compare (Options dialog; phase filter + buttons on the Plan toolbar)
- [x] Plan versions with change-order diffs (Options → Versions: named snapshots, added / removed / changed list, per-line change order to print, restore as one undo step)
- [ ] Phasing v2: phase a multi-item selection at once; demolition lines for demolished rooms; roof / foundation / floor phased beyond new walls and rooms
- [x] Furniture / fixture symbols (also fixes bath basin + kitchen counter inputs)
- [x] Fixtures v2: symbols follow dragged walls; door-swing clearance; a kitchen sink fixture outside counters; bidet, laundry sink, freestanding range / fridge; fixture schedule on the print sheet
- [x] Fixtures v3: door-to-door swing clashes; tub clearances; WC–bidet 30" centre spacing; follow walls through a split; schedule columns for model / rough-in notes; closet rod + shelf, stairs symbol
- [x] Fixtures v4: door swing vs. fixture clearance zones (not just bodies); double / pocket / bifold door swings; schedule sort by room; closet rod double-hang and shelf-only options; tub-shower combo
- [x] Fixtures v5: pocket door framed over door + pocket (one header, no studs in the pocket, kit RO note); bypass doors; barn doors on a face track (slide-clear check on their face); corner-entry and neo-angle showers (P2708.1 on real area, 24" off the diagonal); linen cabinet / shelving unit; hardware + allowances priced
- [x] Fixtures v6: mirror a corner / neo-angle shower (door and clear zone on the other corner); double vanity (two basins, E3901.6 per basin half, priced as one cabinet + 2 faucets, two rough-ins)
- [x] Fixtures v7: curbless / walk-in showers; a barn door's blocking in the framing elevation; 3D door leaves by operation; basin positions editable on a double vanity
- [ ] Fixtures v8: walk-in opening width check; mirrored walk-ins / basin positions flip with a room mirror; barn-door blocking in the cut list
- [ ] AI plan recognition: suggest walls / doors / windows from the underlay image (after PDF + perspective)

## Housekeeping

- [x] Public GitHub repo, Pages (dev + main branch policies), CNAME DNS, HTTPS — dev live 2026-11-01
- [ ] Create `main` (prod) via the first approved dev → main PR; prod URL shows a placeholder until then
- [x] Invite-only accounts + multiple projects (device library + account sync), dev API live 2026-11-01
- [ ] Prod API: migrate prod D1, set SESSION_SECRET, deploy the Worker (before/with the first main promotion)
- [x] Accounts follow-ups: read-only share links (`?share=`), plan thumbnails, account projects cached for offline with sync on reconnect — live on the dev API 2026-11-20 (migration 0002)
- [ ] Password reset by email (needs an email provider: Cloudflare Email like Contact Capture?)
- [ ] Code-edition picker (2018 / 2021 / 2024) once a rule actually differs between editions
