// THE CITY CONFIG — the one place a fork of People of City says which city it is.
// (CUSTOMIZATION.md "A future city config".) Everything city-specific that used to be hardcoded
// reads from here: names, domain, clock, districts, labels, palette accents, street-name style.
//
// Kept dependency-free (no React, no three) so the site, the game, tests and the pipeline docs can all import it.

import districtsJson from './districts.json'

export type CityDistrict = {
  /** Stable id: file name in public/districts/, the room name, the profile's district. */
  id: string
  /** Matches a profile's `location`. */
  name: string
  /** Shown in the HUD. */
  title: string
  identity: string
  accent: string
  /** Pipeline local metres (x east, y north) — see pipeline/README.md. */
  centre: [number, number]
  /** Half the side of the walkable square, metres. */
  half: number
  /** The street you arrive on (pipeline picks its point nearest the centre). */
  spawnStreet?: string | null
}

export const CITY = {
  /** The place, as people say it. */
  name: 'Shrewsbury',
  /** For the title screen (stacked: "PEOPLE OF" / this). */
  titleWord: 'SHREWSBURY',
  region: 'Massachusetts',
  regionShort: 'MA',
  /** "Shrewsbury, MA" */
  fullName: 'Shrewsbury, MA',
  siteName: 'People of Shrewsbury',
  siteTitle: 'People of Shrewsbury — walk the town, meet its people and local businesses',
  siteDescription:
    'A stylised 3D Shrewsbury, Massachusetts, built from the real map. Walk Main Street, Route 9 and the shore of Lake Quinsigamond, meet residents, and discover the local businesses that make the town work.',
  tagline: 'Walk the real streets of town. Meet its people and the local businesses that keep it going.',
  /** Placeholder until a domain is bought (see docs/DEPLOYING.md). Set NEXT_PUBLIC_SITE_URL to override. */
  url: 'https://peopleofshrewsbury.example',
  /** IANA zone: the light and the HUD clock follow it, daylight saving included. */
  timeZone: 'America/New_York',
  /** Locale for dates and numbers. */
  locale: 'en-US',
  /** Street signs: English only here. A city with a local script sets `localScript` and its font. */
  localScript: null as null | { name: string; cssVar: string },
  /** Shown under a profile's place: "Maple Avenue, Shrewsbury". */
  placeSuffix: 'Shrewsbury',
  /** Example text in forms. */
  examples: {
    otherArea: 'Edgemere, Spag’s corner, Shrewsbury Street…',
    bio: 'I’ve lived in Shrewsbury for six years and…',
  },
  /** The map data credit shown on the title screen and the About page (ODbL requires it). */
  mapCredit: 'Map data © OpenStreetMap contributors (ODbL) · terrain USGS 3DEP',
  districts: districtsJson.districts as unknown as CityDistrict[],
  /** The district you start in. */
  defaultDistrict: 'town-center',
} as const

export type CityDistrictId = (typeof CITY.districts)[number]['id']

/** Hours (0–24) on the city's wall clock, daylight saving included, wherever the player is. */
export function cityHour(ms: number, timeZone: string = CITY.timeZone): number {
  const parts = hourFormatter(timeZone).formatToParts(new Date(ms))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const h = get('hour') % 24
  return h + get('minute') / 60 + get('second') / 3600 + (ms % 1000) / 3_600_000
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function hourFormatter(timeZone: string) {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    formatters.set(timeZone, f)
  }
  return f
}

/** The district to open in: `?district=route-9` (shareable links, screenshots), else the default. */
export function startDistrict(): string {
  if (typeof window === 'undefined') return CITY.defaultDistrict
  const q = new URLSearchParams(window.location.search).get('district')
  return q && CITY.districts.some((d) => d.id === q) ? q : CITY.defaultDistrict
}

/** `?at=x,z[,face]`: start at that point of the district instead of its spawn. */
export function startPose(): { x: number; z: number; face: number } | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get('at')?.split(',').map(Number)
  return v && v.length >= 2 && v.every(Number.isFinite) ? { x: v[0], z: v[1], face: v[2] ?? 0 } : null
}
