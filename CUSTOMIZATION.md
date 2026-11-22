# Build your own city

A practical guide to turning this foundation into **People of _your_ city**. Every path and snippet below is from this repository.

> **Be honest with yourself about the starting point.** The foundation was built as People of Bengaluru, and much of the city's identity is **hardcoded**, not configurable. Bengaluru appears in about 35 places in `src/`, from Kannada street names to the clock. This guide lists every place you'll change. The [last section](#a-future-city-config) proposes a single config file to replace them.

Before you start, read [`design.md`](design.md) and [`sounddesign.md`](sounddesign.md): they explain *why* the city looks and sounds the way it does. A new city keeps the rules (stylised, readable, a consistent palette) and changes the place.

---

## 1. Change the city identity

### Name, title and address

**`src/lib/site.ts`** is the site's public identity:

```ts
export const SITE_URL = 'https://peopleofbengaluru.com'        // your domain
export const ADMIN_HOSTS = ['admin.peopleofbengaluru.com', …]  // where the admin lives
export const PUBLIC_HOSTS = ['peopleofbengaluru.com', …]       // where /admin is hidden
export const SITE_NAME = 'People of Bengaluru'
export const SITE_TITLE = 'People of Bengaluru — walk the city, meet its designers and builders'
export const SITE_DESCRIPTION = 'A stylised 3D Bengaluru you can walk through. …'
export const GA_ID = ''                                        // your Google Analytics ID, or leave empty
```

**`src/lib/server/env.ts`** lists your site's own addresses (`PRODUCTION_URL` and `KNOWN`). Links in emails only ever point at these, so add your domains here.

### The city name on screen

| What | File | Change |
|---|---|---|
| Title screen: `PEOPLE OF` / `BENGALURU` and the tagline | `src/game/hud/Intro.tsx` (around line 64) | `<h1>BENGALURU</h1>` → your city |
| The location badge (top left) | `src/game/hud/HUD.tsx` (line 33) | `BENGALURU` |
| "Time in Bengaluru" next to the clock | `src/game/hud/HUD.tsx` | the `title` text |
| Home-screen app name | `src/app/manifest.ts` (`short_name`), `src/app/layout.tsx` (`appleWebApp.title`) | your city |
| Link previews (Open Graph image) | `src/app/opengraph-image.tsx` | the text drawn on the card |
| Invite share text | `src/game/hud/Invites.tsx` (around line 35) | `People of Bengaluru` |
| "Add to home screen" help | `src/game/hud/Pause.tsx` (around line 325) | `Open Bengaluru…` |

To find every remaining mention:

```bash
git grep -n -E "Bengaluru|BENGALURU|peopleofbengaluru" -- src
```

### The clock

Day and night follow your city's real time. The offset is in **`src/game/scene/daylight.ts`**:

```ts
/** Hours (0–24) on Bengaluru's clock (IST, UTC+5:30, no daylight saving), wherever the player is. */
export const bengaluruHour = (ms: number) => (((ms / 3_600_000 + 5.5) % 24) + 24) % 24
```

Change `5.5` to your UTC offset (Tokyo `9`, Chennai `5.5`). If your city has daylight saving time, a fixed offset will be an hour off for part of the year. Use `Intl.DateTimeFormat` with your time zone instead. Try any hour without waiting with `?time=21:00`.

---

## 2. Districts: your city's neighbourhoods

### The district list

**`src/game/districts/registry.ts`** names every district:

```ts
export type DistrictId = 'koramangala' | 'hsr' | 'bellandur' | 'whitefield' | 'domlur'

export const DISTRICTS: DistrictInfo[] = [
  { id: 'koramangala', name: 'Koramangala', title: 'KORAMANGALA', kn: 'ಕೋರಮಂಗಲ',
    identity: 'Startup · Design · Founder district', accent: C.FLAME, built: true },
  { id: 'bellandur', name: 'Bellandur', title: 'BELLANDUR', kn: 'ಬೆಳ್ಳಂದೂರು',
    identity: 'Tech corridor district', accent: C.BMTC_BLUE, built: false },
  …
]
```

- `name` matches a profile's `location`, `title` is shown in the HUD, and `kn` is the name in the local script (Kannada here: use Tamil for Chennai, Japanese for Tokyo, and so on).
- `built: false` districts appear in the portal as "coming soon".

### A district's three files

Use **HSR Layout** as your template: it's the cleanest example.

| File | What it holds |
|---|---|
| `src/game/districts/hsr/layout.ts` | Where everything stands: roads, parks, buildings, trees, the portal, and the colliders you can't walk through |
| `src/game/districts/hsr/index.ts` | The district definition: `registerDistrict({ id, colliders, ground, surface, landmarks, spawn, portal, spots, trees, … })` |
| `src/game/districts/hsr/World.tsx` | What gets drawn, built from the kit |

To add a district:

1. Copy `src/game/districts/hsr/` to `src/game/districts/<your-id>/` and edit it.
2. Add the id to `DistrictId` and `DISTRICTS` in `registry.ts` with `built: true`.
3. Import it in **`src/game/districts/index.ts`** (`import './<your-id>'`). The default district is set there by `activateDistrict(…)`.
4. Draw it: add a line to **`src/game/world/DistrictWorld.tsx`** (`if (district === '<your-id>') return <YourWorld />`).
5. For the live city, add the id to `ROOM_DISTRICTS` in **`shared/net/config.ts`**, or the room server ignores it.

Koramangala, the first district, predates this pattern: its layout is in `src/game/layout.ts` and its world in `src/game/world/World.tsx`.

### The size of the world

`BOUNDS` in **`shared/net/config.ts`** (46 m from the centre) is how far anyone can walk. The live-city server uses the same value to reject impossible moves.

---

## 3. Streets, buildings and landmarks

The city is **built in code** from a kit of bevelled pieces. There are no 3D building files.

### The kit

**`src/game/world/kit.tsx`** has the building blocks: `Box`, `Cyl`, `Win` (windows), `Door`, `Balcony`, `Pot`, `Tank`, `Mumty`, `Parapet`, `Sign`, `Awning`, `Shutter`, `Dish`, `ACUnit`, `ClothesLine`. Bigger pieces are made from them: `Building.tsx`, `Apartment.tsx`, `ShopRow.tsx`, `Darshini.tsx`, `StartupHouse.tsx`, `Park.tsx`, `BusStop.tsx`, `Trees.tsx`, `StreetPoles.tsx`, `Props.tsx`.

### Adding buildings

Generic buildings are data. In **`src/game/layout.ts`**, add to `FILLERS`:

```ts
export const FILLERS: BuildingSpec[] = [
  { x: -14.5, z: -31, rot: H, w: 12, d: 11, floors: 3, wall: C.WALL_POWDER, accent: C.WALL_WHITE, seed: 3 },
  // your building: position (x, z in metres), rotation, width, depth, floors, colours
  { x: 30, z: -31, rot: 0, w: 10, d: 10, floors: 5, wall: C.WALL_BUTTER, balconies: 'all', tanks: 2, seed: 42 },
]
```

Each filler gets a collider automatically (`for (const b of FILLERS) footprint(…)`). `seed` varies the details, so give each building its own. `BuildingSpec` lists every option (`stilt`, `balconies`, `tanks`, `mumty`, …).

### Replacing landmarks

Landmarks are hand-built components. To replace one, such as the darshini (`src/game/world/Darshini.tsx`) with your city's café, write a component from kit pieces, add it in `src/game/world/World.tsx` (or your district's `World.tsx`), and register its name in `LANDMARKS` in `layout.ts`:

```ts
export const LANDMARKS = [
  { x: 14.5, z: -9, r: 8, label: 'NAMMA DARSHINI' },   // shown in the HUD when you're within r metres
  …
]
```

Don't forget its collider: call `box(…)` or `footprint(…)` in `layout.ts` so people can't walk through it.

### Shop signs and street signs

Sign text lives in `layout.ts` (`STREET_SIGNS`, `POSTERS`) and in the landmark components. A sign is a `SignSpec`:

```ts
sign: { title: 'GANESH MEDICALS', kn: 'ಗಣೇಶ್ ಮೆಡಿಕಲ್ಸ್', sub: 'OPEN 24 HOURS', bg: C.AUTO_GREEN, fg: '#FFF6E5' },
```

`kn` is the local-script line. For another language, write it in that script and swap the font: `src/app/layout.tsx` loads `Noto_Sans_Kannada` from `next/font/google` as `--font-kannada`. Use, for example, `Noto_Sans_Tamil` for Chennai.

### Places where people hang out

**`src/game/people/spots.ts`** names the places residents can choose to stand (`darshini`, `park`, `busstop`, …). Each has a label, a short blurb and standing positions `[x, z, facing]`.

---

## 4. The environment

| What | Where |
|---|---|
| **Every colour in the city** (sky, walls, roads, kerbs, leaves) | `src/lib/palette.ts`: one palette, `C.WALL_MINT`, `C.KERB_YELLOW`, … |
| Sky and clouds | `src/game/scene/Sky.tsx` |
| Sun, shadows and the look through the day | `src/game/scene/Lighting.tsx`, `src/game/scene/daylight.ts` |
| Colour grading and post-processing | `src/game/scene/grade.ts`, `src/game/scene/Effects.tsx` |
| Ground, roads, kerbs, surfaces | `src/game/world/Ground.tsx`; walking surfaces per district (`surface()` in each district's `index.ts`) |
| Trees | `src/game/world/Trees.tsx`; positions in `layout.ts` (`TREES`) |
| The skyline beyond the streets | `src/game/world/Background.tsx` |
| Ambient sound (traffic, birds) and music | `src/game/audio/ambience.ts`, `src/game/audio/music.ts` |

Bengaluru's kerbs are yellow and black, its autos green and yellow. Swap them for your city's real colours in `palette.ts` and the whole city follows.

---

## 5. Avatars and characters

Characters are **3D models (GLB)** restyled with the palette:

- **Models:** `public/models/characters/*.glb`, credited in `public/models/CREDITS.md` (CC0, by Quaternius).
- **Styles:** **`src/game/characters/roster.ts`**. Each `CharacterDef` picks a model `file`, recolours its materials (`colors`), and can hide parts or offer a second body (`alt`):

```ts
{
  id: 'designer',
  name: 'THE DESIGNER',
  tagline: 'Pixels with attitude.',
  file: '/models/characters/designer.glb',
  rig: 'modular',
  gender: 'f',
  alt: { file: '/models/characters/rockstar.glb', colors: { Skin: SKIN.d, Black: INK, … } },
  accent: C.FLAME,
  colors: { Skin: SKIN.b, Pink: C.FLAME, Black: INK, Grey: '#6B7083', Hair_Brown: HAIR, Brown: '#4A3A30' },
},
```

The keys in `colors` are the **material names inside the GLB file** (`Skin`, `Pink`, `Hair_Brown`): open a model in a viewer such as [gltf.report](https://gltf.report) to see them.

- **Skin tones:** the `SKIN` constants at the top of `roster.ts`. Set them for your city's people.
- **Rendering:** `src/game/characters/Avatar.tsx` loads the GLB and plays its animations.

To add a character, put a rigged, animated GLB in `public/models/characters/`, add a `CharacterDef`, and credit the model in `CREDITS.md`. Keep its materials named so `colors` can find them.

---

## 6. People and profiles

### Without a database: sample residents

**`src/game/people/profiles.ts`** holds the fictional sample residents (`PEOPLE`) you see when no database is connected:

```ts
{
  id: 'ananya',
  status: { emoji: '☕', text: 'Up for a coffee chat about design systems', expiresAt: null },
  name: 'ANANYA RAO',
  role: 'Product Designer',
  company: 'Kettle',
  location: 'Koramangala',
  building: 'Doodle Desk',
  previously: 'Hopscotch',
  skills: ['Figma', 'Prototyping', 'Fintech'],
  openToWork: false,
  links: {},
  character: 'designer',
  spot: { x: 11, z: -5.85, face: PI },
},
```

Replace them with your own sample cast, and keep them fictional. `spot` is where they stand (or give them a `path` to walk), and `character` is a style id from the roster.

### With Supabase: real residents

Real profiles come from the `profiles` table (`src/game/people/directory.ts`). The fields a profile shows are the `Profile` type in `profiles.ts`: name, role, company, location, what they're building, previously, open to work, skills, links (portfolio, LinkedIn, X), character, and status.

### Social links

The links a profile can show are `links: { portfolio?, linkedin?, x? }` in the `Profile` type (`src/game/people/profiles.ts`), shown by the profile panel. To add one, such as GitHub or Instagram, add it to the type, the profile editor (`src/game/hud/Create.tsx`), the panel, and your database.

### What people come to do

The reasons to connect are in **`src/lib/intents.ts`**: `☕ GRAB COFFEE`, `🤝 WORK TOGETHER`, `🧠 EXCHANGE IDEAS`, `🚀 BUILD SOMETHING`, `🎉 HANG OUT`. The database accepts the same ids: if you change them, update the `intent` check in `supabase/migrations/20261007110614_connections.sql` (and `supabase/schema.sql`).

---

## 7. Branding

- **Colours:** UI colours are tokens at the top of `src/app/globals.css` (`--ink`, `--cream`, `--saffron`, …); city colours are `src/lib/palette.ts`.
- **Fonts:** `src/app/layout.tsx` loads Barlow, Barlow Condensed and Noto Sans Kannada (the sign script).
- **Icon:** `src/app/icon.svg`.
- **Link previews:** `src/app/opengraph-image.tsx`.

---

## 8. Run and test your city

```bash
npm run dev                   # http://localhost:3000
```

- `?time=21:00` freezes the clock to check your city at night.
- `?debug` shows draw calls, triangles and frame times. Keep an eye on them as you add buildings.
- Check on a phone too (same Wi-Fi, `http://<your-computer's-ip>:3000`).

Before you share it:

```bash
npm test && npx tsc --noEmit -p . && npm run build
```

---

## A future city config

> **Built in this fork:** `src/city/config.ts` + `src/city/districts.json` (and real-map districts from `pipeline/`). See docs/MAINTAINING.md.

Today a city's identity is spread across the files above. A natural next step for the foundation is a single **`city.config.ts`** that everything reads from:

```ts
// a proposal, not in the code yet
export const CITY = {
  name: 'Chennai',
  siteName: 'People of Chennai',
  url: 'https://peopleofchennai.com',
  timeZone: 'Asia/Kolkata',
  localScript: { name: 'Tamil', font: 'Noto Sans Tamil' },
  districts: [{ id: 'mylapore', name: 'Mylapore', local: 'மயிலாப்பூர்', accent: '#C8643C' }],
}
```

If you build it, it's exactly the kind of improvement the foundation welcomes: see [CONTRIBUTING.md](CONTRIBUTING.md).
