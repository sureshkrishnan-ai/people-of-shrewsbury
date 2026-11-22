# Maintaining People of Shrewsbury

The routine jobs, in order of how often you'll do them. Read [ROADMAP.md](../ROADMAP.md) for where it's going and
[DEPLOYING.md](DEPLOYING.md) for hosting.

## Weekly: review queue (residents and businesses)
- **Residents:** the foundation's admin (`/admin`, or `admin.<your domain>`) lists pending profiles. Approve only real
  people who signed up themselves. Never add someone on their behalf.
- **Businesses:** Supabase → Table editor → `businesses`, filter `status = pending`.
  1. Check the person is plausibly the owner/manager (business email or phone call to the shop).
  2. Read the story: no claims about competitors, no customers or children, nothing about security.
  3. Set `status = approved`. Hide with `status = hidden` (never delete — the row is the consent record).
- Answer removal requests within 7 days (consent text promise): set `hidden`, then delete if they ask for deletion.

## Consent records
- Every business row stores `consent_version` + `consent_at`; the wording lives in `docs/consent/<version>.md`.
  Never edit a published version — add `business-v2.md` and update `src/city/consent.ts` (text + CONSENT_VERSION).
- Interviews: keep the signed/emailed consent (photo, story) in the shared project folder, named `YYYY-MM-DD business-name`.
- Interiors (future): written permission from the owner/department + their review sign-off, same folder.

## Adding a business by hand (no database yet, or an owner emailed you)
- On OpenStreetMap already? It's in the town. To add the owner's story: Supabase → Table editor → `businesses` →
  insert a row with `osm_id` (the `id` in `src/city/data/businesses.json`, e.g. `osm-n739861173`), `owner_id` (your
  admin user), the story fields, `consent_version = 'business-v1-email'`, `status = approved`; keep the owner's email
  in the consent folder. (No database at all: v0 shows OSM listings only — that's by design.)
- Not on OSM? Best: add it on openstreetmap.org (correct tags, e.g. `shop=bakery`), wait for the next map refresh.

## Adding a resident
Residents add themselves in the game (become visible → profile). Sample residents live in
`src/game/people/profiles.ts`; keep them fictional, labelled `(SAMPLE)`, and never base them on real people.

## Monthly: refresh the map data
```bash
cd pipeline && ./run.sh           # ~1 min with caches; delete $SHREWSBURY_RAW/features.json to re-download OSM
git diff --stat public/districts src/city/data
npm test && npm run build         # then look at each district (?district=route-9) before committing
```
- Cadence: monthly, and before any launch/press. Overpass is a shared free service: don't run it more than daily.
- New district: add it to `src/city/districts.json` **and** `ROOM_DISTRICTS` in `shared/net/config.ts` (a test checks), re-run `districts.py`.
- Census numbers: set `CENSUS_API_KEY` and re-run; they appear on `/economy` with dataset and year.

## Syncing with the foundation (upstream)
```bash
git fetch upstream
git switch shrewsbury
git merge upstream/main            # merge, don't rebase: the history is public
npm ci && npm test && npx tsc --noEmit -p . && npm run build
```
Conflict hot spots (where this fork changed foundation files):
| File | What we changed | Resolve by |
|---|---|---|
| `src/lib/site.ts`, `src/lib/server/env.ts` | read `src/city/config.ts` | keep ours, take their new fields |
| `src/game/districts/registry.ts`, `districts/index.ts`, `world/DistrictWorld.tsx` | districts from the city config, real-map world | keep ours |
| `src/game/districts/active.ts`, `player/collision.ts`, `nav.ts`, `people/wander.ts`, `player/Player.tsx` | district size (`half`), collider index, street label, `?at=` | merge both; ours are small additions |
| `shared/net/config.ts`, `shared/net/protocol.ts` | room ids, BOUNDS 400, 2 cm position steps | keep ours — **the realtime server must be redeployed with the same file** |
| `src/game/hud/{Intro,HUD,Create,Pause,Invites,Search,PortalPicker,Interaction}.tsx` | city name from config, links | take theirs, re-apply the config reads |
| `src/game/scene/daylight.ts` | `localHour` via Intl | keep ours |
| `src/game/people/profiles.ts` | Shrewsbury sample residents | keep ours |
| `supabase/schema.sql` | + businesses | regenerate (command at the top of the file) |
| `src/app/globals.css` | our blocks are appended at the end | take theirs, keep our tail |
New files of ours (`src/city/`, `src/game/districts/realmap/`, `pipeline/`, `src/app/{economy,for-businesses,about}`) never conflict.

The city config is a candidate to offer upstream (CUSTOMIZATION.md asks for it): a PR with `src/city/config.ts` minus
the Shrewsbury values, kept small.

## Backups
- **Database:** Supabase free tier keeps no point-in-time backups. Weekly: `supabase db dump --data-only > backups/YYYY-MM-DD.sql`
  (Supabase CLI, signed in) and store it **outside** the repo (encrypted drive or private storage) — it has emails.
- **Code and map data:** GitHub is the backup; tag releases (`git tag v1.0.0`).
- **Consent folder:** keep two copies (shared drive + offline).

## Releases
Update `CHANGELOG.md` ([Unreleased] → version + date), take screenshots of each district, tag, push, deploy.
