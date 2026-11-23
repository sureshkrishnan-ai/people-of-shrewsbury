// Corridor districts (a whole street, pipeline/corridors.py): which chunks to stream in and out as you walk,
// and whether a point is on the walkable band along the street. Pure functions — the streaming state lives in index.ts.

import type { Ring } from './data'

export type Box = [number, number, number, number]

/** Distance from (x, z) to a chunk's box (0 inside). */
export function boxDist(b: Box, x: number, z: number) {
  const dx = Math.max(b[0] - x, 0, x - b[2])
  const dz = Math.max(b[1] - z, 0, z - b[3])
  return Math.hypot(dx, dz)
}

/** Load radius and drop radius (m from a chunk's box). The gap between them stops chunks flickering in and out at a seam. */
export const LOAD_R = 220
export const DROP_R = 380

/**
 * What to change: chunks within `loadR` that aren't loaded (or loading), nearest first; loaded chunks beyond `dropR`.
 * The chunk you stand in always stays.
 */
export function streamPlan(boxes: Box[], x: number, z: number, have: ReadonlySet<number>, loadR = LOAD_R, dropR = DROP_R) {
  const load: number[] = []
  const drop: number[] = []
  const dist = boxes.map((b) => boxDist(b, x, z))
  boxes.forEach((_, i) => {
    if (!have.has(i) && dist[i] <= loadR) load.push(i)
    if (have.has(i) && dist[i] > dropR) drop.push(i)
  })
  load.sort((a, b) => dist[a] - dist[b])
  return { load, drop }
}

/** Nearest point of the street's spine: distance, and how far along the street (m from its west end). */
export function spineNearest(spine: Ring, x: number, z: number) {
  let best = Infinity
  let at = 0
  let run = 0
  for (let i = 0; i + 1 < spine.length; i++) {
    const [ax, az] = spine[i]
    const [bx, bz] = spine[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const l2 = dx * dx + dz * dz
    const len = Math.sqrt(l2)
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0
    const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz))
    if (d < best) ((best = d), (at = run + t * len))
    run += len
  }
  return { d: best, s: at }
}

/** On the walkable band: within `buffer` m of the street. */
export const inCorridor = (spine: Ring, buffer: number, x: number, z: number) => spineNearest(spine, x, z).d <= buffer

/**
 * Keep a step on the band: if (x, z) left it, slide along the edge (try keeping x or z) or stay at the previous point.
 */
export function keepInCorridor(spine: Ring, buffer: number, px: number, pz: number, x: number, z: number): [number, number] {
  if (inCorridor(spine, buffer, x, z)) return [x, z]
  // already off the band (a teleport, `?at=`): let them walk back rather than freezing them
  if (!inCorridor(spine, buffer, px, pz)) return [x, z]
  if (inCorridor(spine, buffer, x, pz)) return [x, pz]
  if (inCorridor(spine, buffer, px, z)) return [px, z]
  return [px, pz]
}
