# Deploying People of Shrewsbury

Everything here runs on free tiers. Steps marked **(you)** need an account, a payment method or a decision.

## 0. Push the code (you)
```bash
git push -u origin shrewsbury        # github.com/sureshkrishnan-ai/people-of-shrewsbury
```
Then make `shrewsbury` the default branch (Settings → Branches) or merge it into `main` — CI runs on both.

## 1. Supabase (accounts, residents, businesses) (you)
1. Create a free project at supabase.com (region: US East).
2. SQL editor → paste `supabase/schema.sql` → Run (all tables, RLS policies, functions — includes `businesses`).
3. Authentication → URL configuration: Site URL = your domain; add `http://localhost:3000` for development.
4. Authentication → Email: the free built-in mailer is rate-limited; for launch, add SMTP (e.g. Resend free tier).
5. Make yourself admin: see the foundation README ("is_admin").
6. Copy Project URL, publishable key and secret key (Settings → API).

Without Supabase the site still works: guest walk-through, sample residents, OSM businesses, all pages.

## 2. Vercel (website) (you)
1. vercel.com → Add New Project → import the GitHub repo, framework Next.js, build `npm run build`.
2. Environment variables (Production and Preview):
   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | from step 1 |
   | `SUPABASE_PUBLISHABLE_KEY` | from step 1 |
   | `SUPABASE_SECRET_KEY` | from step 1 (server only — never `NEXT_PUBLIC_`) |
   | `CRON_SECRET` | any long random string |
   | `NEXT_PUBLIC_SITE_URL` | `https://<your domain>` |
   | `NEXT_PUBLIC_REALTIME_URL` | empty for now (live positions are optional) |
3. Deploy. Check `/`, `/economy`, `/for-businesses`, `/about`.

Cloudflare Pages works too (Next.js on Workers via OpenNext) but Vercel is the path the foundation is tested on.

## 3. Domain (you)
1. Buy a domain (e.g. a `.org` — about $10/year) at any registrar.
2. Vercel → Project → Domains → add it and `www`; set the DNS records Vercel shows.
3. For the admin subdomain add `admin.<domain>` too (src/proxy.ts routes it to the review queue).
4. Put the domain in `NEXT_PUBLIC_SITE_URL` (or change `url` in `src/city/config.ts`) and redeploy.

## 4. Optional: live positions (Cloudflare Workers)
`realtime/` is the foundation's room server. With a Cloudflare account: `npm --prefix realtime run deploy:production`,
then set `NEXT_PUBLIC_REALTIME_URL`. **Deploy it from this fork** — the position format (2 cm steps, 400 m bounds) and
district ids differ from People of City's.

## 5. Optional: Census figures
Get a free key at api.census.gov/data/key_signup.html, run `CENSUS_API_KEY=… pipeline/run.sh`, commit
`src/city/data/economy.json`.

## Checklist before telling people
- [ ] Map data refreshed this month; OSM credit visible on the title screen and /about.
- [ ] At least two maintainers can approve the review queue.
- [ ] No placeholder text visible except the labelled Census placeholders.
- [ ] Tested on one iPhone and one Android phone.
