'use client'

import { Suspense } from 'react'
import { useGame } from '../store'
import { RealWorld } from '../districts/realmap/World'

/** Only the active district is mounted — travelling unmounts the old one. Every district is a real-map one. */
export function DistrictWorld() {
  const district = useGame((s) => s.district)
  // Its own boundary: the district mounts after its data loads, and anything in it that suspends (sign fonts,
  // the portal) must not blank the whole scene — that would tear down the residents' name plates mid-render.
  return (
    <Suspense fallback={null}>
      <RealWorld key={district} id={district} />
    </Suspense>
  )
}
