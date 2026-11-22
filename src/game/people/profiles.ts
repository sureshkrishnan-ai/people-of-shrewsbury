import type { Status } from '../status'
// SAMPLE RESIDENTS — fictional people, clearly labelled "(SAMPLE)", so the town isn't empty before real,
// consented residents join (SUBMISSIONS.md). They are not real Shrewsbury residents and never will be: no real
// names, no real businesses. They retire automatically once the community is big enough (directory.ts).

export type Profile = {
  id: string
  name: string
  role: string
  company: string
  /** Where in town they say they're from — a district name or an area (not where they stand in the scene). */
  location: string
  building?: string
  previously?: string
  openToWork: boolean
  skills: string[]
  links: { portfolio?: string; linkedin?: string; x?: string }
  /** Character style from the roster. */
  character: string
  /** Where they spend time in the district. Either a fixed spot or a looping walk. */
  spot?: { x: number; z: number; face: number }
  path?: [number, number][]
  pause?: number
  /** Fictional sample person (not a real profile). */
  sample?: boolean
  /** Their status above the nameplate (Phase 5F): a short line + emoji. */
  status?: Status
}

import metaJson from '@/city/data/districts-meta.json'

const META = metaJson as unknown as Record<string, { slots: [number, number, number][] }>
/** The k-th standing slot of a district (pipeline-placed on the pavement of its main street). */
const at = (district: string, k: number) => {
  const s = META[district]?.slots ?? [[0, 0, 0]]
  const [x, z, face] = s[k % s.length]
  return { x, z, face }
}

const sample = (p: Omit<Profile, 'links' | 'openToWork'> & Partial<Profile>): Profile => ({ links: {}, openToWork: false, sample: true, ...p })

export const PEOPLE: Profile[] = [
  sample({ id: 's-maya', name: 'MAYA (SAMPLE)', role: 'Sample resident · Teacher', company: 'Fictional', location: 'Town Center', building: 'Weekend tutoring at the library', skills: ['Reading club', 'Science fair'], character: 'designer', status: { emoji: '📚', text: 'This is a sample person — real residents join with consent', expiresAt: null }, spot: at('town-center', 0) }),
  sample({ id: 's-leo', name: 'LEO (SAMPLE)', role: 'Sample resident · Bakery owner', company: 'Fictional bakery', location: 'Town Center', skills: ['Sourdough', 'Small business'], character: 'maker', status: { emoji: '🥐', text: 'Ask me how a small shop works', expiresAt: null }, spot: at('town-center', 1) }),
  sample({ id: 's-ana', name: 'ANA (SAMPLE)', role: 'Sample resident · Nurse', company: 'Fictional', location: 'Town Center', skills: ['Health', 'Running'], character: 'hero', spot: at('town-center', 2) }),
  sample({ id: 's-raj', name: 'RAJ (SAMPLE)', role: 'Sample resident · Restaurant manager', company: 'Fictional', location: 'Route 9', skills: ['Hospitality', 'Hiring'], character: 'founder', status: { emoji: '🍽️', text: 'Route 9 has the most restaurants in town', expiresAt: null }, spot: at('route-9', 0) }),
  sample({ id: 's-kim', name: 'KIM (SAMPLE)', role: 'Sample resident · Mechanic', company: 'Fictional garage', location: 'Route 9', skills: ['Cars', 'Apprenticeships'], character: 'developer', spot: at('route-9', 1) }),
  sample({ id: 's-sofia', name: 'SOFIA (SAMPLE)', role: 'Sample resident · Rowing coach', company: 'Fictional', location: 'Lake Quinsigamond', skills: ['Rowing', 'Kayaks'], character: 'creative', status: { emoji: '🚣', text: 'The lake is 7 km long', expiresAt: null }, spot: at('lake-shore', 0) }),
  sample({ id: 's-ben', name: 'BEN (SAMPLE)', role: 'Sample resident · Grocery clerk', company: 'Fictional', location: 'Route 20', skills: ['Customer service'], character: 'pm', spot: at('route-20', 0) }),
  sample({ id: 's-ivy', name: 'IVY (SAMPLE)', role: 'Sample resident · Retired engineer', company: 'Fictional', location: 'North Shrewsbury', skills: ['Gardening', 'Town history'], character: 'investor', spot: at('north', 0) }),
  sample({ id: 's-omar', name: 'OMAR (SAMPLE)', role: 'Sample resident · Electrician', company: 'Fictional', location: 'South Shrewsbury', skills: ['Trades', 'Solar'], character: 'moonshot', spot: at('south', 0) }),
]
