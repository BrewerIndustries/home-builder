# Home Design / Floorplanning Software: Market Scan

_Researched 2026-11-01. Scope: consumer and professional residential design tools, and what they suggest
for our browser-based (Vite + React + TS, client-side) home builder app._

> **Pricing caveat:** vendor price pages are often JS-rendered or regionalised, and third-party listings
> (Capterra, G2, review blogs) disagree. Treat the figures below as rough tiers ("free / ~$5–30/mo /
> ~$100+/mo / perpetual"), not quotes. Where sources conflicted, the range is shown.

---

## 1. Product-by-product

### Consumer / prosumer

| Product | What it is | Rough pricing | Standout features |
|---|---|---|---|
| **Floorplanner** | Browser 2D/3D floorplanner, long-running, popular with estate agents and DIYers. | Free (1 floor, SD watermarked exports); Plus ~$5/mo; Pro ~$29/mo. Credit system for HD renders/exports; credits never expire. | Very fast in-browser drawing; huge furniture library; credit-based pay-per-export; DXF export (not DWG); "auto-furnish" and AI room styling; embeddable viewer for listings. |
| **RoomSketcher** | Browser + iPad floor plan and 3D home design tool aimed at homeowners, agents, and pros. | Free tier; paid Plus/Pro subscriptions (pro ~$50–$100/yr range reported); pay-as-you-go plan orders. | Polished "brochure" 2D plans (colour, textures, furniture); **Live 3D** walkthrough; 3D Photos and 360 views; measurements + total area; **print to scale**; 170+ electrical symbols added 2026 (per aggregators); AI Render (2026); order-a-plan service (they draw it from your sketch). |
| **Planner 5D** | Freemium web/mobile/desktop 2D/3D interior + home planner with a big consumer audience. | Free with locked catalog; Premium subscription (price not confirmed in 2026 sources; historically ~$5–30/mo or one-off). | **AI floor plan recognition** (upload a photo/scan of a plan → editable 3D in ~1–2 min); AI design generator; gamified/easy UX; huge catalog; cross-device sync. Users report finicky wall snapping. |
| **SmartDraw** | General diagramming tool with floor plan templates and symbol libraries. | ~$8/mo individual, ~$7/user/mo team, ~$5/user/mo site (billed annually). | Template-first; huge symbol libraries (electrical, HVAC, plumbing, landscaping, site plans); auto-dimensioning; integrations (Visio import, Confluence, Google/Office). Weak for real architecture. |
| **Sweet Home 3D** | Free, open-source (GPL) desktop Java app with an online JS version. | Free (paid store versions exist). | Straight/round/sloping walls with keyboard-typed lengths; **live 2D↔3D split view**; import plan image as background with scale calibration; furniture list with CSV export; SVG/PDF/OBJ export; plugin ecosystem; photoreal render + sun position. Good "baseline" reference for us since it's open source. |
| **HomeByMe** (Dassault Systèmes) | Browser 3D home design with real branded furniture (IKEA-type catalogs). | Free (~2–3 projects, a handful of HD renders); ~$25–32/mo or ~$329/yr unlimited; pay-per-render packs. | **Real manufacturer catalog** (shoppable); photoreal HD renders; kitchen configurators; 360 images; community gallery. |
| **magicplan** | Mobile-first scan-to-plan app for contractors, insurers, restoration. | Free (2 projects); pro ~$40/project or ~$75–90/user/mo; enterprise. | **LiDAR / camera room scan** (<1 min/room) → 2D/3D plan; photos and notes pinned to plan; **estimate from price list** auto-calculated from geometry; Xactimate ESX export; forms/checklists; PDF reports. |
| **Live Home 3D** (BeLight) | Native Mac/Win/iOS home designer, consumer-friendly but deep. | Free basic; Pro ~$40/yr or ~$100 lifetime (Mac App Store); Windows ~$100 one-off. | Real-time 2D/3D; **12 roof templates + 16 dormers**, editable roof segments; **elevation view** for openings and wall panels; terrain editing; export FBX/glTF/OBJ/USDZ; 360 panoramas; AR (iOS). |

### Professional / builder

| Product | What it is | Rough pricing | Standout features |
|---|---|---|---|
| **Chief Architect / Home Designer** | Industry-standard residential CAD/BIM. Home Designer = consumer line (rebranded 2026: Pro is legacy; single "Home Designer" product); Chief Architect Premier = pro. | Home Designer ~$79/mo or ~$495/yr; Premier ~$229/mo or ~$1,995/yr. Older perpetual: HD Suite ~$129, HD Pro ~$595. | **Auto framing** (studs, joists, rafters, trusses, beams, posts; lumber/steel/engineered) fully editable; **materials list with pricing** (Master List pricing management deprecated in 2026); auto roofs from wall bearing; auto dimensions; **tray / vaulted / curved ceilings** (curved/tray = Premier); cabinets and stairs tools; electrical auto-placement; elevations/sections; layout sheets/CDs. Closest competitor to our planned scope. |
| **SketchUp** (Trimble) | General 3D modeller widely used for residential via extensions. | Go/Pro/Studio subscriptions (~$120–$750/yr); extensions extra. | Push/pull modelling; LayOut for construction docs; **Medeek Wall / Truss** extensions (~$75/yr each) give parametric wall framing, trusses, framing elevations with auto-dims, material schedules, truss engineering data; 3D Warehouse. Shows demand for parametric framing + takeoff. |
| **Cedreo** | Cloud 2D/3D design for home builders, remodelers, and sales teams. Optimised for speed (a plan + renders in ~2h). | Free (1 project, 5 renders); paid ~$129–159/mo (Pro/Enterprise); per-project personal plan reported. | Very fast wall/room drawing; **auto roofs**; photoreal renders in minutes; **import existing plan image to trace**; brandable plan sheets for customer proposals; team/role management; floor plans with dimension/area tables. Builder sales tool rather than construction CAD. |
| **Revit** (Autodesk) | Full BIM; overkill for most single-family, but defines pro expectations. | ~$2,900+/yr. | Parametric families; **schedules** (doors, windows, rooms, materials) live-linked to model; **phasing** (existing/demo/new); **design options**; sections/elevations auto-generated; IFC export; energy analysis; toposolids (2026). |
| **ArchiCAD** (Graphisoft) | BIM favoured by small/residential firms. | ~$250+/mo. | Best-in-class **stair maker** (polyline-guided, winders, auto landings, code-rule checks); **zones** with area calcs; **renovation status** (existing/demolish/new) filters; **design options** (AC28); BIMx interactive model sharing; IFC. |

### AI floorplan tools

| Product | What it is | Rough pricing | Standout features |
|---|---|---|---|
| **Maket.ai** | Generative residential layout tool (Montreal; $3.4M raise). | Free; ~$20–30/mo credit-based (≈20 credits/floor, 10/render). | **Text-prompt / constraint-driven layout generation** (rooms, sqft, adjacencies, lot size, setbacks); conversational edits; multi-floor (up to 4); "zoning compliance" Q&A; renders. Maket 2.0 planned for Q1 2026. |
| **Planner 5D AI** | (above) | | Photo/scan of a plan → editable 3D; AI interior styling; offers a B2B API. |
| **CubiCasa** | Scan-to-plan for real estate (phone video walk-through → plan, 6–24 h turnaround, LiDAR improves accuracy). | Per-plan pricing. | Their open **CubiCasa5k** dataset/model is the de facto research base for raster→vector plan recognition. |
| **GetFloorplan** | Upload 2D plan → AI-generated 3D plan renders and virtual tours for real estate. | Per-plan. | 2D→3D marketing visuals from existing drawings. |
| **Others** (RasterScan OSS, FloorAI, Krea nodes, Homestyler AI, RoomSketcher AI Render) | Sketch/photo→plan, AI restyling, AI renders. | Mostly freemium. | Mostly image-generation wrappers; quality degrades on blurry/cluttered inputs; few produce true editable vector geometry. |

**Market takeaways**
1. Consumer tools compete on ease + catalog + pretty renders; almost none do structure, code, or takeoff.
2. Pro residential tools (Chief, Medeek-on-SketchUp) own framing/takeoff/ceilings, but are desktop, expensive, and steep to learn.
3. **Gap we can occupy:** a browser-native tool that's as easy as Floorplanner but understands construction (stud size, framing, IRC checks, takeoff). Nobody consumer-grade does IRC checks.
4. AI is moving fastest on (a) plan image → vector and (b) prompt → layout. Both are hard to do well; most "AI" features are render/restyle wrappers.

---

## 2. Consolidated feature list

**Legend:** **Common** = T (table-stakes: most tools have it), C (common in pros or many consumer tools), D (differentiator: few or none have it).
**Effort** for a client-side web app: S (days), M (1–3 weeks), L (month+ / research). ✅ = already in our current/planned scope.

### 2.1 Drawing / editing UX

| Feature | Common | Effort | Notes |
|---|---|---|---|
| Wall drawing with snapping (endpoint, angle, grid, perpendicular) | T | ✅ | |
| Typed lengths/angles while drawing | T | ✅ | Sweet Home 3D, Chief |
| Rooms auto-detected from closed walls, with area + perimeter | T | ✅ (verify auto-detect) | |
| Doors/windows that cut walls, with swing direction and flip | T | ✅ | |
| Undo/redo with unlimited history | T | S | |
| Auto dimension strings (overall, wall-to-wall, opening centres) | T (pro) / C | M | Chief, Medeek. Big perceived-quality win |
| Temporary/"live" dimensions while dragging, click-to-edit | C | S–M | |
| Interior vs exterior vs centreline dimension modes | C | S | Matters with stud sizes |
| Multi-select, copy/paste, mirror, rotate, align | T | S–M | |
| Wall split/join/extend/trim, curved walls | C | M | Curved = M |
| Multiple floors/levels with ghosted underlay of floor below | T | M | |
| Stairs tool (straight/L/U, winders) with rise/run computed | C (pro), T for multi-storey | M–L | Ties into IRC R311.7 checks |
| Room labels, finish/flooring per room | T | S | |
| Furniture/fixture library (2D symbols) | T | M | Catalog breadth is a content problem, not code |
| Kitchen/bath cabinets with standard sizes | C | M | |
| Layers / visibility toggles (furniture, electrical, dims, framing) | C | S | |
| Keyboard shortcuts + command palette | C | S | |
| Metric/imperial with ft-in input parsing (`12'6"`) | T | S | |
| Templates / starter plans | C | S | |
| Mobile/touch editing | C | M | |
| Design options / variants (compare two layouts) | D (Revit/ArchiCAD only) | M | Cheap with immutable state |
| Existing / demo / new (renovation phasing) | D | M | Huge for remodelers |

### 2.2 Import / scan

| Feature | Common | Effort | Notes |
|---|---|---|---|
| Image underlay with 2-point scale calibration, opacity, rotate | C | ✅ | Sweet Home 3D, Cedreo |
| PDF underlay (render page via pdf.js) | C | S | Most real plans are PDFs |
| Perspective/skew correction for photographed plans | D | M | 4-point homography in canvas |
| DXF import (lines as trace layer) | C (pro) | M | dxf-parser libs exist |
| Auto wall detection from image (raster→vector) | D | L | CubiCasa5k-style model via ONNX/WebGPU, or server/LLM vision |
| LiDAR / phone room scan (Apple RoomPlan) | C (magicplan, CubiCasa) | L | Needs native iOS; could import RoomPlan USDZ/JSON |
| Import from other apps (Sweet Home 3D .sh3d, IFC) | D | M–L | |

### 2.3 3D & visualization

| Feature | Common | Effort | Notes |
|---|---|---|---|
| Live 3D view generated from 2D plan (three.js) | T | M | Every consumer competitor has this |
| Walkthrough / first-person camera | T | S (after 3D) | |
| Ceiling geometry in 3D (vaulted, cathedral, tray, coffered) | D (consumer) / C (Chief Premier) | M | ✅ in data model; rendering is the work |
| Roof generation (hip/gable/shed from wall outline) | C | L | Straight-skeleton algorithm; Chief/Cedreo/Live Home |
| Elevations (auto 2D exterior/interior wall views) | C (pro) | M | Live Home 3D, Chief |
| Sections / cutaway | C (pro) | M–L | |
| Materials/textures per wall, floor, ceiling | T | M | |
| Sun/shadow study by location + date | C | M | |
| Photoreal rendering | T (consumer) | L | Path-tracing in browser (three-gpu-pathtracer) or AI render |
| 360 panoramas / shareable viewer | C | M | |
| Dollhouse / exploded floors view | C | S (after 3D) | |
| AR placement (USDZ/glTF on phone) | C | S–M | Export glTF/USDZ, let OS viewer handle AR |
| Terrain / lot / site plan | C | L | Precursor to landscape phase |

### 2.4 Structure / MEP

| Feature | Common | Effort | Notes |
|---|---|---|---|
| Per-wall stud size + wall assemblies (layers: drywall/stud/sheathing/siding) | C (pro) | ✅ / M for full layers | Drives real wall thickness and takeoff |
| Wall/ceiling heights, plate heights | T | ✅ | |
| Auto stud framing (studs @16/24 o.c., king/jack, headers, cripples, plates) | D (Chief, Medeek) | L | ✅ planned as takeoff; 3D visual is a bonus |
| Header sizing from span table | D | M | IRC Table R602.7 |
| Floor/ceiling joist and rafter layout with span tables | D (pro) | L | IRC R502/R802 tables |
| Electrical: auto outlets (IRC E3901 12'/6' rule, counters, GFCI/AFCI zones) | D | ✅ | Chief has auto-placement; nobody consumer-grade does code-driven |
| Electrical symbols: switches, lights, fans, smoke/CO detectors; switch→light links | C | M | RoomSketcher added 170+ symbols in 2026 |
| Smoke/CO detector auto-placement per IRC R314/R315 | D | S–M | Natural extension of outlet engine |
| Plumbing fixtures and clearance checks (toilet 15"/21") | C (symbols) / D (checks) | S–M | |
| HVAC registers / duct symbols | C | S–M | |
| Code compliance checks (egress windows, ceiling height, stairs, hallway width, habitable room size, smoke detectors) | D | ✅ M–L to broaden | Unique for consumer tier |
| Structural load path / bearing wall flagging | D | L | Risky; advisory only |
| Energy (window-to-wall ratio, insulation R-values by climate zone) | D | M | IECC tables; nice adjacent to IRC |

### 2.5 Collaboration / sharing

| Feature | Common | Effort | Notes |
|---|---|---|---|
| Local save (IndexedDB) + JSON file save/open | T | S | Client-side baseline |
| Cloud sync / accounts | T | M–L | Needs backend; Cloudflare D1/R2 pattern fits |
| Read-only share link / embeddable viewer | T | M | Needs hosting of a project blob |
| Comments/markup pinned to plan | C | M | magicplan notes, Revit/BIMx |
| Real-time multi-user editing | D | L | CRDT (Yjs) |
| Version history / snapshots | C | S–M | |
| Branded proposal sheets (logo, title block) | C (builder tools) | S–M | Cedreo |
| Photos/notes attached to rooms | C (magicplan) | S–M | Great for remodels |

### 2.6 Export formats

| Feature | Common | Effort | Notes |
|---|---|---|---|
| PNG/JPG image | T | S | |
| PDF, **to scale** (1/4"=1'), with title block, multi-page | T | M | jsPDF/pdf-lib; RoomSketcher, Chief |
| SVG | C | S | |
| DXF | C (pro) | M | Floorplanner offers DXF; DWG is proprietary, skip |
| CSV/XLSX of materials, rooms, openings (schedules) | C | S | Sweet Home 3D, Chief |
| glTF / OBJ / USDZ 3D | C | S (after 3D) | three.js exporters |
| IFC (BIM interchange) | C (pro) / D (consumer) | L | web-ifc exists; partial support feasible |
| Xactimate / estimating-system export | D | M | magicplan niche |

### 2.7 AI features

| Feature | Common | Effort | Notes |
|---|---|---|---|
| Plan image/photo → editable walls/rooms/doors | D (Planner 5D, CubiCasa) | L | Biggest AI win for our underlay feature; LLM vision or ONNX model |
| Hand sketch → plan | D | L | Same pipeline, noisier input |
| Prompt/constraint → generated layouts | D (Maket) | L | Hard; output quality varies |
| AI render / restyle of 3D view | C (2026 trend) | M | Image-to-image via API; needs network |
| Auto-furnish rooms | C | M | Rule-based is fine |
| Natural-language edits ("make the kitchen 2 ft wider") | D | M–L | LLM tool-calling over our command layer |
| AI code-review explanations ("why does this fail R310?") | D | S–M | Pairs with IRC engine |
| Zoning / setback Q&A | D (Maket) | M | Ties to landscape/lot phase |

### 2.8 Cost estimating

| Feature | Common | Effort | Notes |
|---|---|---|---|
| Area/sqft summaries (heated, gross, per room) | T | S | |
| Materials list / quantity takeoff (studs, plates, sheathing, drywall, paint, flooring, trim) | C (pro) / D (consumer) | ✅ M | Chief, Medeek |
| Waste factors and unit conversion (board-ft, sheets, LF, SF) | C (pro) | S | |
| User-editable price list → cost estimate | C (pro, magicplan) | M | Chief deprecated master pricing 2026; opening for us |
| Regional pricing / retailer SKU linkage | D | L | Data licensing problem |
| Labor estimates / assemblies (cost per wall type) | D | M | |
| Budget vs. option comparison (design options × cost) | D | S (after options + pricing) | |

---

## 3. Top 10 recommendations (priority order)

1. **Auto dimension strings + to-scale PDF export with title block** — table-stakes output that makes plans usable with builders/permit offices; low risk, high perceived quality (M).
2. **Live 3D view from the plan (three.js), including our ceiling types** — every consumer competitor has 3D; our vaulted/tray/coffered ceilings are invisible without it and become a showcase (M).
3. **Materials takeoff → editable price list → cost estimate, with CSV/XLSX export** — turns our framing engine into dollars; consumer tools lack it and Chief just deprecated its pricing manager (M).
4. **Broaden IRC checks (egress R310, ceiling height R305, stairs R311.7, smoke/CO R314/R315, hallway/door widths) with plain-English explanations** — our clearest differentiator; no consumer tool does code checks (M–L).
5. **PDF underlay + perspective correction for the trace image** — most existing plans arrive as PDFs or phone photos; makes the import feature actually work on real inputs (S–M).
6. **Multi-level support with ghosted floor below + stairs tool tied to IRC rise/run** — needed for any real house; unlocks two-storey framing and stair checks (M–L).
7. **Wall assemblies (layered drywall/stud/sheathing/siding) driving thickness, dimensions, and takeoff** — natural extension of per-wall stud size; makes dims and quantities accurate (M).
8. **Electrical layer expansion: switches, lights, switch-light links, auto smoke/CO placement** — builds directly on the outlet engine; RoomSketcher just added 170+ electrical symbols, showing demand (M).
9. **Existing/demo/new phasing + design options** — remodelers are a big audience (magicplan's market) and options pair with cost estimating for "what does plan B cost?" — rare outside Revit/ArchiCAD (M).
10. **AI plan recognition: underlay image → suggested walls/doors/windows (opt-in, LLM vision or ONNX)** — the hottest AI capability (Planner 5D, CubiCasa) and a direct upgrade to manual tracing; do it after the underlay pipeline is solid, as it's the highest-effort, highest-uncertainty item (L).

**Deliberately deferred:** photoreal rendering (L, and AI-render APIs are commoditising it), real-time collaboration (L, needs backend), roof generation (L; do with landscape/exterior phase), IFC (L, pro-only demand), prompt-to-layout generation (L, low quality across the market).

---

## Sources

- [Spacedesigner3d — Best floor plan software 2026](https://www.spacedesigner3d.com/blog/best-online-floor-plan-software)
- [The Close — Best floor plan software 2026](https://theclose.com/best-floor-plan-software/)
- [RoomSketcher — 8 best floor plan software tools (2026)](https://www.roomsketcher.com/blog/best-floor-plan-software-tools/)
- [Capterra — RoomSketcher](https://capterra.com/p/164021/RoomSketcher/) · [GetApp — RoomSketcher](https://www.getapp.com/sales-software/a/roomsketcher/) · [Stork.ai — RoomSketcher updates](https://www.stork.ai/de/roomsketcher)
- [G2 — Planner 5D vs RoomSketcher](https://www.g2.com/compare/planner-5d-vs-roomsketcher)
- [Planner 5D — AI floor plan generator](https://planner5d.com/use/ai-floor-plan-generator) · [Planner 5D API](https://tool.planner5d.com/api) · [Tooliverse — Planner 5D review 2026](https://tooliverse.ai/tools/planner-5d)
- [Floorplanner pricing](https://floorplanner.com/pricing) · [Floorplanner credits](https://floorplanner.com/credits) · [Illustrarch — Floorplanner review](https://illustrarch.com/articles/design-softwares/111930-floorplanner-review.html) · [TopTenReviews — Floorplanner](https://toptenreviews.com/floorplanner-review)
- [Capterra — SmartDraw pricing](https://www.capterra.com/p/78945/SmartDraw/pricing/)
- [Neowin — Sweet Home 3D 7.6](https://www.neowin.net/amp/sweet-home-3d-76/) · [Sweet Home 3D 7.4](https://www.neowin.net/software/sweet-home-3d-74/)
- [TechRadar — HomeByMe review](https://www.techradar.com/reviews/homebyme) · [TopTenReviews — HomeByMe](https://www.toptenreviews.com/homebyme-review) · [Capterra — HomeByMe](https://www.capterra.in/reviews/163482/homebyme)
- [ContractorToolStack — magicplan](https://contractortoolstack.com/software/magicplan/) · [Capterra — magicplan](https://www.capterra.co.il/software/210335/magicplan) · [Illustrarch — magicplan review](https://illustrarch.com/articles/architectural-technology/73956-magicplan-review.html)
- [Live Home 3D tech specs (Mac)](https://livehome3d.com/mac/tech-specs) · [App Store — Live Home 3D](https://apps.apple.com/us/app/-/id1066784070) · [Capterra — Live Home 3D](https://www.capterra.com/p/166944/Live-Home-3D)
- [Home Designer — framing KB](https://www.homedesignersoftware.com/support/article/KB-00462/generating-framing-in-home-designer.pdf) · [Home Designer — what's new](https://www.homedesignersoftware.com/whats-new/) · [Chief Architect vs Home Designer](https://www.homedesignersoftware.com/chief-architect/) · [Home Designer Pro](https://homedesignersoftware.com/products/home-designer-pro)
- [Medeek Wall](https://design.medeek.com/resources/medeekwallplugin.html) · [Medeek Truss](https://design.medeek.com/resources/medeektrussplugin.html) · [SketchUp forum — stick framing plugins](https://forums.sketchup.com/t/options-for-stick-framing-plugins-gauging-interest-for-new-plugin/230855)
- [Capterra — Cedreo pricing](https://www.capterra.com/p/177284/Cedreo/pricing/) · [PricingSaaS — Cedreo](https://pricingsaas.com/companies/cedreo)
- [Novatr — Archicad features 2026](https://www.novatr.com/blog/top-archicad-features-for-architects) · [Illustrarch — Archicad vs Revit](https://illustrarch.com/articles/73182-design-softwares-archicad-vs-revit-comparison.html) · [MyArchitectAI — Revit vs Archicad 2026](https://www.myarchitectai.com/fr/blog/revit-vs-archicad)
- [Maket features](https://www.maket.ai/features) · [Tooliverse — Maket review 2026](https://tooliverse.ai/tools/maket) · [BetaKit — Maket $3.4M](https://betakit.com/maket-secures-3-4-million-to-make-floor-planning-quicker-with-ai/) · [Maket — AI floor plan tools compared](https://www.maket.ai/blog/top-rated-ai-floor-plan-tools-compared)
- [Fast.io — Best AI floor plan generators 2026](https://www.fast.io/resources/best-ai-floor-plan-generators-2026.md) · [RasterScan Floor-Plan-Recognition (GitHub)](https://www.GitHub.com/RasterScan/Floor-Plan-Recognition) · [Getfloorplan](https://similarlabs.com/de/p/getfloorplan)
