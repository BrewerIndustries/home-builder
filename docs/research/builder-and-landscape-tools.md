# Builder-Side & Landscape Tools: Feature Research

_Researched 2026-11-01. Scope: framing/estimating, roof/truss, residential electrical, code-check and landscape design tools, mapped against our Vite + React + TS client-side home builder app._

**What we already have or plan:** 2D floorplan editor, image underlay, per-wall stud size, wall and ceiling heights (vaulted, cathedral, tray, coffered), IRC Ch. 39 outlet auto-placement, IRC checks, wall framing takeoff, materials list, door and window schedule.

**About the sources:** Most product claims come from vendor pages, release notes and review aggregators. Treat them as directional, not verified. Links are at the end.

---

## 1. Landscape of products (by category)

### 1.1 Framing / BIM-framing software
| Product | Standout features | Outputs builders rely on |
|---|---|---|
| **MiTek Structure (ex-SAPPHIRE) / MiTek Supply** | Whole-house structural model: trusses, floor joists, beams, wall panels (optional Panel module). Traceable BOM and a Formula Builder. Supply targets lumber dealers doing whole-house takeoffs. Sapphire **Build** is a narrower joist/beam product with panelization and truss design disabled. | Truss and joist layouts, beam/header design, wall panel drawings, BOM, dealer quotes |
| **StrucSoft (MWF) for Revit** (Graitec) | Rule- and template-driven framing of walls, floors and roofs in wood or light-gauge steel. Auto-panelization. CNC export (Weinmann, Hundegger, Randek, Howick) including bird's mouth, notch, hole and label operations. | Dimensioned panel shop drawings, cut lists, BOM, CNC files |
| **Medeek Wall / Truss / Foundation / Project** (SketchUp) | Parametric walls with lumber, LVL, LSL, PSL, glulam, steel and CMU, plus a custom header library and Simpson hanger insertion. Truss types: common, attic, mono, scissor, dual-pitch, bowstring, tail-bearing, hip sets. Rafter roofs via straight-skeleton solver. CSV export. Estimating lives in Medeek Project; an ASCE 7-22 engineering module is in beta. | 3D framed model, CSV material counts, estimator totals (cripples, corners, garage doors, columns) |
| **Chief Architect** | Auto-generated floor and ceiling joists (size, type, direction), auto roof framing (rafter tails, overframing since X14), auto wall framing with manual override, roof and floor trusses. Materials list from the model. Users report double-counting after edits and weak plate-material control. | Framing plans and 3D, materials list, CDs |
| **SoftPlan + SoftList** | Framing mode with stud layout for wall panel diagrams. SoftList BOM **combines lumber lengths to minimize waste**. Elevations, sections, framing diagrams and cost reports auto-generated from the plan. | Wall panel diagrams, optimized lumber list, cost report |
| **Cadsoft Envisioneer** (Construction Suite) | Wall panelization (top tier). Framing optimized to **purchased lengths** and real on-site methods. Material lists with cut lists and pricing, organized into **ship loads** and pushed to POS or accounting. | Panel diagrams, cut lists, priced lists, delivery loads |
| **Simpson Strong-Tie tools** | Connector Selector (choose connectors and sort by installed cost), Hanger Selector, Deck/Pergola/Fence planners. Simpson catalog inside On Center Quick Bid. | Connector and hanger schedule and counts |

### 1.2 Takeoff & estimating
| Product | Standout features |
|---|---|
| **PlanSwift** (ConstructConnect) | On-screen takeoff from PDFs. **Assemblies**: one measurement drives material and labor, e.g. a concrete slab assembly gives concrete, mesh and labor. Footing, wall and foundation templates. Windows only. |
| **STACK** | Cloud takeoff with drag-and-drop assemblies that calculate material, waste and labor. Large pre-built assembly library. Free tier. Used across concrete, roofing and landscaping. |
| **Buildxact** | Residential builder estimating with **live supplier price lists** (pick by supplier SKU). POs straight to suppliers. Takeoff produces an order list. **Change orders built like estimates** that flow into the budget and schedule. Xero, QuickBooks and MYOB sync. |
| **Clear Estimates** | Remodel templates by project type, a custom price catalog, AI scope generation, ~20 years of residential cost data. Assembly-based. Versioned estimates. Proposals. |
| **Houzz Pro** | Takeoff from plans (AI "AutoMate" assist) converts to an estimate. Trade-specific takeoffs (framing, etc.). Proposals tied to the client thread, messaging and job status. |
| **ProEst** (Autodesk) | Commercial-oriented: cost database, assemblies, bid-day workflows. Less relevant for residential. |

### 1.3 Roof / truss calculators
- **RedX Roof**: common, hip, valley and jack rafters. Rafter length, rise, fascia height, tail length, birdsmouth. Sheathing layout.
- **Construction Master-style calculators** and ProTradeCraft methods: jack spacing (16" o.c. default), hip/valley lengths and bevels.
- Truss manufacturers (MiTek, Alpine) deliver **truss placement plans** and sealed truss drawings. Builders expect the designer to give **roof outline, pitch, bearing walls, heel height and overhangs**, then get a truss layout back.

### 1.4 Residential electrical
- **Kopperfield**: NEC Art. 220 load calc, single-line diagram and panel schedule, giving a one-page PDF for the inspector or customer.
- **Electrical Systems Pro Suite / Panel Load Calc apps**: 220 wizard, panel visualizer, 80% continuous-load check with pass/fail, wire sizing.
- **ETAP**: engineering-grade panel schedules. Overkill for residential.
- **CAD route** (Chief, SoftPlan): place symbols, export an electrical schedule, then do loads in a spreadsheet. No residential CAD tool we found does load calc natively, which is a gap.

### 1.5 Code-check / plan-review helpers
- **UpCodes Plan Review** (launched June 2026, early access): every issue links to the enforceable section. Uses the locally adopted code year and amendments.
- **Archistar eCheck**: AI pre-check. Austin uses it for single-family pre-submittal; ICC pilot on IBC.
- **Nomic**: IRC-specific (2021 and 2024), 67 jurisdictions.
- **CivicPlus CodeComply**: jurisdiction-side, includes IRC. Explicitly "informational, not a determination."
- Common pattern: **issue, code citation, location on plan, severity**, scoped by jurisdiction and code year, with a disclaimer.

### 1.6 Landscape design
| Product | Standout features |
|---|---|
| **iScape** | iOS. Design over a **photo of the actual yard**, plants and hardscape stamps, simple cost estimate. Free and Pro tiers. Homeowner-friendly. |
| **PRO Landscape (Drafix)** | Photo imaging plus CAD. 18k-object library; plants carry climate data and users can add their own. Irrigation planner on the same drawing. **Night lighting** preview. Drawing links to **Proposal** (cover rendering, quote, materials list, plant detail sheets). Material takeoffs (PRO Landscape+). |
| **Realtime Landscaping (Plus / Architect)** | Plant browser showing botanical name, type, **hardiness zones and mature height**, with zone maps for US, CA, EU, AU and MX. **Plant Growth** time-lapse (3 months to 20+ years). Terrain: building pads, driveways, slopes, spot heights. Architect adds contour lines and CAD contour import. |
| **Vectorworks Landmark** | Pro landscape BIM: site model and grading with cut/fill, planting tools with plant database and schedules, hardscape objects, irrigation design, quantity takeoffs, worksheets. |
| **SketchUp + extensions** | Sandbox terrain, Skatter/Laubwerk plants, Medeek Foundation for site. Flexible but DIY. |
| **Garden Planner / GrowVeg / Plantory / GardenCAD** | Plant spacing circles, sun and shade needs, companion planting, planting calendars. GardenCAD handles scale plus sun/shade. |
| **Home Outside** | Simple 2D symbol-based plans for homeowners (little public detail found). |
| **SiteRecon / Attentive.ai** (estimating) | Aerial measure. Mulch and soil in yd³, sod in ft² plus waste, aggregate in tons, pavers in ft² plus base yd³. **Production-rate library** gives labor hours. Exports to Aspire, BOSS, Real Green. |
| **Rain Bird design service / tools** | Head-to-head coverage, auto-place heads at optimal spacing, precipitation-rate and pressure/flow tables, zone splitting, low-PR heads on slopes. Municipal standards (e.g. Aurora CO: spacing ≤50% of diameter, pressure-loss table required). |

---

## 2. What outputs builders actually expect

1. **Framing package / lumber list** grouped by phase: sill/plates, studs by length, headers by size, joists, rafters/trusses, sheathing, hardware. Precut stud lengths (92-5/8", 104-5/8", 116-5/8") and **stock lengths** (8 to 20 ft in 2 ft increments). Waste factor shown separately.
2. **Cut list** that combines pieces into stock lengths (SoftPlan, Envisioneer).
3. **Wall framing elevations / panel drawings**: one per wall, studs dimensioned from one end, openings with king/jack/cripple/header callouts, panel IDs. These are what panelizers and framers build from.
4. **Floor framing plan**: joist size, spacing, direction, span, rim, blocking, beams/girders, posts, openings (stair) with doubled trimmers/headers. Subfloor sheets.
5. **Roof framing plan**: truss layout (type, spacing, girder trusses) **or** rafter plan (ridge, hips, valleys, jacks, collar ties/ties, birdsmouth), overhangs, sheathing squares, underlayment, drip edge, ridge vent.
6. **Foundation / concrete takeoff**: footing LF × W × D gives yd³; stem walls; slab ft² × thickness gives yd³ plus mesh/rebar, vapor barrier, gravel base; anchor bolts at 6' o.c. and within 12" of plate ends (IRC R403.1.6); hold-downs.
7. **Electrical**: device plan, circuit list, panel schedule, NEC 220 load calc.
8. **Door / window schedule** with rough openings (we have this).
9. **Priced estimate → bid/proposal → change orders → POs**, with supplier pricing and versioning.
10. **Code compliance report** with citations.

---

## 3. Consolidated feature list

Legend: **TS** = table-stakes (users expect it in this class of tool), **D** = differentiator. Effort for a client-side web app: **S** ≈ days, **M** ≈ 1–3 weeks, **L** ≈ 1–2+ months. ✅ = already built or planned.

### 3.1 Framing
| Feature | TS/D | Effort | Notes |
|---|---|---|---|
| ✅ Per-wall stud size and spacing (12/16/19.2/24 o.c.) | TS | — | Add 19.2" and 24" plus advanced framing (2 stud corners, single top plate with ties) if not present |
| ✅ Opening framing (king/jack/cripple/header) and corners/tees | TS | — | |
| Header sizing from span tables (IRC R602.7 / Table R602.7(1)) given load (roof/floor above, snow load, building width) | TS | M | Today headers are likely fixed sizes; table lookup is high-value |
| Header material choices (2-ply/3-ply dimensional, LVL, insulated box header) | TS | S | |
| **Wall framing elevations** (per-wall SVG drawing with stud positions dimensioned) | TS | M | The #1 artifact framers use; we already compute the members |
| Stud layout rules: layout from a chosen end, stack framing (align with joists/trusses above) | D | M | |
| Precut vs stock length selection by wall height; tall-wall/balloon studs | TS | S | |
| **Cut list optimization**: bin-pack pieces into stock lengths with a waste report | D | M | 1D cutting-stock heuristic (first-fit decreasing) is cheap in JS |
| Blocking: fire blocking (R602.8), drywall backing, cabinet/grab bar/TV blocking | D | S | |
| Sheathing layout per wall (OSB 4×8 or 4×9/4×10, opening cutouts, nailing schedule note) | TS | M | Gives sheet count better than ft²/32 |
| Braced wall panels / wall bracing (IRC R602.10): braced wall lines, required length, method (CS-WSP etc.) | D | L | Genuinely hard but a strong differentiator; nobody consumer-grade does it |
| Panelization: split walls into transportable panels (max length, panel IDs, panel drawings) | D | M | Medium once elevations exist |
| Hardware schedule (hangers, straps, hold-downs, hurricane ties) with Simpson-style SKUs | D | M | |
| Gable-end wall framing (raked studs under vaulted/cathedral) | TS | M | Needed because we support vaulted ceilings |
| Interior vs exterior and bearing vs non-bearing wall flag (drives headers, bracing, framing rules) | TS | S | Foundational for several features below |
| Export: CSV/XLSX lumber list, PDF framing set | TS | S–M | |
| CNC/BTL/WUP export | D | L | Out of scope unless targeting panel shops |

### 3.2 Roof & floor systems
| Feature | TS/D | Effort | Notes |
|---|---|---|---|
| Roof modelling: gable, hip, shed, gambrel, Dutch gable from the plan outline, per-edge pitch and overhang | TS | L | Straight-skeleton for hips is the heavy part. Prerequisite for all roof takeoffs |
| Roof area by pitch → **squares**, sheathing sheets, underlayment rolls, drip edge LF, ridge/hip cap LF, starter, valley flashing | TS | M (after model) | |
| Rafter framing: common/hip/valley/jack lengths, plumb/seat cuts, birdsmouth (≤1/3 depth), ridge board/beam, ceiling joists or rafter ties (R802.5.2) | TS | M | Pure trig once geometry exists |
| Rafter and ceiling joist span table checks (IRC R802.4/R802.5 tables by species/grade, live/dead/snow load) | D | M | Data-entry heavy |
| Truss layout: auto-place at 24" o.c., girder trusses at hips, truss type per zone (common, scissor for vaulted, attic, gable-end), heel height; **truss order list** | D | M | Vaulted/tray ceilings map naturally to scissor/raised-tray trusses |
| Vaulted/tray ceiling → framing implication (scissor truss vs ridge beam vs rafters with ties) | D | M | Ties our ceiling-height work to structure |
| Floor joist layout: direction, spacing, span check (R502.3 tables, or I-joist manufacturer tables), rim, blocking, beam/girder lines, posts | TS | M | |
| Floor openings (stair) with doubled trimmers and headers (R502.10) | TS | S | |
| Subfloor sheets (3/4" T&G), adhesive, squeak-free nailing note | TS | S | |
| Multi-story stacking: floor-to-floor heights, top-floor ceiling joists | TS | M | Depends on whether app supports levels |
| Attic ventilation calc (R806: 1/150 or 1/300 net free area) gives soffit/ridge vent LF | D | S | Cheap and useful |
| Dormers, valleys between intersecting roofs, crickets | D | L | |
| Decks (joists, beams, posts, ledger, footings per DCA 6) | D | M | Bridges into landscape module |

### 3.3 Foundation & concrete
| Feature | TS/D | Effort | Notes |
|---|---|---|---|
| Foundation type per building: slab-on-grade, monolithic/thickened-edge slab, stem wall/crawl, full basement | TS | M | |
| Footing takeoff: LF from exterior/bearing walls, W×D per IRC R403.1 (by stories and soil bearing), concrete yd³ plus waste | TS | S | |
| Slab: ft² × thickness gives yd³, gravel base yd³/tons, vapor retarder rolls (R506.2.3), WWM or rebar, perimeter insulation | TS | S | |
| Stem/foundation walls: CMU block count or poured yd³, rebar (R404 tables), dampproofing | TS | M | |
| Anchor bolts (6' o.c., within 12" of ends, ≥2 per plate piece) and sill plate/sill seal LF | TS | S | Easy rule-based count off our wall model |
| Interior pier/post footings sized from tributary area | D | M | |
| Frost depth by location (user-entered or county lookup) feeding footing depth | D | S | Static table client-side |
| Garage slab, driveway, sidewalks, patios (shared with landscape hardscape engine) | TS | S | Reuse the area × depth engine |
| Excavation/backfill volume | D | M | Needs grade data; pairs with landscape grading |

### 3.4 MEP (electrical focus, plus light plumbing/HVAC)
| Feature | TS/D | Effort | Notes |
|---|---|---|---|
| ✅ Receptacle auto-placement (E3901: 6'/12' rule, countertops 24"/4', islands, bathrooms, hallways ≥10', exterior, garage) | TS | — | |
| Switches and lighting auto-placement (E3903: lighting outlet per habitable room, stairs 3-way at each level, entry/exterior) | TS | M | |
| Smoke/CO alarms auto-place (R314/R315: each bedroom, outside sleeping areas, each level, interconnected) | TS | S | High value, low cost; arguably belongs in code checks too |
| Circuit assignment: required circuits (2× 20A small-appliance, laundry, bath 20A, dedicated appliance circuits) and AFCI/GFCI flags per location (E3902) | TS | M | |
| **NEC 220 / IRC E3602 dwelling load calc** (3 VA/ft², appliances, HVAC, demand factors) → service size | D | M | Gap in residential CAD tools; pure math |
| Panel schedule (spaces, breaker sizes, phase balance) and PDF | D | M | |
| Wire runs and home-run lengths (Manhattan routing estimate) → wire footage by gauge, box counts | D | M | |
| Low-voltage (data, coax, doorbell, security) layer | D | S | |
| Plumbing fixture schedule, DWV/supply rough-in counts, fixture-unit sizing | D | L | Probably later |
| HVAC Manual J-lite (envelope area × U) and duct register placement | D | L | Later; could leverage insulation data |

### 3.5 Code compliance
| Feature | TS/D | Effort | Notes |
|---|---|---|---|
| ✅ IRC check framework | TS | — | |
| Issue list with **code section citation, plan location (click-to-zoom), severity, fix hint** | TS | S | Pattern used by UpCodes, Nomic and Archistar |
| Code edition and jurisdiction selection (IRC 2018/2021/2024 plus local amendments overlay as JSON) | TS | M | Rules keyed by edition |
| Room checks: min habitable area (R304: 70 ft², 7 ft min dimension), ceiling height (R305: 7 ft; sloped ceiling 50% rule, which ties directly to our vaulted ceilings), bedroom egress window (R310: 5.7 ft² net, 44" sill, 20"W/24"H) | TS | M | Partly done; make sure sloped-ceiling rule uses our ceiling profiles |
| Hallway ≥36", door widths, stairs (R311.7: rise ≤7¾", run ≥10", headroom 6'8", handrail, guards at 30"), landings | TS | M | |
| Garage separation (R302.6), dwelling-unit fire separation | D | S | |
| Glazing hazard locations (R308.4: tempered near doors, tubs, stairs) flags on window schedule | D | M | Great tie-in to our window schedule |
| Energy: climate-zone insulation R-values (N1102 table), fenestration U-factor, wall cavity depth vs stud size check (2x4 can't hold R-20 cavity) | D | M | Natural link to per-wall stud size |
| Structural checks: header, joist and rafter spans, braced wall length, notching/boring limits | D | L | Depends on items in 3.1/3.2 |
| "Not a substitute for plan review" disclaimer and exportable compliance report PDF | TS | S | |

### 3.6 Estimating & pricing
| Feature | TS/D | Effort | Notes |
|---|---|---|---|
| ✅ Materials list | TS | — | |
| **Unit price catalog** (user-editable, per SKU/unit, CSV import/export, regional presets) | TS | M | Turns the materials list into a cost; IndexedDB storage |
| **Assemblies**: a wall/slab/roof type expands to materials plus labor via production rates (PlanSwift, STACK, Clear Estimates pattern) | TS | M | Our model already "is" the takeoff; assemblies map model objects to line items |
| Waste factors per category (lumber 10%, sheathing 5–10%, drywall 10–12%, pavers 10–15%) | TS | S | |
| Labor: production rates (e.g. LF wall/hr, sheets/hr) × crew rate | D | M | |
| Markup, overhead, contingency, tax by category | TS | S | |
| Cost breakdown by CSI division or builder phase (site, foundation, framing, roofing, MEP, finishes) | TS | S | |
| Supplier price import: CSV from a lumber yard quote; optional live pricing APIs (Home Depot Pro / 84 Lumber don't offer open APIs, so CSV is realistic) | D | S (CSV) / L (live) | Buildxact's headline feature; CSV gets 80% client-side |
| Allowances (fixtures, finishes) and alternates | D | S | |
| Optimized purchase list (stock lengths, bundle and pallet quantities: shingles 3 bundles/sq, pavers per pallet) | D | S | |

### 3.7 Project management / bids
| Feature | TS/D | Effort | Notes |
|---|---|---|---|
| Proposal / bid PDF (cover rendering, scope, priced line items, exclusions, terms, signature line) | TS | M | Client-side PDF (pdf-lib / jsPDF) |
| **Plan versions and change orders**: diff two versions → delta materials and cost → CO document | D | M | Strong fit because the model is the source of truth (Buildxact "CO like an estimate") |
| Purchase orders by supplier/phase, delivery loads (Envisioneer "ship loads") | D | S–M | |
| Phase schedule (Gantt-lite from assemblies with durations) | D | M | |
| Construction document set: plan, elevations, framing plans, schedules, notes, title block, PDF export | TS | L | |
| Project file export/import (JSON), share link (later, needs backend) | TS | S | |
| Accounting integration (QuickBooks/Xero) | D | L | Needs backend/OAuth; defer |

### 3.8 Landscape
| Feature | TS/D | Effort | Notes |
|---|---|---|---|
| **Lot boundary** (draw, or enter bearings/distances from a survey/plat), north arrow, area | TS | M | |
| **Setbacks and zoning envelope** (front/side/rear offsets, easements, lot coverage %, impervious %) with violation highlighting | D | S–M | Polygon offset (clipper-lib); pairs with code-check framework |
| Site underlay: plat/survey image or aerial screenshot, scale calibration | TS | S | Reuse floorplan underlay import |
| House footprint auto-placed from the floorplan model | TS | S | Big advantage over standalone landscape tools |
| Hardscape areas: patio, walkway, driveway, retaining wall, steps, edging; material per area | TS | M | |
| **Hardscape takeoff**: pavers (ft², units by size, +10–15% waste, pallets), base gravel (depth → yd³/tons), sand bedding, edge restraint LF, polymeric sand bags; concrete yd³; retaining-wall blocks, caps, drainage aggregate, geogrid layers | TS | M | Same area × depth engine as foundation |
| **Softscape takeoff**: mulch yd³ at chosen depth, sod ft² plus waste (pallets ~450–500 ft²), seed lbs/1000 ft², topsoil yd³, landscape fabric rolls, edging | TS | S | |
| **Plant library** with botanical/common name, type, **mature height and spread**, **USDA hardiness zones**, sun/shade, water use, bloom season, deciduous/evergreen, native flag | TS | M | Data curation is the cost; start ~200–400 common US species as static JSON |
| Plant placement shows **mature canopy circles** with spacing warnings and conflict with house/foundation (trees ≥ X ft from foundation) | TS | S | |
| Zone-aware filtering: enter ZIP → hardiness zone (static ZIP→zone table) and warn on out-of-zone plants | D | S | |
| Growth-over-time slider (year 1 / 5 / 10 / mature) | D | S | Realtime Landscaping's Plant Growth; easy in 2D |
| Plant schedule / count table with sizes (1 gal, 3 gal, 15 gal, 2" caliper) and pricing | TS | S | |
| Sun/shade study: house and tree shadows by date/time from lat/long | D | M | 2D shadow projection using wall/roof heights we already have |
| **Grading & drainage**: spot elevations, slope arrows, 5% fall within 10 ft of foundation (IRC R401.3), swales, downspout/French drain/dry well routing, contours from spot heights | D | L | v1 could be spot grades plus a slope-away check only (S–M) |
| **Irrigation**: zones (turf rotors vs spray vs drip for beds), head placement with head-to-head coverage arcs, precipitation-rate matching, pipe LF, valves and controller | D | L | v1: drip vs spray zoning and parts estimate; auto head layout later |
| **Landscape lighting**: fixture placement (path, up, wash, well), beam-spread cones, transformer sizing (sum watts × 1.25), wire gauge by run length/voltage drop | D | M | Cheap math, attractive night preview in 2D |
| Fences, gates, pergolas, decks (post, footing, board takeoffs) | D | M | Simpson-style deck/fence planners as reference |
| Outdoor living: fire pit, outdoor kitchen, pool/spa footprint with code barrier note (R326/ISPSC) | D | M | |
| Photo-mockup mode (stamp plants on a photo of the house, like iScape/PRO Landscape) | D | L | Nice-to-have, not v1 |
| 3D walkthrough | D | L | Defer |
| Landscape proposal PDF (rendering, plant pictures, quantities, price) | TS | M | Reuse estimating/proposal engine |

---

## 4. Cross-cutting architecture notes (client-side)

- **One quantity engine.** Footings, slabs, driveways, pavers, mulch and sod are all `area × depth → volume → units + waste`. Build a single "area/volume/linear/count" quantity primitive and an **assembly** layer on top. It serves foundation, landscape and estimating at once.
- **Rules as data.** Store IRC/NEC rules, span tables, hardiness zones and plant data as versioned JSON keyed by code edition. Rules are pure functions over the model, so they're testable in Vitest and run instantly in the browser.
- **Geometry libs.** clipper2 / polygon-clipping for setbacks and offsets; a straight-skeleton implementation for hip roofs (the hardest geometry item); simple 1D bin packing for cut lists.
- **Outputs.** SVG for elevations and framing plans (crisp, printable); pdf-lib or jsPDF for sets and proposals; SheetJS for XLSX.
- **Persistence.** IndexedDB for projects, price catalogs and plant favorites. Model versions are snapshots, and change orders are diffs between snapshots.

---

## 5. Top 10 recommendations (priority order)

1. **Wall framing elevations (per-wall SVG with dimensioned studs/openings)**: we already compute every member, and this is the single document framers build from (M).
2. **Unit price catalog + assemblies + waste/markup → priced estimate**: converts the existing materials list into a real bid. This is the core value every estimating tool sells (M).
3. **Header and joist/rafter span-table sizing (IRC R602.7, R502, R802)**: replaces guessed sizes with code-backed ones and feeds both the takeoff and compliance checks (M).
4. **Foundation & concrete takeoff (footings, slab, stem wall, anchor bolts, sill)**: an easy rule-based win off the wall model, and it builds the shared area×depth engine that landscape reuses (S–M).
5. **Roof model (gable/hip/shed) → roof takeoff (squares, sheathing, underlayment, trim) and rafter-or-truss layout**: a glaring gap today, and it connects our vaulted/tray ceilings to real structure (L).
6. **Code-issue report with citations, click-to-locate and edition selection; add smoke/CO alarms, egress, stairs, sloped-ceiling R305, glazing R308**: matches the UpCodes/Nomic UX pattern and maximizes reuse of our framework (S–M).
7. **Cut-list optimization into stock lengths with waste report**: a cheap algorithm that SoftPlan and Envisioneer use as a selling point and that lumber yards appreciate (M).
8. **Electrical circuits + NEC 220 load calc + panel schedule**: a natural extension of outlet auto-placement, and a gap residential CAD tools leave to spreadsheets (M).
9. **Plan versions → change-order diff (materials and cost delta) and proposal PDF**: a differentiator that falls out of having the model as the source of truth (M).
10. **Floor joist layout + sheathing/subfloor sheet layouts**: completes the framing package (walls, floors, roof) builders expect from a lumber takeoff (M).

_Honorable mentions:_ braced wall panels (R602.10, a big differentiator but L), energy/R-value vs stud depth check (S–M, ties into per-wall stud size), panelization (M once elevations exist), attic ventilation calc (S).

---

## 6. Suggested landscape module v1 scope

**Goal:** a 2D site plan that reuses the house model and quantity engine to produce a priced landscape takeoff and plan PDF. No 3D, no photo mockup, no automatic irrigation head layout yet.

1. **Site setup**: draw or enter the lot boundary (with optional bearing/distance entry), calibrated plat/aerial underlay (reuse underlay import), north arrow. The house footprint comes automatically from the floorplan.
2. **Setbacks & coverage**: front/side/rear setback offsets plus easements. Highlight violations; report lot coverage % and impervious % (runs through the existing compliance-issue UI).
3. **Hardscape areas**: patio, walkway, driveway, steps, edging and retaining wall as polygons/polylines with material presets (pavers, concrete, gravel, flagstone, block wall) and depth/base settings.
4. **Hardscape and softscape takeoff**: pavers (units, waste, pallets), base gravel and sand (yd³/tons), concrete yd³, edge restraint LF, wall blocks/caps/drain rock, mulch yd³ by depth, sod ft² and pallets, topsoil, fabric. Everything flows into the shared price catalog.
5. **Plant library v1**: ~300 curated US species as static JSON (common/botanical name, type, mature H×W, USDA zones, sun, water, evergreen/deciduous, native flag). ZIP → hardiness zone lookup gives out-of-zone warnings.
6. **Plant placement**: symbols drawn at mature spread, a growth slider (planting / 5 yr / mature), spacing/overlap and too-close-to-foundation warnings, and a plant schedule with container sizes and prices.
7. **Basic drainage check**: spot elevations around the house with an IRC R401.3 slope-away check (6" fall in the first 10 ft), plus downspout/drain symbols with pipe LF.
8. **Outputs**: landscape plan PDF (legend, plant schedule, quantity table) and a priced landscape estimate/proposal reusing the estimating engine.

**v2 candidates:** irrigation zoning plus head layout with coverage arcs; low-voltage lighting with transformer and voltage-drop math; sun/shade study from house heights; contour grading with cut/fill; decks/fences/pergolas with structural takeoff; photo-mockup mode.

---

## Sources
- MiTek Sapphire / Structure / Supply: [mitek.com.au Sapphire](https://www.mitek.com.au/software/mitek-sapphire/), [MiTek Structure](https://www.mitek.com.au/sapphire-structure), [forestsource MiTek Structure](https://forestsource.io/software/mitek-sapphire-structure), [EVstudio on Sapphire](https://evstudio.com/mitek-sapphire-and-its-place-in-an-engineering-office/), [MiTek US](https://www.mitek-us.com/?p=1643)
- StrucSoft MWF: [Graitec US](https://graitec.com/us/products/mwf-by-strucsoft-revit-framing-plugin/), [StrucSoft Wood](https://strucsoftsolutions.com/strucsoft-wood), [AUGI review](https://augi.com/articles/detail/product-review-mwf-metal-wood-framer)
- Medeek: [Medeek Wall](https://design.medeek.com/resources/medeekwallplugin.html), [Wall manual](https://design.medeek.com/resources/medeek_wall_manual.html), [Medeek Truss](https://design.medeek.com/resources/medeektrussplugin.html), [Truss docs](https://design.medeek.com/support/trusspluginmanual/frontpage.html), [Medeek Project](https://design.medeek.com/resources/medeekprojectplugin.pl)
- Chief Architect: [Framing support](https://chiefarchitect.com/support/category/19/framing.html), [General framing guidelines](https://chiefarchitect.com/support/article/KB-00465/general-framing-guidelines.html), [Pros page](https://www.chiefarchitect.com/architects-builders-remodelers/)
- SoftPlan: [SoftPlan](https://ww2.softplan.com/?p=1330), [Construction documents](https://ww2.softplan.com/?p=12634)
- Cadsoft Envisioneer: [Building Essentials](https://cadsoft.com/products/building-essentials/), [Wall panel diagrams](https://www.cadsoft.com/framing-wall-panel-diagrams/), [Novedge Construction Suite 17](https://novedge.com/products/buy-envisioneer-construction-suite-17)
- Simpson: [Connector Selector](https://strongtie.com/products/software/connector-selector), [On Center partnership](https://constructionexec.com/partner-article/on-center-software-partners-with-simpson-strong-tie-company-inc/)
- Estimating: [Buildxact suppliers](https://www.buildxact.com/uk/?p=5836), [Buildxact pricing](https://www.buildxact.com/au/construction-pricing-software/), [PlanSwift overview](https://www.softwareadvice.com/construction/planswift-profile/), [STACK vs PlanSwift](https://www.capterra.ca/compare/70808/147181/planswift/vs/stack-takeoff), [Clear Estimates vs Houzz Pro](https://go.clearestimates.com/vs-houzz-pro), [Houzz Pro takeoffs](https://pro.houzz.com/pro-help/r/how-to-use-takeoffs-on-houzz-pro), [Houzz framing takeoff](https://pro.houzz.co.nz/pro-help/r/how-to-do-a-framing-takeoff), [Autodesk lumber takeoff steps](https://www.autodesk.com/blogs/construction/framing-lumber-takeoff/)
- Roof: [RedX Roof](https://apps.apple.com/app/id1519896740), [ProTradeCraft hip/valley/jack](https://www.protradecraft.com/construction-phase/framing/video/55182006/how-to-calculate-hip-valley-and-jack-rafter-lengths)
- Electrical: [Kopperfield](https://kopperfield.com/residential-electric), [ETAP panel systems](https://etap.com/de/product/panel-systems-software), [ChiefTalk on load calcs](https://chieftalk.chiefarchitect.com/topic/33150-electrical-load-calculations/)
- Code check: [UpCodes Plan Review](https://cms-v2.up.codes/features/plan-review), [Archistar AI plan review](https://www.archistar.ai/aiprecheck/ai-plan-review/), [ICC + Archistar](https://www.iccsafe.org/about/periodicals-and-newsroom/international-code-council-collaborates-with-archistar-to-modernize-permitting-and-accelerate-housing-development), [Austin eCheck](https://austintexas.gov/node/96266), [Nomic IRC](https://www.nomic.ai/use-cases/code-compliance-of-drawings/codes/residential-code/irc), [CivicPlus](https://www.civicplus.com/?p=27869)
- Landscape: [Realtime Landscaping](https://www.ideaspectrum.com/home-landscaping-software/), [RL plant help](https://ideaspectrum.com/help/realtime-photo/adding-a-plant.html), [PRO Landscape (TLC)](https://www.totallandscapecare.com/home/article/15030822/drafixs-pro-landscape-program-enhances-design-proposals), [PRO Landscape v20](https://www.totallandscapecare.com/landscaping/drafix-software-releases-pro-landscape-version-20), [PRO Landscape+ GetApp](https://www.getapp.com/industries-software/a/pro-landscape/), [iScape (TrustRadius)](https://www.trustradius.com/products/iscape/details), [Vectorworks Landmark features](https://www.g2.com/products/vectorworks-landmark/features), [Garden planners roundup](https://macmyths.com/10-best-garden-planners-programs-and-apps/), [SiteRecon quantity takeoffs](https://order.siterecon.ai/feature/quantity-takeoffs-and-estimates), [SiteRecon landscape construction](https://order.siterecon.ai/industries/landscape-construction), [Landscape estimates guide](https://climbtheladder.com/how-to-get-automated-material-estimates-for-landscaping/), [Rain Bird layout tools](https://store.rainbird.com/how-to-design-efficient-irrigation-layouts-using-manufacturer-tools), [Aurora irrigation standards](https://Auroragov.org/UserFiles/Servers/Server_1881137/File/Residents/Water/Landscaping/Irrigation/Appendix%20D%20Irrigation%20Standards_Final_11.30.23.pdf)
- IRC section references (R304, R305, R310, R311.7, R314/315, R401.3, R403.1, R502, R602.7, R602.10, R802, R806, E3601–E3903, N1102) are from general knowledge of the 2021 IRC. Verify against the edition your jurisdiction adopted before encoding them as rules.
