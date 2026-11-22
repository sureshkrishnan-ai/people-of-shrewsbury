import { CITY } from '@/city/config'

// The districts of the city. People of City listed Bengaluru's here by hand; this fork reads them from
// the city config (src/city/config.ts → src/city/districts.json), which the map pipeline shares.

/** A district id from src/city/districts.json ("town-center", "route-9", …). */
export type DistrictId = string

export type DistrictInfo = {
  id: DistrictId
  /** Matches a profile's `location`. */
  name: string
  title: string
  /** The name in a local script, if the city has one (Kannada for Bengaluru); '' for none. */
  kn: string
  identity: string
  accent: string
  built: boolean
}

export const DISTRICTS: DistrictInfo[] = CITY.districts.map((d) => ({ id: d.id, name: d.name, title: d.title, kn: '', identity: d.identity, accent: d.accent, built: true }))
const DEFAULT = DISTRICTS.find((d) => d.id === CITY.defaultDistrict) ?? DISTRICTS[0]

export const districtInfo = (id: DistrictId) => DISTRICTS.find((d) => d.id === id)!

/** Where a person lives in the game. Unknown / legacy locations count as the default district. */
export function districtOfLocation(location: string): DistrictInfo {
  return DISTRICTS.find((d) => d.name.toLowerCase() === location.toLowerCase()) ?? DEFAULT
}

/**
 * Where someone says they are. profiles.location is one text field (≤ 40): a district's name, another
 * area of town as typed ("Edgemere"), or another city with a leading "@" ("@Pune"). Anything that
 * isn't a built district visits the default district.
 */
export type PlaceKind = 'district' | 'blr' | 'city'
export const CITY_MARK = '@'

export function placeKind(location: string): PlaceKind {
  if (location.startsWith(CITY_MARK)) return 'city'
  return DISTRICTS.some((d) => d.name.toLowerCase() === location.toLowerCase()) ? 'district' : 'blr'
}

/** The place as typed, without the city mark. */
export const placeName = (location: string) => (location.startsWith(CITY_MARK) ? location.slice(1) : location)

/** For display: "Edgemere, Shrewsbury" · "Boston". */
export const placeLabel = (location: string) =>
  placeKind(location) === 'city' ? placeName(location) : `${placeName(location)}, ${CITY.placeSuffix}`

/** The district a person actually appears in right now (visitors stay in the default district). */
export function homeDistrict(location: string): DistrictId {
  const d = districtOfLocation(location)
  return d.built ? d.id : DEFAULT.id
}
