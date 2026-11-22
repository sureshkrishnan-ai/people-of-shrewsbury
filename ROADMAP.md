# People of Shrewsbury — roadmap

A long-term community project: a stylised 3D Shrewsbury, MA, generated from the real map, with its residents and its
local businesses. Built on [People of City](https://github.com/peopleofcity/peopleofcity) (AGPL-3.0). Phases are rough;
each one ends with a CHANGELOG entry and fresh screenshots.

## v0 — local (now)
- [x] City config (`src/city/`) replaces the Bengaluru hardcodes; Shrewsbury clock with daylight saving.
- [x] Real-map pipeline (`pipeline/`): OSM roads/buildings/water/parks/trees/POIs + USGS terrain → 6 districts.
- [x] Districts: Town Center, Route 9, Lake Quinsigamond, Route 20, North and South Shrewsbury, linked by the portal.
- [x] Businesses: OSM listings with signs and cards ("story not yet added"), economy layer, `/economy`, `/for-businesses`, `/about`.
- [x] Supabase `businesses` table with row-level security; owner form; consent text v1.
- [x] Clearly labelled sample residents only.

## v1 — launch
- Accounts (Supabase), hosting (Vercel), a domain — see [docs/DEPLOYING.md](docs/DEPLOYING.md).
- Census API key → real ACS / County Business Patterns figures on `/economy` (source + year on every number).
- First 10 real business stories from owner interviews (with consent records).
- Phone pass: measure frame rate in each district on a mid-range phone; trim tree caps / texture size if needed.
- Moderation rota: two maintainers who can approve residents and businesses.
- Re-run the map pipeline right before launch; credit OpenStreetMap everywhere it shows.

## v1.x — the town fills in
- **Districts:** stream neighbouring tiles at district edges (the pipeline already writes 500 m tiles) so the whole
  town becomes walkable; more districts (Edgemere, Spag's/Route 9 east, Dean Park, Prospect Hill).
- **Landmarks:** hand-built kit models for Town Hall, the Public Library, the Town Common gazebo, the high school,
  Lake Quinsigamond's rowing facilities — replacing their extruded footprints, in the foundation's kit style.
- **Better heights:** MassGIS / LiDAR roof heights instead of estimates (pipeline/SOURCES.md).
- **Search streets and businesses** in the find panel (today: the HUD names the street you're on).
- **Seasonal light:** sunrise/sunset from Shrewsbury's real latitude and date (daylight.ts keys are tuned for Bengaluru);
  snow in winter, fall colours (trees already turn in Oct–Nov).
- **Events layer:** farmers' market, town meeting, parades — a dated pin in the right place, added by maintainers.
- **History layer:** "then and now" markers with public-domain photos and short texts from the historical society (with permission).

## Enterable buildings / interiors (planned — not in v0)
Walk up to a door — Town Hall, the library, a fire station, a business — and step inside. The interior loads lazily like a
district through the portal system (only one interior in memory at a time).

Three kinds of content:
1. **Stylised interior** modelled in the kit style from photos the owner approves.
2. **360° photo or video sphere** of a public space.
3. **Embedded video tour** (e.g. "a day at the fire station") and **meet the team** cards.

Rules (non-negotiable):
- Only with the building owner's or department's **written permission**, stored as a consent record.
- **Public areas only.** Never security-sensitive spaces: no police cells, evidence rooms, dispatch screens, alarm or
  camera locations, server rooms, or floor plans of restricted areas.
- Staff appear only with their own consent; anyone can be blurred or removed on request.
- The department or owner **reviews the finished interior before it is published**, and can withdraw it.

Where it hooks in (already reserved, ignored by v0): the `interior` field on a business (`Interior` type in
`src/city/businesses.ts`; `interior jsonb` column in the `businesses` table, settable only by a reviewer). A door
becomes a walk-up prompt like the business cards (`src/game/hud/Businesses.tsx`), and "Go inside" would reuse the portal
travel (`startTravel`) with an interior scene in place of `RealWorld`.

## View the town on Meta Quest (WebXR) (planned — not in v0)
- **Enter VR** button in the Quest Browser (three.js WebXR via `@react-three/xr`), shown only when
  `navigator.xr.isSessionSupported('immersive-vr')` says yes.
- Movement: thumbstick walk, teleport arc, snap turn (comfort first); life-size street level (1 unit = 1 m already).
- Name plates and business cards readable in VR: world-space panels instead of DOM overlays (drei `<Html>` and the HUD
  don't render inside an XR session).
- Quest performance profile: no heavy post-processing (N8AO, bloom off), shorter fog / LOD distance, lower tree cap and
  2048 ground texture (the `low` quality level already does most of this), fixed foveation, 72 fps target.
- Later: AR/passthrough **table-top Shrewsbury** — the district at 1:500 on a real table (the pipeline's `overview.json`
  + district files are already scale-free); interiors and video tours in VR.

Code choices that keep this cheap later:
- Keep movement intent separate from devices: `player/input.ts` turns keys/mouse/touch into move + look intents; a VR
  controller source should feed the same intents rather than adding a new movement path in `Player.tsx`.
- Keep UI that must work in VR (name cards, business cards) driven by data in stores (`useEconomy`, business lookups in
  `src/city/businesses.ts`), so a world-space panel can render the same data as the DOM card.
- Quality settings live in `device.ts` profiles — add an `xr` profile there, not ad-hoc checks.
- Real-map districts are already a few merged meshes + instancing (~10 draw calls), which suits Quest.

## Business growth
- Owner photo uploads (Supabase Storage, size limits, review queue).
- "Open now" from OSM `opening_hours`; a weekly "new on Main Street" spotlight.
- Jobs board for local businesses (owner-posted, reviewed).
- Category walk tours ("every bakery in town").

## School and scout collaboration
- Classroom kit: a lesson plan around `/economy` and the ideas board; student-made district or landmark models.
- Scouts and students run owner interviews ([template](docs/business-interview-template.md)); only owners publish.
- OpenStreetMap mapping parties to add missing shops and houses — every edit shows up on the next refresh.
- Children never appear as residents or by name; student work is credited by class or troop, not by child.
