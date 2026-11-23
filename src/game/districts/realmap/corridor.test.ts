import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { boxDist, inCorridor, keepInCorridor, spineNearest, streamPlan, type Box } from './corridor'
import { decode, heightAt, ownsCell, type CorridorIndex, type Ring } from './data'

// Five 400 m chunks along a straight east–west street, boxes overlapping a little like the pipeline's.
const boxes: Box[] = [0, 1, 2, 3, 4].map((i) => [-1000 + i * 400 - 20, -200, -600 + i * 400 + 20, 200])
const spine: Ring = [[-1000, 0], [1000, 0]]

describe('corridor streaming', () => {
  it('measures distance to a box', () => {
    expect(boxDist([0, 0, 10, 10], 5, 5)).toBe(0)
    expect(boxDist([0, 0, 10, 10], 13, 14)).toBe(5)
  })
  it('loads the chunk you stand in first, then its neighbours', () => {
    const { load, drop } = streamPlan(boxes, -100, 0, new Set())
    expect(load[0]).toBe(2)
    expect(load).toContain(1)
    expect(drop).toEqual([])
    expect(load).not.toContain(4)
  })
  it('drops far chunks only past the drop radius (no flicker at the seam)', () => {
    const have = new Set([0, 1, 2])
    expect(streamPlan(boxes, 100, 0, have).drop).toEqual([0])
    // walking back a little does not reload or drop anything new
    const again = streamPlan(boxes, -150, 0, new Set([1, 2, 3]))
    expect(again.drop).toEqual([])
  })
  it('keeps the chunk under you even with tiny radii', () => {
    const { load } = streamPlan(boxes, 500, 0, new Set(), 0, 0)
    expect(load).toEqual([3])
  })
  it('walks the whole street end to end with a bounded number of chunks', () => {
    const have = new Set<number>()
    let most = 0
    for (let x = -990; x <= 990; x += 5) {
      const { load, drop } = streamPlan(boxes, x, 30, have)
      load.forEach((i) => have.add(i))
      drop.forEach((i) => have.delete(i))
      const under = boxes.findIndex((b) => boxDist(b, x, 30) === 0)
      expect(have.has(under)).toBe(true)
      most = Math.max(most, have.size)
    }
    expect(most).toBeLessThanOrEqual(3)
  })
})

describe('corridor band', () => {
  it('finds the station along the street', () => {
    const r = spineNearest([[0, 0], [100, 0], [100, 100]], 120, 50)
    expect(r.d).toBeCloseTo(20)
    expect(r.s).toBeCloseTo(150)
  })
  it('keeps you on the band and slides along its edge', () => {
    expect(inCorridor(spine, 170, 0, 160)).toBe(true)
    expect(inCorridor(spine, 170, 0, 180)).toBe(false)
    expect(keepInCorridor(spine, 170, 0, 169, 5, 172)).toEqual([5, 169])
  })
})

describe('corridor chunks from the pipeline', () => {
  const index = JSON.parse(readFileSync('public/districts/main-street.json', 'utf8')) as CorridorIndex
  it('covers the whole of Main Street in small chunks', () => {
    expect(index.kind).toBe('corridor')
    expect(index.length).toBeGreaterThan(5000)
    expect(index.chunks.length).toBeGreaterThan(10)
    for (const c of index.chunks) expect(c.bytes).toBeLessThan(250_000)
  })
  it('tiles the ground: neighbouring chunks never both draw a cell, and agree on height at the seam', () => {
    const a = decode(JSON.parse(readFileSync(`public/districts/${index.chunks[5].file}`, 'utf8')))
    const b = decode(JSON.parse(readFileSync(`public/districts/${index.chunks[6].file}`, 'utf8')))
    let both = 0
    let shared = 0
    for (let x = a.terrain.ox + 5; x < a.terrain.ox + (a.terrain.nx - 1) * 10; x += 10)
      for (let z = a.terrain.oz + 5; z < a.terrain.oz + (a.terrain.nz - 1) * 10; z += 10) {
        const oa = ownsCell(a.terrain, x, z)
        const ob = ownsCell(b.terrain, x, z)
        if (oa && ob) both++
        // a cell of b next to a cell of a: the corner on their shared edge has one height in both
        if (!oa) continue
        for (const [dx, dz, cx, cz] of [[-10, 0, -5, -5], [10, 0, 5, -5], [0, -10, -5, -5], [0, 10, -5, 5]]) {
          if (!ownsCell(b.terrain, x + dx, z + dz)) continue
          shared++
          expect(heightAt(a.terrain, x + cx, z + cz)).toBeCloseTo(heightAt(b.terrain, x + cx, z + cz), 2)
        }
      }
    expect(both).toBe(0)
    expect(shared).toBeGreaterThan(0)
  })
})
