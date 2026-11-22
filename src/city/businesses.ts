// Local businesses. Two sources, merged by id:
//  1. OpenStreetMap POIs (src/city/data/businesses.json, written by pipeline/districts.py): name, category,
//     address and website as mapped on OSM — "listed from OpenStreetMap — story not yet added".
//  2. Owner-submitted profiles (Supabase `businesses` table, see supabase/migrations/*_businesses.sql), only
//     after the owner consents and a reviewer approves. Without a database, only (1) shows.
// No invented stories, no scraped photos: a story or photo appears only when its owner gave it to us.

import data from './data/businesses.json'
import economy from './data/economy.json'

export const CATEGORIES = economy.categories as BusinessCategory[]
export type BusinessCategory = 'food' | 'retail' | 'services' | 'health' | 'auto' | 'trades' | 'finance' | 'fitness' | 'lodging' | 'offices' | 'civic'

export const CATEGORY_LABEL: Record<BusinessCategory, string> = {
  food: 'Food & drink',
  retail: 'Shops',
  services: 'Services',
  health: 'Health',
  auto: 'Auto',
  trades: 'Trades & home',
  finance: 'Finance & insurance',
  fitness: 'Fitness & leisure',
  lodging: 'Places to stay',
  offices: 'Offices',
  civic: 'Civic & community',
}

export const CATEGORY_COLOR = economy.colors as Record<BusinessCategory, string>

/**
 * Reserved for later (ROADMAP "Enterable buildings"): a door you can walk through into an interior scene.
 * Ignored by v0. Only ever set with the owner's / department's written permission; public areas only.
 */
export type Interior = {
  kind: 'model' | 'photo360' | 'video'
  /** Where the door is, in district metres; walking up to it offers "Go inside". */
  door: { x: number; z: number }
  /** The interior scene, 360° sphere or video tour, once approved. */
  src: string
  /** Who approved publishing it, and when (consent record id). */
  approvedBy: string
}

export type Business = {
  id: string
  name: string | null
  category: BusinessCategory
  /** The OSM tag it came from, e.g. "amenity=restaurant". */
  osmKind: string | null
  /** false for civic places (town hall, library, schools): shown, but not counted as businesses. */
  business: boolean
  addr: string | null
  website: string | null
  brand: string | null
  inTown: boolean
  /** The district it stands in, and where (district metres), or null if outside every walkable district. */
  district: string | null
  pos: [number, number] | null
  /** Where the listing came from. */
  source: 'osm' | 'owner'
  // ---- only from the owner, with consent ----
  story?: string
  ownerName?: string
  yearFounded?: number
  jobs?: number
  photos?: string[]
  consentAt?: string
  interior?: Interior
}

export const BUSINESSES: Business[] = (data.businesses as Omit<Business, 'source'>[]).map((b) => ({ ...b, category: b.category as BusinessCategory, source: 'osm' as const }))

export const DATA_SOURCE = data.source

export const businessesIn = (district: string) => BUSINESSES.filter((b) => b.district === district)

export const businessById = (id: string) => BUSINESSES.find((b) => b.id === id)

/** Merge approved owner profiles (from the database) over the OSM listing. */
export function mergeOwnerProfiles(base: Business[], owners: Partial<Business>[]): Business[] {
  const byId = new Map(base.map((b) => [b.id, b]))
  for (const o of owners) {
    if (!o.id) continue
    const prev = byId.get(o.id)
    byId.set(o.id, { ...(prev ?? ({ id: o.id, name: null, category: 'retail', osmKind: null, business: true, addr: null, website: null, brand: null, inTown: true, district: null, pos: null } as Business)), ...o, source: 'owner' } as Business)
  }
  return [...byId.values()]
}

/** "Restaurant", "Car repair" — a readable kind from the OSM tag. */
export function kindLabel(b: Pick<Business, 'osmKind' | 'category'>) {
  const v = b.osmKind?.split('=')[1]
  if (!v) return CATEGORY_LABEL[b.category]
  const s = v.replace(/_/g, ' ')
  return s[0].toUpperCase() + s.slice(1)
}
