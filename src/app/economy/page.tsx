import type { Metadata } from 'next'
import { Bars, SitePage } from '@/components/SitePage'
import { BUSINESSES, CATEGORY_LABEL, type BusinessCategory } from '@/city/businesses'
import { CITY } from '@/city/config'
import economy from '@/city/data/economy.json'

export const metadata: Metadata = {
  title: `Local economy — ${CITY.siteName}`,
  description: `How ${CITY.fullName}'s local businesses add up: what's mapped, where, and why shopping local matters.`,
}

// Everyday kinds of shop a town usually has. A low OpenStreetMap count is a *rough* sign of a gap — or just of
// a business nobody has mapped yet. The page says so.
const EVERYDAY: [string, string][] = [
  ['shop=bakery', 'Bakery'],
  ['shop=books', 'Bookshop'],
  ['shop=hardware', 'Hardware store'],
  ['amenity=cafe', 'Café'],
  ['amenity=ice_cream', 'Ice cream'],
  ['shop=florist', 'Florist'],
  ['shop=toys', 'Toy shop'],
  ['shop=bicycle', 'Bike shop'],
  ['shop=laundry', 'Laundromat'],
  ['shop=greengrocer', 'Greengrocer / farm stand'],
  ['shop=shoes', 'Shoe shop'],
  ['shop=clothes', 'Clothes shop'],
  ['shop=stationery', 'Stationery / art supplies'],
  ['amenity=pharmacy', 'Pharmacy'],
]

export default function EconomyPage() {
  const town = economy.town
  const byCat = Object.entries(town.byCategory as Record<string, number>).sort((a, b) => b[1] - a[1])
  const byDistrict = economy.byDistrict as Record<string, Record<string, number>>
  const kinds = town.byOsmKind as Record<string, number>
  const withYear = BUSINESSES.filter((b) => b.yearFounded)
  const decades = new Map<string, number>()
  for (const b of withYear) {
    const d = `${Math.floor(b.yearFounded! / 10) * 10}s`
    decades.set(d, (decades.get(d) ?? 0) + 1)
  }
  return (
    <SitePage kicker="THE BUSINESS SIDE" title={`${CITY.name}'s local economy`}>
      <p>
        Every town runs on its small businesses: the bakery, the garage, the dentist, the pizza place. This page counts what
        is <b>mapped</b> today and explains why it matters where we spend our money. It is part of a community project and a
        Girl Scout local-economy project (see <a href="/about">About</a>).
      </p>

      <div className="site-grid">
        <div className="stat">
          <div className="stat-n">{town.total}</div>
          <div className="stat-l">businesses mapped on OpenStreetMap inside the town</div>
          <div className="stat-src">Source: © OpenStreetMap contributors, pipeline run Nov 2026</div>
        </div>
        <div className="stat">
          <div className="stat-n">{byCat[0]?.[1] ?? 0}</div>
          <div className="stat-l">of them are {CATEGORY_LABEL[byCat[0]?.[0] as BusinessCategory]?.toLowerCase()} — the biggest group</div>
          <div className="stat-src">Source: OpenStreetMap</div>
        </div>
        <div className="stat">
          <div className="stat-n">{economy.counts.buildings_in_town.toLocaleString('en-US')}</div>
          <div className="stat-l">buildings mapped in town (heights mostly estimated)</div>
          <div className="stat-src">Source: OpenStreetMap</div>
        </div>
      </div>
      <p className="site-note">
        OpenStreetMap is made by volunteers, so these counts are <b>lower than reality</b> — many businesses (especially
        offices, home businesses and trades) aren&apos;t mapped yet. Adding them is one of the ways you can help.
      </p>

      <h2>Businesses by category</h2>
      <Bars rows={byCat.map(([c, n]) => ({ label: CATEGORY_LABEL[c as BusinessCategory] ?? c, value: n }))} />

      <h2>By area</h2>
      <p className="site-note">The walkable districts of the 3D town (each about 700 m square). Most of the town lies between them.</p>
      <Bars
        rows={CITY.districts.map((d) => ({
          label: d.name,
          value: Object.values(byDistrict[d.id] ?? {}).reduce((s, n) => s + n, 0),
        }))}
      />

      <h2>By age</h2>
      {withYear.length ? (
        <Bars rows={[...decades.entries()].sort().map(([d, n]) => ({ label: d, value: n }))} />
      ) : (
        <div className="site-card">
          <b>Not yet.</b> OpenStreetMap doesn&apos;t record when a business was founded. This chart fills in as owners add
          their year founded through <a href="/for-businesses">the business form</a>. We won&apos;t guess.
        </div>
      )}

      <h2>The town in numbers</h2>
      <div className="site-grid">
        {[
          ['Population', 'ACS 5-year, table DP05'],
          ['Median household income', 'ACS 5-year, table DP03'],
          ['People employed', 'ACS 5-year, table DP03'],
          ['Business establishments (ZIP 01545)', 'County Business Patterns'],
          ['Unemployment rate', 'BLS Local Area Unemployment Statistics'],
        ].map(([label, src]) => (
          <div className="stat stat--placeholder" key={label}>
            <div className="stat-n">—</div>
            <div className="stat-l">{label}</div>
            <div className="stat-src">
              Placeholder: not fetched yet. Source when filled: US Census Bureau / BLS, {src}.
            </div>
          </div>
        ))}
      </div>
      <p className="site-note">
        These figures are left blank on purpose until they are downloaded from the official source with its year (the
        Census API needs a free key; see <code>pipeline/README.md</code>). We never fill them in by hand or by guess.
      </p>

      <h2>Why shop local?</h2>
      <div className="site-card">
        <ul>
          <li>
            <b>Money stays around.</b> When you buy from a local owner, more of that money is spent again in town — on local
            staff, suppliers and services — than when it goes to a company based far away. Economists call this the
            <i> local multiplier</i>.
          </li>
          <li>
            <b>Jobs for neighbours.</b> Small businesses employ people who live nearby, often their first job.
          </li>
          <li>
            <b>Taxes for the town.</b> Business property helps pay for schools, roads and the library.
          </li>
          <li>
            <b>Character.</b> Independent shops make Main Street feel like {CITY.name} and nowhere else.
          </li>
        </ul>
        <p className="site-note">
          Studies of the local multiplier differ on the size of the effect; we explain the idea rather than quote one number.
        </p>
      </div>

      <h2>Ideas board: what might the town be missing?</h2>
      <p>
        Everyday kinds of shop and how many are mapped in town. A <b>0 or 1</b> could be a market gap — a business idea — or
        simply a shop nobody has mapped yet. <b>Rough indicator only.</b> Check by walking around and asking people!
      </p>
      <Bars rows={EVERYDAY.map(([k, label]) => ({ label, value: kinds[k] ?? 0, note: k }))} />

      <h2>Where this comes from</h2>
      <ul className="site-note">
        {economy.sources.map((s: string) => (
          <li key={s}>{s}</li>
        ))}
        <li>Business categories: our mapping of OpenStreetMap tags (pipeline/categories.py), not an official classification.</li>
      </ul>
    </SitePage>
  )
}
