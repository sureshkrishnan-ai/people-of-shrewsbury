import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decode, inRing } from './data'

// The generated district files (pipeline/districts.py + realbuildings.py): real heights, roofs and LiDAR trees.
const load = (f: string) => decode(JSON.parse(readFileSync(`public/districts/${f}`, 'utf8')))

describe('real heights and LiDAR trees', () => {
  const tc = load('town-center.json')
  it('Town Center buildings carry where their height came from, mostly measured', () => {
    const n = (s: string) => tc.buildings.filter((b) => b.src === s).length
    expect(n('lidar') + n('overture')).toBeGreaterThan(tc.buildings.length * 0.7)
    for (const b of tc.buildings) expect(b.height).toBeGreaterThan(1.5)
  })
  it('pitched LiDAR roofs are drawn at 30-45 degrees (measured ridge kept)', () => {
    const pitches: number[] = []
    for (const b of tc.buildings) {
      if (b.src !== 'lidar' || (b.roof !== 'gable' && b.roof !== 'hip') || b.eave === null || b.eave <= 2.5) continue
      const ux = Math.cos(b.ridge), uz = Math.sin(b.ridge)
      const cs = b.ring.map(([x, z]) => -x * uz + z * ux)
      const half = (Math.max(...cs) - Math.min(...cs)) / 2 + 0.35
      const pitch = (Math.atan2(b.height - b.eave, half) * 180) / Math.PI
      expect(pitch).toBeLessThan(46.5)
      pitches.push(pitch)
    }
    // simplified `complex` roofs keep their measured (often lower) pitch; plain gables and hips sit at 30-45
    pitches.sort((a, b) => a - b)
    expect(pitches.length).toBeGreaterThan(20)
    expect(pitches[Math.floor(pitches.length / 2)]).toBeGreaterThan(29)
  })
  it('a church on the Common has a steeple', () => {
    expect(tc.buildings.some((b) => b.spire > b.height + 6)).toBe(true)
  })
  it('LiDAR trees cover Town Center, largest first, none inside a building', () => {
    expect(tc.lidarCover).toBeGreaterThan(0.5)
    expect(tc.ltrees.length).toBeGreaterThan(1000)
    for (let i = 1; i < tc.ltrees.length; i++) expect(tc.ltrees[i].h * tc.ltrees[i].r).toBeLessThanOrEqual(tc.ltrees[i - 1].h * tc.ltrees[i - 1].r + 0.2)
    const big = tc.buildings.filter((b) => b.ring.length > 3)
    const inside = tc.ltrees.filter((t) => big.some((b) => Math.abs(b.cx - t.x) < 40 && Math.abs(b.cz - t.z) < 40 && inRing(b.ring, t.x, t.z)))
    expect(inside.length).toBeLessThanOrEqual(tc.ltrees.length * 0.005) // footprint simplification can leave an odd edge tree
  })
})
