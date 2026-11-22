> # People of Shrewsbury
> A stylised 3D **Shrewsbury, Massachusetts** generated from the real map — walk Main Street, Route 9 and the shore of
> Lake Quinsigamond, meet residents, and discover the local businesses that keep the town going. A community project
> and a Girl Scout local-economy project, built on the People of City foundation below (AGPL-3.0).
>
> **Start here:** `npm ci && npm run dev` → http://localhost:3000 · [ROADMAP](ROADMAP.md) · [Maintaining](docs/MAINTAINING.md) ·
> [Deploying](docs/DEPLOYING.md) · [Map pipeline](pipeline/README.md) · [Changelog](CHANGELOG.md)
>
> What's different from the foundation: one city config (`src/city/`), districts generated from OpenStreetMap +
> USGS terrain (`pipeline/`, `src/game/districts/realmap/`), and a business side (`/economy`, `/for-businesses`,
> `/about`, business cards and an economy layer in the 3D town). Map data © OpenStreetMap contributors (ODbL).
> Try `?district=lake-shore`, `?district=route-9`, `?time=21:00`.

---

<div align="center">

<img src="docs/banner.webp" alt="People of City: a crew of residents standing on a city street at sunset, beside the portal" width="100%">

### One world. Many cities. Built by everyone.

An open foundation for building interactive virtual cities where people can discover, connect and explore.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![checks](https://github.com/peopleofcity/peopleofcity/actions/workflows/checks.yml/badge.svg)](https://github.com/peopleofcity/peopleofcity/actions/workflows/checks.yml)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Built with Three.js](https://img.shields.io/badge/built%20with-three.js-black.svg)](https://threejs.org)

**Live:** [People of Bengaluru](https://peopleofbengaluru.com) · [People of SF](https://peopleofsf.com)

![Walking down a street in Koramangala, Bengaluru: residents' name plates float over their heads](docs/screenshot.jpg)

</div>

People of City is a stylised 3D city you walk through in the browser, where every character is a real person. Walk up to someone, see what they're building and what they're looking for, and connect. It runs on any laptop or phone, no download.

This repository is the foundation: the city engine, the people, and the social layer, ready for you to make it **your** city.

<table>
<tr>
<td><img src="docs/screenshot-title.jpg" alt="The title screen: a slow cinematic orbit over the neighbourhood at dusk"></td>
<td><img src="docs/screenshot-night.jpg" alt="The same street at 8:30 PM: street lights on, windows lit, residents walking"></td>
</tr>
<tr>
<td align="center"><sub>The title screen, orbiting the neighbourhood</sub></td>
<td align="center"><sub>Night falls on the city's real clock</sub></td>
</tr>
</table>

<sub>All screenshots are from this repository running locally with no configuration.</sub>

---

## The vision

It started with **People of Bengaluru**: an experiment to bring a city's people into an interactive virtual world. Instead of scrolling a list of profiles, you walk down a street in Koramangala and meet the designers and builders who live there.

As more creators started exploring the idea for their own cities, the project grew into a shared foundation that anyone can use to create their own virtual city.

We want to see what people around the world build with it.

## What can you build?

Any city. A few we'd love to walk through:

| | |
|---|---|
| 🌊 **People of Chennai** | Marina Beach, Mylapore's temple streets, filter coffee at every corner |
| 🕌 **People of Hyderabad** | Charminar, Hitech City's glass, biryani queues |
| 🚕 **People of Mumbai** | Bandra's lanes, local trains, sea-facing promenades |
| 🗼 **People of Tokyo** | Shibuya crossings, konbini lights, quiet backstreets |
| 🌉 **People of San Francisco** | Mission Bay, cable cars, fog over the hills ([one already exists](https://peopleofsf.com)) |

Your town, your campus, your neighbourhood: creators are welcome to experiment with any city.

---

## Features

### Available now

Everything here exists in this codebase today.

**The city** (runs with no backend at all)
- **A stylised 3D neighbourhood you can walk through.** Koramangala 5th Block, built in code from a hand-arranged kit of bevelled pieces: buildings, a darshini, a shop row, a park, a bus stop, trees, poles and street life (`src/game/world/`).
- **A second district through a portal:** HSR Layout (`src/game/districts/hsr/`), with a travel transition between them.
- **Day and night on the city's real clock.** The sky, sun, street lights and night windows follow the local time (`src/game/scene/`).
- **Cinematic look:** post-processing with ambient occlusion, bloom, filmic tone mapping and a vignette, scaled down on phones.
- **Sound:** generative music and ambience, synthesised live in the browser, plus UI sounds (`src/game/audio/`).
- **Desktop and phone:** keyboard and mouse, or touch with a thumb joystick (`src/game/hud/TouchControls.tsx`).
- **Residents as characters:** each person is a 3D character with a name plate showing their role and what they're looking for. Without a database, sample residents walk the streets.
- **Find someone:** search by name or role, and a guide line leads you to them (`F`).

**The social layer** (needs a Supabase backend, see [Getting started](#getting-started))
- **Sign in** with a six-digit email code (Supabase Auth).
- **Getting in:** invite codes, or an application reviewed by an admin. Applications are free in this foundation.
- **Profiles:** role, company, what you're building, links, open to work, and your character's look, created in an in-game character creator.
- **Status:** a short line and an emoji above your head ("up for coffee ☕").
- **Connect and chat:** send a request with a reason, and chat once matched. Messages arrive live.
- **Invites:** every resident holds a few invite codes to share.
- **Day Zero missions:** four first things a new resident does in the city.
- **Admin:** a review queue for applications, invites and reports (`/admin`).
- **Live city:** see who's online and where they're walking, in real time, through a small Cloudflare Workers server (`realtime/`).

### Not included

People of Bengaluru's email templates and sending, and its payments, are not part of this repository. Small **fillers** stand in for email (`src/lib/server/email/send.ts`) and payments (`src/lib/server/dodo.ts`). They send nothing, so you can plug in your own.

See the [Roadmap](#roadmap) for what's planned.

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) **22** and npm
- [Git](https://git-scm.com)
- *For accounts and the social layer:* a free [Supabase](https://supabase.com) project
- *For the live city (optional):* a free [Cloudflare](https://cloudflare.com) account

### 1. Clone and install

```bash
git clone https://github.com/peopleofcity/peopleofcity.git
cd peopleofcity
npm install
```

### 2. Run the city

```bash
npm run dev
```

Open **http://localhost:3000** and press **ENTER**. With no configuration, the city runs as a guest walk-through with sample residents.

**Controls:** `WASD` / arrows to move · `Shift` to run · mouse to look · `E` to talk to someone · `F` to find someone · `C` for connections · `M` to mute · `Esc` to pause. On a phone: left thumb moves, right thumb looks, tap someone to talk.

**Handy URL flags:** `?time=19:30` freezes the clock (try the night) · `?debug` shows renderer stats.

### 3. Configure your environment

```bash
cp .env.example .env.local
```

| Variable | What it's for | Required |
|---|---|---|
| `SUPABASE_URL` | Your Supabase project URL | For accounts |
| `SUPABASE_PUBLISHABLE_KEY` | Public key, safe in the browser (row-level security guards the data) | For accounts |
| `SUPABASE_SECRET_KEY` | Server-only key for API routes. **Never commit it or expose it to the browser** | For accounts |
| `CRON_SECRET` | Protects the unread-message reminder route `/api/cron/chat-digest` | Optional |
| `NEXT_PUBLIC_REALTIME_URL` | Address of the live-city server (`http://localhost:8787` locally) | Optional |

`.env.local` is git-ignored. Never commit real keys.

### 4. Set up the database

The social layer runs on **Supabase**: Postgres with row-level security, Auth (email codes), and Realtime (private per-user channels).

This repository ships a **starter database**: every table, privacy rule and database function the app uses, with no data.

1. Create a free project at [supabase.com](https://supabase.com), and copy its URL and keys into `.env.local` (Project Settings → API).
2. Open **SQL Editor**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), and run it once. *(Using the Supabase CLI? The same steps are in order in `supabase/migrations/`, so `supabase db push` works too.)*
3. **Turn on sign-in codes:** under **Authentication → Emails**, make the *Magic Link* template show the code, e.g. `Your code is {{ .Token }}`. The game asks for the six-digit code, not a link.
4. **Make yourself the first admin.** Sign-in never creates accounts (people join through an invite or an application), so create yours by hand: **Authentication → Users → Add user**, with your email and *Auto Confirm User* ticked. Then run in the SQL Editor:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
   ```
5. **Open the admin** at **http://admin.localhost:3000** (or `/admin`), sign in with your email code, and issue your first invite codes. Use one yourself in the game (`?invite=CODE`) to become the city's first resident.

Restart `npm run dev`, and sign-in, invites, applications, profiles, connect and chat all work. The schema was tested end to end (invites, joining, connecting, chatting, and strangers being kept out of other people's chats and applications).

### 5. The live city (optional)

The live city is a small Cloudflare Workers + Durable Objects server in `realtime/`.

```bash
npm --prefix realtime install
# put your Supabase URL and publishable key in realtime/wrangler.toml (the YOUR_… placeholders)
npm run rt:dev          # serves it at http://localhost:8787
```

Then set `NEXT_PUBLIC_REALTIME_URL=http://localhost:8787` in `.env.local` and restart `npm run dev`. To deploy it, see `realtime/wrangler.toml` and run `npm --prefix realtime run deploy:production` with your own Cloudflare account.

### 6. Test and build for production

```bash
npm test                 # unit tests (vitest)
npx tsc --noEmit -p .    # type-check
npm run build            # production build
npm start                # serve the production build at http://localhost:3000
```

The app is a standard Next.js app and deploys to [Vercel](https://vercel.com) or any Node host. Add the same environment variables in your host's settings.

---

## Build your own city

This is what the foundation is for. The short version:

1. **Name it.** Change the site's name, title, description and address in `src/lib/site.ts`, and the city name in the HUD (`src/game/hud/HUD.tsx`) and the web app manifest (`src/app/manifest.ts`).
2. **Set the clock.** The day/night cycle follows Bengaluru time. Change the offset in `bengaluruHour()` in `src/game/scene/daylight.ts`.
3. **Draw your districts.** Each district lives in `src/game/districts/`, and the list of districts with their names and colours is in `src/game/districts/registry.ts`.
4. **Build your streets.** Buildings are assembled from the kit in `src/game/world/kit.tsx` (walls, windows, balconies, signs, awnings and more) and placed in `src/game/layout.ts`.
5. **Paint it.** The whole city's colours are one palette in `src/lib/palette.ts`.
6. **Dress your people.** Character styles are in `src/game/characters/roster.ts`, and the models are GLB files in `public/models/characters/`.
7. **Bring your people in.** Replace the sample residents in `src/game/people/profiles.ts`, or connect Supabase for real profiles.

Much of the city identity is **hardcoded today**, not configurable: Bengaluru appears in about 35 places in `src/`, from Kannada street names to the clock. [CUSTOMIZATION.md](CUSTOMIZATION.md) walks through every customisation point with real file paths, and proposes a single city config file as a future improvement.

---

## Become a city creator

1. **Fork** this repository.
2. **Build** your city: districts, landmarks, look and sound.
3. **Customise** the experience for your community.
4. **Deploy** it to your own domain.
5. **Share** it with the People of City team: see [SUBMISSIONS.md](SUBMISSIONS.md).

Exceptional projects may be considered for collaboration and potential inclusion in the official People of City ecosystem. Submitting doesn't guarantee inclusion.

## The official repository

This repository is maintained by **Shai Krish** and **Aaqif Shafi** ([aaqifshafi@gmail.com](mailto:aaqifshafi@gmail.com)), who built People of Bengaluru and People of City.

Improvements to the underlying foundation (graphics, gameplay, environments and shared functionality) will be published here over time. Creators build independently in their own forks while pulling in improvements from the official foundation.

## Roadmap

**Available now**
- A walkable, stylised 3D city with two districts and portal travel
- Day and night on the real clock, generative music and ambience
- Characters, name plates, sample residents, and find-someone search
- Desktop and touch controls
- With Supabase (starter database included): email-code sign-in, invites, applications and admin review, profiles, status, connect and chat, Day Zero missions
- With the realtime server: the live city (who's online, live positions)

**Currently exploring**
- A single city config file, so a new city starts from one file instead of many
- Clearer extension points for districts and landmarks

**Future possibilities**
- A shared map of People of City cities
- Travelling between cities
- Community-made building kits and character packs

## Community and collaboration

Developers, designers, 3D artists and builders are all welcome.

- **Report a bug:** [open an issue](https://github.com/peopleofcity/peopleofcity/issues/new/choose)
- **Suggest a feature:** [open an idea](https://github.com/peopleofcity/peopleofcity/issues/new/choose)
- **Ask a question:** [Discussions](https://github.com/peopleofcity/peopleofcity/discussions)
- **Submit an improvement:** read [CONTRIBUTING.md](CONTRIBUTING.md), then open a pull request
- **Showcase your city:** post it in [Discussions](https://github.com/peopleofcity/peopleofcity/discussions) and see [SUBMISSIONS.md](SUBMISSIONS.md)
- **Report a security issue:** privately, see [SECURITY.md](SECURITY.md)

Please be kind: [Code of Conduct](CODE_OF_CONDUCT.md).

## Documentation

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the project is put together |
| [CUSTOMIZATION.md](CUSTOMIZATION.md) | Make it your city, step by step |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute to the foundation |
| [SUBMISSIONS.md](SUBMISSIONS.md) | Showcase your city |
| [CHANGELOG.md](CHANGELOG.md) | What changed, release by release |
| [design.md](design.md) · [sounddesign.md](sounddesign.md) | The art and sound direction |

## License

[GNU AGPL-3.0](LICENSE). Use it, change it and run it. If you run a modified version for others, including as a website, publish your source under the same license.

Copyright © 2026 People of City.
