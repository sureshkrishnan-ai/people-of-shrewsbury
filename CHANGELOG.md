# Changelog

All notable changes to the People of City foundation are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### People of Shrewsbury (fork, branch `shrewsbury`)
#### Added
- City config `src/city/` (name, domain placeholder, America/New_York clock with daylight saving, districts, labels, map credit).
- Map pipeline `pipeline/` (OSM + USGS 3DEP, optional Census) and `districts.py` → six real-map districts in `public/districts/`.
- Real-map district renderer (`src/game/districts/realmap/`): draped terrain with painted streets and street names, extruded
  buildings with gable/flat roofs, instanced trees, lakes, business signs; HUD shows the street you're on; `?district=` / `?at=`.
- Business side: OSM business cards, economy layer (X), `/economy`, `/for-businesses` (consent v1 + owner form), `/about`,
  Supabase `businesses` table with RLS, owner interview template.
- Docs: ROADMAP.md, docs/MAINTAINING.md, docs/DEPLOYING.md.
- **Corridor districts** (`kind: "corridor"` in `src/city/districts.json`, `pipeline/corridors.py`): a whole street, walkable
  end to end, cut into ~400 m chunks that stream in and out as you walk (no portal between chunks; terrain chunks tile on a
  shared 10 m lattice; colliders, road lookup and nav per loaded chunk). Two corridors: **Main Street** (7.3 km, 18 chunks,
  spawn at the Town Common) and **Lexington Road** (0.4 km, 1 chunk). `?district=main-street`, `?district=lexington-road`, `?at=`.
- **Real building heights, roofs and trees** (`pipeline/realbuildings.py`, all districts and corridor chunks): MassGIS
  footprints + USGS LiDAR eave/ridge/roof shape (pitch drawn at 30–45°, measured ridge kept), steeples and cupolas from the
  LiDAR top, Overture heights town-wide, estimates last; footprints OSM lacks are added (deduped by overlap); demolished
  (no LiDAR roof) buildings dropped. LiDAR trees with real height and crown size (broadleaf ×2 shapes, conifer cone; caps per
  quality level, smallest dropped first); no invented street trees where LiDAR mapped the real ones. `?heights=1` debug tint.
- Street detail on corridors: curbs, crosswalks at side streets, stop signs, street lamps, utility poles with wires along the
  corridor street, mailboxes, driveways, picket fences and hedges, a few parked cars; chimneys and porches on houses.
- Buildings: hip and shed roofs, measured eave + ridge heights when the pipeline has them (optional
  `buildings_lidar.geojson` from a MassGIS + LiDAR pass; estimates otherwise).
#### Changed
- Districts can be any size (`DistrictDef.half`); colliders indexed in a grid; nav grid scales with the district.
- Live city: positions in 2 cm steps (±655 m), `BOUNDS` 400, room ids from the city config.
- Sample residents replaced with fictional, labelled Shrewsbury samples.

## [0.1.0] - 2026-11-23

The first public release: the open foundation of People of Bengaluru, as of 10 November 2026.

### Added
- The open-source foundation under the GNU AGPL-3.0.
- Documentation: README, [ARCHITECTURE.md](ARCHITECTURE.md), [CUSTOMIZATION.md](CUSTOMIZATION.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SUBMISSIONS.md](SUBMISSIONS.md), Code of Conduct and security policy.
- Issue forms, a pull request template, code owners, and CI checks on every pull request.
- Fillers for email (`src/lib/server/email/send.ts`) and payments (`src/lib/server/dodo.ts`), so the foundation runs without either.
- A starter database (`supabase/schema.sql`, `supabase/migrations/`): every table, row-level security policy and function the app uses, with no data.

### Included from People of Bengaluru
- A walkable, stylised 3D city: Koramangala 5th Block and HSR Layout, with portal travel between them.
- Day and night on the city's real clock; generative music and ambience.
- Characters, sample residents, name plates, and find-someone search.
- Desktop and touch controls.
- With Supabase: email-code sign-in, invites, applications with admin review, profiles, status, connect and chat, Day Zero missions.
- The live city: real-time positions through a Cloudflare Workers server (`realtime/`).

### Not included
- People of Bengaluru's data, email templates and sending, payments, and the scheduled reminder job.

### Changed
- Analytics are off by default (`GA_ID` is empty in `src/lib/site.ts`).
- Applications are free: a saved application goes straight to review.
