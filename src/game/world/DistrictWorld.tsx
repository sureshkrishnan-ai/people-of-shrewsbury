'use client'

import { useGame } from '../store'
import { RealWorld } from '../districts/realmap/World'

/** Only the active district is mounted — travelling unmounts the old one. Every district is a real-map one. */
export function DistrictWorld() {
  const district = useGame((s) => s.district)
  return <RealWorld key={district} id={district} />
}
