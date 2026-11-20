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
| **Plan** | SVG editor: Wall (click-click, type a length + ↵, Shift = any angle), Room (click inside closed walls to make a room of exactly that shape — L-shapes and angled walls included — or drag a rectangle; walls already on the plan are reused, never doubled; a new room is named and typed from its size, doors and counters — garage, kitchen, closet, hall, bath, living or bedroom — and Guess name & use in the Room panel re-runs it), Door, Window, Outlet, Switch, Light, Alarm, Counter and Fixture tools; endpoint + 6" grid snapping; drag wall ends, openings and outlets (a dragged end snaps onto another wall — into its thickness for a T, just outside for its face — keeping the wall square when it nearly was; Alt-drag swings an end round the other end, length kept, in 15° steps, Shift for any angle); after a drag, type a value + ↵ to set it exactly (a wall slide's distance, an end's length, a swing's angle, or how far a door, window, outlet, switch, light, counter, fixture or whole room moved, a room's turn angle, measured from where the drag started in the direction you dragged; a leading - goes back the other way; Esc clears); with Shift (free angle) a new wall or a swung end locks parallel or square to any existing wall within 3° and says which; turn a wall to an exact angle, or 90° either way, in the wall panel; drag a whole wall to slide it sideways (walls tied to it — corners and Ts — stretch to follow, room outlines too; it snaps in line or flush with parallel walls, then to the 6" grid, Shift for whole inches, and a readout shows how far it moved); double-click a wall to split it there (never through a door or window), or Split in two / Join in the wall panel (openings, outlets and switches stay where they are in the plan); undo/redo; per-wall stud size and height; per-room use and ceiling; turn a whole room (⟲ / ⟳ 90° or 15°, or type an angle) about its centre, or about a point you pick by dragging its crosshair (snaps to the room's corners, wall ends and the centre; saved with the room) — its walls, rooms inside it, counters, fixtures, furniture and ceiling devices turn with it, doors and windows ride on their walls, and walls attached from outside (corners and Ts) stretch to follow (a T stays put when the moved wall still runs through it). With the room selected, drag the round handle above it to turn it on the plan (15° steps, Shift for any angle), or drag anywhere else inside it to **move the whole room** (6" grid, Shift to the inch); the room panel also moves it by a typed step with ← → ↑ ↓. **Mirror** a room left ↔ right or top ↔ bottom across its centre: doors keep their hinge end and swing the mirrored way, outlets and switches stay on the room side, and symbols turn to match. |
| **Floorplan image / PDF** | *Import floorplan* takes a photo, scan or **PDF**. For a PDF, pick the sheet from page thumbnails and, if the title block gives a drawing scale (1/8" … 1" = 1'-0"), it comes in at true size with no calibrating. *Straighten* fixes a photo taken at an angle: click the four corners of anything that's really a rectangle, optionally type its real width and depth (which also sets the scale), and the picture is warped flat and cropped to it. *Calibrate scale*: click both ends of a known dimension and type its real length. Then trace over it. |
| **Site** | Lot outline (quick rectangle around the house or draw any polygon) with per-edge setbacks → dashed buildable envelope; hardscape / bed areas (pavers, concrete, gravel, mulch, sod, deck) with depth; ~40-species plant library drawn at mature spread; lot coverage and impervious %. Quantities roll into the Estimate. |
| **3D** | Orbitable three.js model (lazy-loaded): walls cut around doors and windows, glass, floors, and every ceiling type. Cut-away at 4 ft. |
| **Framing** | Per-wall takeoff and a dimensioned framing elevation (commons on layout, 3-stud corners, ladder backing at tees, king/jack studs, headers, cripples, sills, plates, rough openings), a **cut list** (plates, jacks, cripples, sills and header plies packed onto 8'–16' stock with a waste report, per-board cut diagrams and a CSV download), plus a roof summary (area, squares, rise, truss/rafter count and length, ridge, hips) and a foundation summary (footprint, perimeter, concrete, anchor bolts). Over a crawlspace: a **floor framing plan** (joists at spacing, broken over auto or chosen girder lines, piers, longest span) and the staggered 4×8 **subfloor sheet layout**. |
| **Estimate** | Materials list priced from editable unit prices (sample US big-box defaults until you type your own), markup and tax, by category; CSV with prices. Lumber, sheathing, wrap, batts, drywall incl. vaulted/tray/coffered ceilings, receptacles + boxes, door/window schedule, gable-end infill studs above the plate (vaulted/cathedral rooms, rafter gable ends), roof (trusses or rafters + ridge + ceiling joists, hurricane ties, sheathing, underlayment, shingles, starter, ridge cap, drip edge, fascia, soffit), foundation (slab concrete + 4" base + 6-mil poly + mesh + edge rebar, or footing + poured/block stem wall + vents; anchor bolts, PT sill, sill seal), floor framing (joists by stock length, rim, 3-ply girders, blocking, piers + pads, T&G subfloor sheets from the layout, adhesive), and landscape (pavers + base + sand + edging + polymeric sand, concrete yd³, gravel tons + fabric, mulch yd³, sod pallets, plant schedule). |
| **Dimensions** | Toolbar switch **℄ / In / Out**, saved with the project. *℄*: wall centrelines (what you draw and type). *In*: each wall's room-side face, split where walls tee in, so rooms read their clear sizes; both sides of an interior wall unless they match; overall strings to the outside face. *Out*: exterior walls and the overall strings to the outside face, interior walls on centrelines. Faces are the finished faces (wall thickness incl. drywall), mitred at corners, pulled back at Ts and run to the drawn end of a free wall. The wall panel lists both face lengths under the (centreline) length, and has **Outside face** / **Inside face** fields (or *Face length* for an interior wall with matching sides): type a face length and the wall's end moves to give it. *Dimension faces* in the Project panel switches between finished faces and framing (stud) faces 1/2" inside them. Walls with doors or windows get a **chain to each opening's centre**: exterior walls just outside, interior walls on the side of the bigger room. Rooms square to the plan show their **clear size** under the area. An L, T or U shows one per piece: the outline is cut into rectangles through its inside corners (all across or all down, whichever leaves the bigger main piece). The main piece goes under the label and each other piece sits in itself, and a cut line has no wall to take off. Plans with interior walls get **partition strings at each height the partitions stand**. Every partition within 60° of square to a string picks up the others crossing a line through its run, and a string that only repeats part of another is dropped. Angled partitions are dimensioned where they cross the string; their faces cross wider apart, by the slope. The fullest string each way runs along the bottom / right between the overall ends. The rest run through the plan and end at the exterior walls they meet there (so an L's leg is dimensioned across the leg). Each sits a third of the way along the stretch its walls share, or moves to the first of a few other places there that keeps its text off the room labels. Centrelines in ℄, both faces in In / Out. *Dimension strings* in the Project panel switches the strings between **Chained** (each piece) and **Running** (an open-circle zero, then the total so far at each tick, written outward; crowded ticks are skipped, never the end). Opening chains run too, their totals written square to the wall. **Each string can choose for itself:** select it and set *Reads* to Chained, Running, or *As the plan*. Placed dimensions stay chained. **Dimension tool (M)**: click two points to place your own dimension. It snaps to wall ends, face corners and the grid, holds square unless you press Shift, and goes in 1' out. An end snapped to a wall end or face corner is pinned to that wall end and **follows it** when walls move, stretch or turn. It also snaps to **doors and windows** (each jamb on the centreline and both faces, and the centre) and **fixtures and furniture** (corners, edge middles and centre), and follows them as they slide, move or turn. If what it's pinned to is deleted, the end stays put and lets go. The panel says what each end follows. **Angle dimensions:** select a wall and pick a wall that meets it under *Angle dimension to*. That draws an arc where the two walls' lines meet, marked in degrees, which follows the walls and goes if either is deleted. Drag the arc in or out, and press Delete to remove it. **Drag any dimension string, chain or placed dimension** in or out to tidy the plan; it's saved with the project and printed. Double-click it to put it back. **Click a string** to select it. The panel names it and can **Hide this string** (Delete hides it too), and placed dimensions are deleted instead. Hidden strings are left off the screen and the print sheet. **Show N hidden** in the toolbar brings them all back. |
| **Print / PDF** | From the Plan tab: a Letter-landscape sheet at the largest architectural scale that fits, with dimension strings, scale bar and title block. The title block says what the dimensions measure. |
| **Code check** | IRC rules with section refs and click-to-locate: R303.1 light/vent, R304 room size on the real outline (the narrowest place across an L's leg, not its bounding box; floor under 5 ft of sloped ceiling not counted, R304.3), R305 ceiling height (R305.1.1 sloped ceilings measured: 70 sq ft with 5 ft or more and 35 with 7 ft or more for habitable rooms, others flagged), R308.4 safety glazing, R310 bedroom escape openings, R311.2 egress door, R602.3 wall height/spacing, R602.7 header reminder, E3901 receptacle spacing incl. E3901.4 countertop spaces and islands, E3901.7 outdoor receptacles front and back (height warned above 6'-6" from the floor, as grade isn't modelled), E3902 GFCI (incl. outdoors), R306.2 kitchen sink, and foundation minimums: R506.1 slab ≥ 3-1/2", R403.1.1 footing ≥ 12" × 6", R403.1.4 ≥ 12" below grade, R403.1.4.1 frost depth (you enter it). Plus site checks: house inside the setback envelope, coverage, plant hardiness zone, trees too close to the foundation, plants overlapping at maturity. Lists what is *not* checked. |

### Walls

- New walls take the **Ext / Int** toggle in the toolbar. The first room you draw on an empty plan is exterior (the house outline); after that it flips to interior.
- Stud size: project defaults for exterior (2x6) and interior (2x4), overridable per wall (2x4 / 2x6 / 2x8). Finished thickness follows the stud: depth + 1" of finishes.
- Height: project default for new walls (97-1/8" — the standard "8 ft" wall that takes a 92-5/8" precut), per-wall override, and "apply to every wall".

### Roof

Set under **Roof** in the Plan tab's project panel (nothing selected): gable, hip, shed or none; pitch; eave and rake overhangs; ridge direction; trusses or rafters (size, spacing). It shows in 3D (toggle *Roof*), on the Framing tab and in the Estimate, and feeds the R905.2.2 shingle-slope check.

### Ceilings (per room)

Flat, **vaulted** (single slope rising away from the room's longest wall — across a rectangle's short side), **cathedral** (ridge parallel to the longest wall, halfway across). Slopes follow the room's real outline in the drywall area, the code checks and 3D, so an L-shaped room's vault covers just the L, **tray** (depth + inset) and **coffered** (grid spacing + beam depth). They change drywall area, add tray/coffer framing lumber, and feed the R305 ceiling-height check.

### Outlets

**Auto outlets** lays out receptacles in every room per IRC E3901 (no point on a wall run more than 6 ft from one; doorways break runs; kitchens: GFCIs along each counter space, else countertop spacing on every wall if no counters are drawn; one GFCI in baths; hall ≥ 10 ft gets one; outside, one GFCI at the front and one at the back of the house per E3901.7, beside an exterior door where there is one, at 18"). *Front of the house* in the Project panel says which side of the plan faces the street (bottom by default). Any receptacle on the outside face of an exterior wall counts as outdoor; the estimate adds an in-use (bubble) cover for each. Re-running replaces only auto-placed ones — anything you add, drag or edit becomes manual and is kept. Auto outlets draw with a dashed ring.

### Kitchen counters

The **Counter** tool (K): drag along a wall for a counter on that wall face (25" deep; a plain click gives 6 ft), or drag in open floor for an island. Select a counter to set its length and depth and **add a sink or range**; drag a wall counter to slide it along the wall, or an island to move it. Counters show in the 3D view (36" high) and the estimate (base cabinets LF, countertop sq ft, sink, range: sample allowance prices).

Sinks and ranges split a counter into separate countertop spaces. In a kitchen with counters, **Auto outlets** puts GFCIs at 44" along every space 12" or wider, no point more than 24" from one (E3901.4), and general 12 ft spacing on the walls off the counters (still GFCI). Each island space at least 24" × 12" gets one receptacle, drawn on the island and counted in the estimate. Code editions differ on island receptacles, so the check is a note. **R306.2** checks the kitchen has a sink.

A counter can also hold a **dishwasher** (24", sits under the countertop, so it doesn't split a space; dashed **DW**) or a **fridge** (36", breaks the run like a sink or range; **REF**, 70" tall in 3D). The estimate takes both out of the base-cabinet run, takes the fridge out of the countertop, and adds dishwasher and refrigerator allowances. **Tall pantry** (24") and **wall oven** (30") cabinets go in a run the same way: full height (84" in 3D, **PAN** / **OV**), they break the countertop and the wall cabinets above, come out of the base-cabinet and countertop counts, and are priced as tall cabinets (plus a wall-oven allowance). A wall oven gets the NKBA 15" landing area and is OV-1 on the fixture schedule.

Wall counters ride along with their wall: drag it, drag an end, change its length or its studs and the counter keeps its place along the wall, on the new face, cut back if the wall got shorter. Islands stay put.

The Code check adds two **NKBA guidelines** (they warn, never fail): the **work triangle** between sink, range and fridge (each leg 4–9 ft, 26 ft or less in all, measured centre to centre) and the **clearance around each island** (42" work aisle to the nearest counter, 36" walkway to a wall). **Island seating:** give an island or peninsula a *Seating overhang*. That much of its depth, at the front, is knee space with no cabinets under it: a hidden line on the plan and just the top in 3D, with a stool drawn every 24". *Seats on the other side* turns the island round in place. The guideline check wants 15" of knee space at a 36" counter; tick *Bar height (42")* for a raised top, which needs 12". The estimate adds support brackets about every 3 ft. **Clearance behind seated diners** (NKBA) is measured straight out from the seating edge to the nearest wall, counter or fixture: 44" lets someone walk past, 36" edge past, 32" is enough only with no one passing (info), and less warns. The **island / peninsula receptacle** note shows as soon as the counter is drawn, before any outlets are placed.

**L-shaped runs:** drag along one wall and carry the drag round the corner onto the next wall: one drag makes both runs, meeting in the corner (one undo step). **U-shaped runs:** drag from one wall across to the wall facing it. That makes three runs, one on each of those walls and one along the wall joining them that's nearest the drag, with a corner at each end. Every leg has to reach past its corner square. Drawing a counter along each wall from the inside corner works too. Where they overlap, the corner square is one **corner base cabinet**, a lazy susan by default (*blind corner* where a peninsula meets a run); pick either in the counter panel. It's priced as its own unit and taken out of the base-cabinet run, and the countertop counts it once. A sink, range, fridge or dishwasher reaching into that square warns (*Appliance in the corner*). **Peninsulas:** start a Counter drag on a wall counter and drag out into the room; an island that runs into a wall counter or butts a wall is a peninsula, and its receptacle spaces are measured from the connecting edge. **Wall cabinets** hang over every wall counter (dashed on the plan, 54"–84" in 3D, 12" deep) except over windows and ranges; untick *Wall cabinets above* to drop them. Where two runs with wall cabinets meet in an L, the corner is one diagonal **corner wall cabinet**, 24" along each wall, priced on its own; each run's wall cabinets stop 24" short of it. Each range gets a hood allowance. **Cabinet layout:** every run is split into stock base cabinets, 9"–36" in 3" steps, as few and as even as fit. The plan shows a tick at each joint, labelled on the selected run, and the panel lists them start to end. The run also holds the corner unit, a sink base (the sink's width rounded up to a stock size, SB33), gaps for the dishwasher, range and fridge, and the tall cabinets. Fillers make up the odd inch, against the wall or the corner, and are counted in the estimate. **Landing areas** (NKBA): 24" one side of the sink and 18" the other, 15" and 12" beside the range, 15" beside the fridge. Countertop over a dishwasher counts, and a run that turns a corner carries on round it.

### Fixtures and furniture

The **Fixture** tool (U) places plan symbols. Pick what to place from the list beside the tools: **fixtures and appliances** (toilet, bidet, vanity + basin, bathtub, shower, kitchen sink base, laundry sink, washer, dryer, water heater, freestanding range and refrigerator) or **furniture** (bed, sofa, armchair, dining table, desk, dresser). Dropped within a foot of a wall, a symbol's back goes flat against the wall face, turned to face into the room; in open floor it stays where you click. Drag to move it: it re-seats against whichever wall you drop it by, and Shift keeps it free-standing. Select one to change its type, width and depth (beds have Twin / Full / Queen / King), turn it 90°, or push it back *Against wall*. A symbol backed onto a wall rides along when that wall is dragged, stretched or turned, like a wall counter; free-standing ones stay put.

Fixtures are priced in the estimate (allowances plus a rough-in per plumbing fixture), stand up in 3D, and are checked:
- **R306.1:** the plan has a toilet, a lavatory and a tub or shower. This is info only until you draw any.
- **R307.1:**
  - a toilet or bidet needs 15" from its centre to a wall or fixture each side, and 21" clear in front;
  - toilets and bidets in the same room need 30" centre to centre (*Fixture spacing*);
  - a lavatory, bathtub or tub / shower combo needs 21" clear in front;
  - a shower needs 24" clear in front (its front is taken as the opening).
  - Walls, counters and other fixtures block these clearances; furniture doesn't.
- **P2708.1:** a shower is at least 900 sq in and 30" each way.
- **E3901.6:** once a vanity is drawn, each basin is measured to the nearest receptacle (36" max). **Auto outlets** puts a GFCI at 44" on the wall behind each vanity, unless one already serves it.

A free-standing kitchen sink base counts as the kitchen's sink (R306.2), and a free-standing sink, range and fridge count toward the work triangle the same as ones set in a counter.

**Doors:** a door's panel has *Opens*: **Hinged** (one leaf), **Double** (a pair of half-width leaves), **Pocket** (slides into the wall on the hinge end's side; *Flip pocket side*), **Bifold**, **Bypass** (two panels sliding past each other in the opening, drawn either side of the centreline) or **Barn door** (a slab on a track on the swing-side face, slid open toward the hinge end; *Other face*, *Slide the other way*). A bifold has two panels a side over 36" wide (a panel deep is a quarter of the width), otherwise two panels in all from the hinge jamb (half the width deep). The plan draws each one: arcs, the pocket dashed in the wall, or bifold Vs. A door whose sweep runs into any of these gets a *Door swing clear* warning (a layout check, not an IRC rule) with the door to click to:
- a fixture, a piece of furniture or a counter;
- **a fixture's R307.1 clear space** (e.g. the 21" in front of a toilet);
- **another door's swing**. Two doors that clash each get one.

Closet rods hang overhead, so doors swing under them. Pocket, bypass and barn doors sweep nothing. Each pocket door gets *Pocket door pocket clear*: its pocket is a door width of wall past the hinge-end jamb, and it warns if the pocket runs past the wall's end or over another door, window, receptacle or switch. A barn door gets *Barn door slide clear* over the same stretch on its face: a receptacle or switch on the other face doesn't count. The estimate adds a pocket door frame kit per pocket door, bifold hardware per bifold, and a track set per bypass or barn door. **Pocket-door framing:** the rough opening covers the door and its pocket (twice the door width + 2", the app's usual door allowance) under one header, with no studs in the pocket. The framing notes say to check the kit's own rough opening.

**Wall splits:** a fixture backed onto a wall you split stays on the piece it sits on and follows that piece when it moves.

**Fixture schedule:** the printed plan tags every fixture and appliance (WC-1, LAV-1, S-1, R-1, REF-1, DW-1 …, counter sinks / ranges / fridges / dishwashers included) and adds a second page listing mark, item, size, **model**, quantity, room and **rough-in / notes**. There's one row per kind, size and model. Set a fixture's *Model* and *Rough-in / notes* in its panel; different models get their own mark, and each distinct note is listed once. *Fixture schedule* in the Project panel orders it **by kind** (a row can cover several rooms) or **by room**: a section per room in name order, and a row never spans rooms.

Furniture is drawn on the plan and in 3D only. The exception is **Closet rod + shelf** (48" × 12" by default; the dashed shelf overhead with the rod under it, a shelf at 5' 6" in 3D), which is priced per foot of run. Its *Hang* can be **Double hang** (marked DH; two rods and shelves, at 7' and 3' 6" in 3D, priced twice) or **Shelf only** (marked SHELF, no rod, priced as a shelf). **Corner shower** (36" × 36", corner entry: glass on the front and left, the door where they meet) and **Neo-angle shower** (38" × 38", the front-left corner cut 14" back on the diagonal for the door) are showers too: SH on the schedule, R306.1's shower, 24" clear in front of the opening (square off the diagonal for a neo-angle), and the P2708.1 size check on the real floor area (a neo-angle's cut corner taken off). *Mirror* puts either one's door on the front-right instead (the neo-angle's 24" clear zone moves with it). A **Vanity + basin** can be a *Double vanity* (widened to 60" if narrower; two basins drawn): E3901.6 is checked for each basin's half of the vanity, so a receptacle at one end can pass the near basin and fail the far one. It's priced as one double vanity with two faucets and roughed in as two lavatories. **Linen cabinet / shelving unit** (24" × 18", 7' tall, LIN) is casework, priced as an allowance. A **Tub / shower combo** (60" × 32", TS on the schedule) counts as the tub or shower for R306.1. It gets the bathtub's 21" clearance, not the shower-size check. Stairs have their own symbol (treads, UP / DN arrow, cut line) from Lighting v3. **Furnace** (22" × 30", F) and **Air handler** (24" × 24", AH) are equipment symbols, each priced as an allowance (size them with a Manual J load calculation, M1401.3). Like a water heater, each needs a clear 30" × 30" working space in front (M1305.1); door gaps count as open, so a closet door in front of the unit keeps the space clear.

**Stair geometry (Lighting v4).** Select a stair to set *Floor to floor* (default: the wall height + the floor joist depth + 3/4" subfloor), *Landing at riser* and *A door opens off the landing*. A new stair gets enough risers to stay under 7-3/4" and 11" treads (14 risers and 11' 11" of run with the default 8' 1-1/8" walls and 2x10 joists). A landing is drawn as a 36" (or stair-width) platform marked LDG. The Code check works out R311.7.1 width (36"), R311.7.5.1 riser height (7-3/4" max), R311.7.5.2 tread depth (10" min), R311.7.3 rise per flight (151" max between landings) and the R311.7.6 landing size. R311.7.2 headroom (6' 8") is shown as how far back from the top the floor opening above has to run; it isn't checked, because the plan is one storey. Handrails, guards, nosings and winders are not checked.

**Handrails and guards (Lighting v5).** A selected stair has *Handrail* (right side, left, both or none, walking up from the foot) and *Handrail height* (36" by default). The Code check wants a handrail on at least one side of a flight of four or more risers, 34"–38" above the nosings (R311.7.8, R311.7.8.1). Sides not against a wall are open: once the stair climbs more than 30", R312.1.1 wants a guard there, from the first riser over 30" up and 34" high along the stair (R312.1.2), or a 36" guard round the floor opening for a stair going down. Untick *Guards on the open side* to see the failure. Handrails are drawn as a line 2" in from each railed side. The estimate prices handrail and guard by the foot, measured along the slope. When the Project panel says the attic holds equipment, an M1305.1.3 note lists the access it needs (20" × 30" opening, 30" × 22" passageway no more than 20 ft long, 30" × 30" service space); it isn't placed on the plan. Grip size, returns, continuity and guard openings are not checked.

**Cut list.** The Framing tab lists every piece cut from dimensional stock — the three plates per wall, jacks, cripples, flat window sills and each header ply — grouped by lumber size. Pieces are packed first-fit-decreasing onto 16' boards with a 1/8" kerf per cut; each board is then cut down to the shortest stock (8', 10', 12', 14' or 16') that holds its pieces, and a header longer than 16' gets a 20' board. Plates longer than 16' are split: the bottom and cap plates into equal pieces, the top plate with its joints at least 24" from the cap plate's (R602.3.2) — shifted 24" either way, or in one more piece when a shifted piece won't fit a 16' board. The table shows boards to buy per stock length, stock and cut LF, waste % and how many offcuts are 12" or more (keep them for blocking). Click a size for each board's cuts drawn to scale; *Download CSV* exports one row per cut. Full-height studs (bought at length) and LVL headers (ordered by length) aren't packed. By default the Estimate prices plates as 16' boards and headers as 12' stock, plus the waste factor. Tick *Price these boards in the Estimate* (Cut list v2) and those lines become the cut list's boards by stock length (e.g. "2x6 board, 14'", priced per foot); jacks and cripples then come off those boards, so they drop out of the stud count.

### Lights, switches and alarms

**Auto lights** puts a ceiling light in every room (at the centre, or the point furthest from the walls in an L-shape), a wall switch 6" past the latch side of the room's main door at 48", and a 3-way pair in halls and garages with two or more doors. Smoke alarms go in each bedroom and one outside each sleeping area, about 3 ft out from the bedroom doors (doors within 20 ft share one). With no bedrooms there is one on the floor. Those outside alarms become **combination smoke / CO** when the Project panel says there are fuel-burning appliances, or a garage has a door into the house (R315).

Dashed curves show which lights each switch runs. Select a switch to tick or untick lights. A new light joins the switches already running its room, and a new switch runs the lights of the room it faces. Two switches on one light count as 3-ways, and more add 4-ways in between. Re-running keeps anything you dragged, edited or placed by hand, as with outlets.

Every outdoor door (a door in an exterior wall; anything wider than 6 ft counts as a vehicle door and is skipped) gets an **exterior wall light** beside it on the outside face, switched from inside at that door — on the room's own switch when it's already there. Select a light to make it a **ceiling fan** (priced with a fan-rated box) or an exterior light. A fan with its light kit counts as the room's light; untick *Light kit* for a fan only, which doesn't, so Auto lights adds a ceiling light 3 ft beside it. Select a switch to tick **switched receptacles** in its room too; they get a small S, and in bedrooms, living rooms and other rooms they satisfy E3903.2 instead of a ceiling light. Ticking an auto receptacle makes it yours, so Auto outlets keeps it.

The checks cover the following:
- **E3903.2 / E3903.3:** a wall-switched light in each habitable room, bath, hall and garage. Bedrooms and living rooms pass with a switched receptacle instead, and only warn without either.
- **E3903.3:** a wall-switched exterior light beside each outdoor door (within 8 ft), vehicle doors excepted. (Earlier versions filed this under E3903.4; it is item 2 of E3903.3.)
- **E3903.3 stairways:** each **Stairs** symbol (Fixture tool, under Furniture: set its risers and whether it goes up or down; the foot on this floor is its front, marked UP / DN) needs a wall-switched light over the flight. With six or more risers it needs a switch at each floor level: Auto lights puts a light over the flight and a switch on the wall nearest the foot. That switch counts as a 3-way, and its partner on the other floor is counted in the estimate, since the plan is one storey. When the stair has a landing with a door opening off it, the landing is a floor level too: Auto lights adds a switch on the wall nearest the landing (a 4-way between the two 3-ways), and E3903.3 checks for it.
- **E3903.4:** a room holding a water heater, furnace or air handler gets a switched light, even a closet too small for one otherwise. The Project panel asks how the attic (when there's a roof) and crawlspace (crawlspace foundation) are used. Storage or equipment there adds a light switched at the access to the estimate; until you answer, the check is info.
- **R314.3:** a smoke alarm in each bedroom, outside each sleeping area and on each storey, and not within 3 ft of a bath door.
- **R315.3:** a CO alarm outside sleeping areas when one is required.

"Immediate vicinity" has no number in the code, so the app reports the distance and leaves the call to the inspector.

### Added 2026-11-19 (multi-agent batch)

- **Wall layers.** Each wall is a stack of layers (drywall, studs, sheathing, foam, siding), editable per wall and as project defaults (Project panel). Thickness, finished and framing faces, clear sizes and the estimate (drywall per face, sheathing and foam sheets, siding squares) all follow the layers. Older projects keep the old +1" rule through a legacy preset; use "Use the current presets" to switch. Layer thicknesses are common product sizes, not code values.
- **Resize fixtures by dragging.** Double-click a fixture or piece of furniture to show handles on its corners and edge midpoints; drag one to resize it (the opposite edge stays put; Alt grows it evenly about its centre). Whole inches, a live W × D readout, one undo step per drag; works on turned items along their own sides. Esc or selecting something else puts the handles away. Exact sizes still go in Width / Depth in the panel.
- **Glass walls and wet rooms** (`src/calc/wetRoom.ts`, `src/editor/WetRoomField.tsx`). The Wall tool's new **Glass** button (or Type → Glass on a wall) draws a frameless shower screen: 3/8" tempered, 6' 6" tall by default. It closes rooms like any wall but takes no studs, plates, drywall or receptacles. It's priced per sq ft of glass plus a shoe / U-channel, and a door in it is a frameless glass door, not a schedule door. 3D draws it as a glass pane. Tick **Wet room** on any room or area, with a linear or centre drain and tile full height or to a set height. The plan shows a 12" tile grid and the drain. The estimate gets a *Tile & glass* group (floor + wall tile with openings off, waterproofing membrane, 1/2" cement backer board, thinset/grout, a sloped mortar bed) and the drain under Plumbing. The cement board replaces the drywall on those wall faces. Checks: R307.2 (wet-room tile at least 6 ft), R308.4.5 (safety glazing, info), and NEC 406.9(C), which flags receptacles within 3 ft horizontally / 8 ft up of a tub, shower or wet-room floor; the zone doesn't reach through a wall. Sample prices are ballpark allowances.
- **Opening tool (P)**, the Door tool's sister: click a wall to cut a doorless opening, 36" × 80" to start and any width or height after. In the panel, set the **Top** to Square (a cased opening) or Arched, with a rise from springline to crown (half the width = half-round). Under the hood it's a door with `operation: 'open'` (`isOpenWay`). It's framed like a door (header, kings, jacks), has no leaf or swing, and isn't in the door schedule. It's priced as a *Cased opening trim kit* or *Arched opening kit* allowance, and never counts as the egress door. The plan shows the jambs with a dashed head (or arch); 3D fills the arch's corners.
- **Area tool (E): rooms without walls.** Drag a rectangle, or click corners one by one (close on the first corner, double-click or Enter; Backspace removes the last corner, Esc cancels), to mark out a room with no walls of its own — a kitchen or dining area in an open plan. It snaps to wall ends and the grid, is drawn with a dashed edge, starts as "Area N" (use Other) for you to name, and keeps its outline: it is never flagged or re-fitted to walls. Drawn inside a walled room, it comes off that room's floor area like a closet does.
- **Redefine rooms when walls change.** A room whose walls were removed or added shows "Walls changed" in its panel, with **Re-fit to walls**. Re-fitting traces the room from the walls as they are now: if a dividing wall is gone, the neighbouring room is merged in (this room keeps its name, use and ceiling); if a new wall cuts through it, the room keeps the larger part and the cut-off part becomes a new room. The Project panel has **Re-fit all rooms to walls**, and clicking inside the changed area with the Room tool re-fits the room instead of adding a second one. Rooms whose walls leave a gap are flagged and left as drawn; closets with their own walls are kept. One undo step.
- **Office room use.** Rooms can be used as an Office. It counts as habitable (70 sq ft / 7 ft checks, a required light), gets AFCI on its circuits like a den, and is not a sleeping room (no smoke alarm required in it).
- **Rooms v3.** R304.2 (7 ft minimum) is checked between finished faces, and the line that measures it is drawn on the selected room, in red when a habitable room is under 7 ft. Tray and coffered ceilings follow L, T and angled outlines. Vaulted and cathedral rooms can pick their low side or ridge edge.
- **Wall edits v6.**
  - Drag a box on empty canvas, or Shift-click, to pick several items. Drag any of them to move them all.
  - The group has a turn handle, and a bottom panel to turn, mirror (about the centre or a picked line), align, distribute, copy, paste or delete.
  - When rooms are in the pick, the same panel sets ceiling style, ceiling height and use for all of them at once (one undo step; mixed values show as "mixed").
  - ⌘C / ⌘V copies a room with all its contents.
  - Panning is now Space-drag, middle button or scroll.
- **Dimensions v7.**
  - The Dimension tool has Linear, Angle and Ordinate modes. Angle: click two walls. Ordinate: click an origin, then points; Esc finishes.
  - Placed dimensions also pin to counters and rooms.
  - Plan settings has Dimension text size and end style (ticks, arrows, dots) for the plan, print and PDF.
- **Counters v6.**
  - Wall cabinets are laid out by width (W3030-style labels) at 30", 36" or 42" tall.
  - Drag a joint dot to resize the neighbouring cabinets (3" steps, 9"–36").
  - Each base cabinet can be standard, drawer, trash pull-out or sink base, and new counters are priced cabinet by cabinet. Older runs stay per foot until changed.
  - Islands can be two-level (36" work side plus a 42" bar ledge).
- **Fixtures v7.** Curbless walk-in showers (open side, 24" clear, P2708.1 size). Barn doors get blocking in the framing elevation and the takeoff. The 3D view shows door leaves by operation. Double-vanity basins can be moved, and each is checked against E3901.6.
- **Cut lists v3.**
  - Plate joints land on full-height stud centres, with top-plate joints still at least 24" from the cap plate's.
  - Roof members (rafters, ridge, hips, valleys, ceiling joists, dormer rafters, fascia) and floor members (rim, girder blocking) get their own sections. "Price these boards" still buys only the wall boards.
  - Offcuts of 12" or more are listed as blocking stock, and "Print cut sheet" prints a board-by-board sheet.
- **Roof v2.**
  - L, T and U plans are roofed wing by wing, with valleys. Untick "Roof each wing" for one box roof.
  - Gable and shed dormers each have their own takeoff.
  - A roof-plan print page is added.
  - Attic vent area follows R806.2: 1/150, or 1/300 when you tick the exception. It is priced as ridge vent, louvers or edge intake at typical product ratings.
- **Electrical.**
  - **Branch circuits.** Devices are grouped onto circuits automatically: two 20 A kitchen circuits, 20 A laundry and bath circuits, room-by-room general circuits, and a dedicated circuit per fixed appliance. Loads come from the nameplate figure you enter, or a flagged typical figure until you do. AFCI and GFCI are flagged per circuit.
  - **Electrical tab.** A dwelling load calc (NEC 220 standard or optional method) with a recommended service size. Ranges and ovens are taken at nameplate, since Table 220.55 isn't applied.
  - **Panel schedule.** Printable, with leg A/B balance.
  - **Outdoor receptacles v2.** Height is checked above grade, and decks or porches that a door opens onto get a receptacle.
- **Landscape v2.**
  - The lot can be built from survey calls (bearings and distances, with closure shown).
  - A plat or aerial underlay can be traced over.
  - Easements can be edge strips or drawn shapes.
  - Retaining walls, topsoil and edging go into the estimate.
  - The Grade tool checks R401.3 (6" of fall in the first 10 ft).
  - The plant library has 353 species with a regional native ★, and "Fill bed" plants a bed at mature spacing.
  - The site shows in 3D and prints from the Site tab.
- **Irrigation (Site → Irrigation, key I).**
  - Zones cover lawn and bed areas, with spray, rotor and drip heads.
  - Auto-layout spaces heads head-to-head.
  - Coverage is sampled on a grid: red is dry, amber is reached by only one head.
  - Pipe runs from the backflow device through the manifold to the heads. PVC is sized to keep water at 5 ft/s or less (a rule of thumb).
  - Zone GPM is checked against the supply, and the parts list goes into the Estimate. Nozzle figures are typical and editable.

- **Phasing and design options.**
  - Each plan item is Existing, Demolish or New. New is the default, and older projects are all new.
  - On the plan, existing items are drawn grey, demolition dashed and new solid. The toolbar filter shows the existing plan, the demo plan, the new plan or all of it.
  - The estimate prices new work only, plus a demolition allowance for each kind of item and a dumpster.
  - To start a remodel, use Options → "Mark everything existing", then draw the new work.
  - Options → Design options keeps named alternates in the project and compares their costs side by side, all on one price list.
- **Versions.**
  - Options → Versions saves named, dated plan snapshots. Neither the plan image nor the site image is copied into them.
  - Compare any two versions, or one against the current plan, to get a list of what was added, removed or changed, and a per-line change order you can print.
  - Restoring a version is one undo step.
- **Foundation v2.**
  - New basement type: wall height, poured or block, slab floor, footing drain (R405.1), damp- or waterproofing (R406), foam board, and window wells checked against R310.
  - Interior walls can be marked bearing to get their own footing, checked against the R403.1.1 minimum. Pier pads take a size and a rebar allowance.
  - Soil-bearing and storey inputs only remind you to look the width up in Table R403.1.
  - The foundation shows in 3D, with a Foundation toggle.
- **Accounts.**
  - Projects → Share on an account project creates a read-only link (`?share=…`). Anyone with the link can view, print, download or "Save a copy" without signing in. D1 keeps only a hash of the token.
  - The Projects dialog shows a small thumbnail of each plan.
  - Account projects are cached on the device and open offline. Edits made offline sync when you're back online: the open project goes through the conflict banner, the others are last-write-wins with a notice.
  - Live on the dev API since 2026-11-20 (migration 0002). Prod needs `npm run migrate:prod` and `npm run deploy` with the first prod release.

- **Storeys v1.**
  - The floor switcher at the top-left of the plan adds floors above or a basement, renames them and sets floor-to-floor height.
  - The floor below shows faint, and stair openings are hatched.
  - Framing, estimate, code checks, 3D and print cover every storey. The roof sits on the top floor and the foundation under the lowest.
  - Stairs link floors: an up stair opens the floor above, its headroom is checked against that opening (R311.7.2), and Auto lights puts the second stair switch on the other floor.
- **Lighting v6.**
  - Stairs can be straight, L or U, turning left or right. Each flight is checked on its own, and the landing is checked against R311.7.6.
  - Headroom is checked along the walk line.
  - An Attic access hatch (Fixture tool) is checked against M1305.1.3 (20"×30" opening, passageway, 30"×30" service space). Handrail continuity (R311.7.8.2) and under-floor access (M1305.1.4) get info notes.

- **Floor v2.**
  - Joists can hang flush between girders.
  - Cantilevers are set per edge. The back-span rule of thumb is labelled as such, not as a code figure.
  - Stair openings are framed with doubled headers and trimmers.
  - I-joists can be picked by series and depth, priced per foot with rim board.
  - Floor insulation batts are added only when chosen.
  - Storeys above the lowest get a real framed-floor plan on the Framing tab, bearing on the walls below. Joist direction, cantilevers and insulation are set per storey.

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
- Fixture symbols follow only the wall their back sits on; after a wall is split, the half that got a new id leaves its fixtures where they were (*Against wall* re-seats them). Tub clearances and fixture-to-fixture centre spacing aren't checked, and the door-swing check doesn't look at other doors' swings.
- Partition strings skip walls leaning more than 60° from square to them, and rooms that aren't square to the plan get no clear size. The label keep-clear is a text-width estimate and only tries a few places, so a crowded plan can still need a string dragged clear.
- Room dimensions are measured on the room outline (wall centrelines), not the clear space between finished faces, so R304.2 reads a few inches generous. The narrowest place only counts edges that face each other within 30°, so a chamfered corner isn't a "width". Tray and coffered ceilings still use the bounding box, and the auto name / use is a size-and-doors guess (a 6' × 10' laundry reads as a bath).
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
