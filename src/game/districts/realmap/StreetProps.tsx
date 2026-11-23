'use client'

// Draws street.ts's detail for one corridor chunk. Each kind of prop is ONE instanced mesh (parts merged into one
// geometry with vertex colours), so a chunk adds about nine draw calls whatever its length.

import * as THREE from 'three'
import { useEffect, useMemo } from 'react'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { heightAt, type RealDistrict } from './data'
import { streetDetail, type Span, type StreetDetail } from './street'

type Inst = { x: number; z: number; face: number; sx?: number; sy?: number; sz?: number; y?: number; color?: THREE.Color }

/** Parts → one geometry with a colour per part. */
function kit(parts: [THREE.BufferGeometry, string][]) {
  const gs = parts.map(([g, c]) => {
    const ng = g.index ? g.toNonIndexed() : g
    const col = new THREE.Color(c)
    const n = ng.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3)
    ng.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    ng.deleteAttribute('uv')
    return ng
  })
  return mergeGeometries(gs)!
}
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)
const cyl = (r0: number, r1: number, h: number, y: number, seg = 6) => new THREE.CylinderGeometry(r0, r1, h, seg).translate(0, y, 0)

const KITS = () => ({
  // a 1 m curb block, stretched along each span
  curb: kit([[box(1, 0.16, 0.28, 0, 0.08, 0), '#BDB7AA']]),
  lamp: kit([
    [cyl(0.07, 0.1, 4.6, 2.3), '#2F333B'],
    [box(0.1, 0.1, 1.1, 0, 4.55, 0.5), '#2F333B'],
    [box(0.36, 0.18, 0.5, 0, 4.45, 1.05), '#FFF1C9'],
  ]),
  pole: kit([
    [cyl(0.13, 0.17, 9.5, 4.75, 7), '#7A5E45'],
    [box(2.4, 0.14, 0.14, 0, 8.7, 0), '#6B5340'],
    [cyl(0.12, 0.12, 0.3, 8.95), '#8E959C'],
  ]),
  stop: kit([
    [cyl(0.04, 0.04, 2.3, 1.15), '#9AA0A6'],
    [new THREE.CylinderGeometry(0.38, 0.38, 0.04, 8).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).rotateZ(Math.PI / 8).translate(0, 2.25, 0.03), '#C8312B'],
  ]),
  mailbox: kit([
    [box(0.09, 1.0, 0.09, 0, 0.5, 0), '#5B4636'],
    [box(0.24, 0.26, 0.5, 0, 1.12, 0), '#2E3440'],
    [box(0.04, 0.12, 0.04, 0.14, 1.3, -0.1), '#C8312B'],
  ]),
  fence: kit([
    [box(1, 0.08, 0.05, 0, 0.45, 0), '#F4F1EA'],
    [box(1, 0.08, 0.05, 0, 0.85, 0), '#F4F1EA'],
    [box(0.07, 1.0, 0.07, -0.5, 0.5, 0), '#F4F1EA'],
  ]),
  hedge: kit([[box(1, 1.1, 0.9, 0, 0.55, 0), '#4E7A3A']]),
  car: kit([
    [box(1.75, 0.72, 4.3, 0, 0.62, 0), '#FFFFFF'],
    [box(1.55, 0.55, 2.2, 0, 1.25, -0.2), '#AEB8C2'],
    [box(1.8, 0.3, 0.6, 0, 0.35, 1.5), '#24262B'],
    [box(1.8, 0.3, 0.6, 0, 0.35, -1.5), '#24262B'],
  ]),
})

function spans(list: Span[], d: RealDistrict, step = 0): Inst[] {
  const out: Inst[] = []
  for (const s of list) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az)
    if (len < 0.2) continue
    const face = Math.atan2(s.bz - s.az, s.bx - s.ax)
    // long spans are cut so they follow the ground
    const n = step ? Math.max(1, Math.round(len / step)) : 1
    for (let k = 0; k < n; k++) {
      const x = s.ax + ((s.bx - s.ax) * (k + 0.5)) / n
      const z = s.az + ((s.bz - s.az) * (k + 0.5)) / n
      out.push({ x, z, face: -face, sx: len / n + 0.02 })
    }
  }
  return out
}

const CAR_COLORS = ['#B7342C', '#2F5D8A', '#E9E6DF', '#2B2D33', '#8C9298', '#5A6B4E', '#C9B27A', '#3D4E6B']

function Instanced({ geo, mat, items, d, shadow = true }: { geo: THREE.BufferGeometry; mat: THREE.Material; items: Inst[]; d: RealDistrict; shadow?: boolean }) {
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length))
    const mx = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.face)
      p.set(it.x, it.y ?? heightAt(d.terrain, it.x, it.z), it.z)
      s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1)
      m.setMatrixAt(i, mx.compose(p, q, s))
      if (it.color) m.setColorAt(i, it.color)
    })
    m.count = items.length
    m.castShadow = shadow
    m.receiveShadow = true
    m.computeBoundingSphere()
    return m
  }, [geo, mat, items, d, shadow])
  useEffect(() => () => mesh.dispose(), [mesh])
  return items.length ? <primitive object={mesh} /> : null
}

let shared: { kits: ReturnType<typeof KITS>; mat: THREE.MeshStandardMaterial; wire: THREE.LineBasicMaterial } | null = null
const resources = () => (shared ??= { kits: KITS(), mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), wire: new THREE.LineBasicMaterial({ color: '#1E2126' }) })

export function StreetProps({ d, detail }: { d: RealDistrict; detail: StreetDetail }) {
  const { kits, mat, wire } = resources()
  const sets = useMemo(() => {
    const pts = (l: { x: number; z: number; face: number }[]) => l.map((p) => ({ x: p.x, z: p.z, face: p.face }))
    return {
      curbs: spans(detail.curbs, d, 4),
      lamps: pts(detail.lamps),
      poles: pts(detail.poles),
      stops: pts(detail.stops),
      mailboxes: pts(detail.mailboxes),
      fences: spans(detail.fences, d, 2),
      hedges: spans(detail.hedges, d, 2),
      cars: detail.cars.map((c) => ({ x: c.x, z: c.z, face: c.face, color: new THREE.Color(CAR_COLORS[c.color % CAR_COLORS.length]) })),
    }
  }, [d, detail])
  const wires = useMemo(() => {
    const v: number[] = []
    for (const w of detail.wires) {
      const ya = heightAt(d.terrain, w.ax, w.az) + 8.6
      const yb = heightAt(d.terrain, w.bx, w.bz) + 8.6
      // three wires on the crossarm, each sagging a little in the middle
      const len = Math.hypot(w.bx - w.ax, w.bz - w.az) || 1
      const nx = -(w.bz - w.az) / len
      const nz = (w.bx - w.ax) / len
      for (const o of [-1, 0, 1]) {
        let px = w.ax + nx * o
        let pz = w.az + nz * o
        let py = ya + (o ? 0.07 : 0.4)
        for (let k = 1; k <= 4; k++) {
          const t = k / 4
          const x = w.ax + (w.bx - w.ax) * t + nx * o
          const z = w.az + (w.bz - w.az) * t + nz * o
          const y = ya + (yb - ya) * t + (o ? 0.07 : 0.4) - Math.sin(Math.PI * t) * 0.7
          v.push(px, py, pz, x, y, z)
          ;((px = x), (py = y), (pz = z))
        }
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
    return g
  }, [d, detail])
  useEffect(() => () => wires.dispose(), [wires])
  return (
    <group>
      <Instanced geo={kits.curb} mat={mat} items={sets.curbs} d={d} shadow={false} />
      <Instanced geo={kits.lamp} mat={mat} items={sets.lamps} d={d} />
      <Instanced geo={kits.pole} mat={mat} items={sets.poles} d={d} />
      <Instanced geo={kits.stop} mat={mat} items={sets.stops} d={d} />
      <Instanced geo={kits.mailbox} mat={mat} items={sets.mailboxes} d={d} />
      <Instanced geo={kits.fence} mat={mat} items={sets.fences} d={d} />
      <Instanced geo={kits.hedge} mat={mat} items={sets.hedges} d={d} />
      <Instanced geo={kits.car} mat={mat} items={sets.cars} d={d} />
      {detail.wires.length > 0 && <lineSegments geometry={wires} material={wire} />}
    </group>
  )
}

export { streetDetail }
