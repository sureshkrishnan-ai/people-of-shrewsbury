import { supabase } from '@/lib/supabase'
import { BUSINESSES, type Business, type BusinessCategory } from '@/city/businesses'

// Approved owner profiles (supabase/migrations/20261122120000_businesses.sql) laid over the OSM listing.
// No database: nothing happens and the OSM listing shows as is.

type Row = { osm_id: string | null; name: string; category: string; address: string | null; website: string | null; story: string | null; owner_name: string | null; year_founded: number | null; jobs: number | null; photos: string[]; consent_at: string }

let started = false
export async function loadOwnerProfiles() {
  if (started || !supabase) return
  started = true
  const { data, error } = await supabase.from('businesses').select('osm_id,name,category,address,website,story,owner_name,year_founded,jobs,photos,consent_at').eq('status', 'approved')
  if (error || !data) return
  for (const r of data as Row[]) {
    const b = r.osm_id ? BUSINESSES.find((x) => x.id === r.osm_id) : undefined
    // a business that isn't on OpenStreetMap has no place in the 3D town yet (it shows on /economy); see docs/MAINTAINING.md
    if (!b) continue
    Object.assign(b, {
      name: r.name,
      category: r.category as BusinessCategory,
      addr: r.address ?? b.addr,
      website: r.website ?? b.website,
      story: r.story ?? undefined,
      ownerName: r.owner_name ?? undefined,
      yearFounded: r.year_founded ?? undefined,
      jobs: r.jobs ?? undefined,
      photos: r.photos,
      consentAt: r.consent_at,
      source: 'owner',
    } satisfies Partial<Business>)
  }
}
