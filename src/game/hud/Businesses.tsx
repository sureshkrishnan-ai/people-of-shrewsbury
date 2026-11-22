'use client'

// The business side in the city: walk up to a shop sign → its card; the ECONOMY layer toggle and the
// district's business summary. Listings come from OpenStreetMap until an owner adds their story (src/city/businesses.ts).

import { useEffect, useState } from 'react'
import { CATEGORY_COLOR, CATEGORY_LABEL, kindLabel, type Business, type BusinessCategory } from '@/city/businesses'
import economy from '@/city/data/economy.json'
import { useGame } from '../store'
import { player } from '../people/bodies'
import { isTyping } from '../player/input'
import { realData } from '../districts/realmap'
import { signPlaces, type SignPlace } from '../districts/realmap/World'
import { useEconomy } from '../districts/realmap/economyStore'
import { districtInfo } from '../districts/registry'

const REACH = 4.5
const cachePlaces = new Map<string, SignPlace[]>()

function placesFor(district: string) {
  let p = cachePlaces.get(district)
  if (!p) {
    const d = realData(district)
    if (!d) return []
    cachePlaces.set(district, (p = signPlaces(d)))
  }
  return p
}

const blocked = () => {
  const g = useGame.getState()
  return g.phase !== 'play' || !!g.openId || !!g.focusId || g.nearPortal || g.searchOpen || g.paused || g.portalOpen || !!g.travel || g.statusOpen || g.connectOpen || g.invitesOpen || g.profileOpen
}

export function BusinessCard({ b, onClose }: { b: Business; onClose: () => void }) {
  return (
    <div className="panel biz-card" role="dialog" aria-label={b.name ?? 'Business'}>
      <div className="biz-card-band" style={{ background: CATEGORY_COLOR[b.category] }} />
      <button className="biz-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      <div className="biz-kicker">
        <span className="biz-chip" style={{ background: CATEGORY_COLOR[b.category] }}>
          {CATEGORY_LABEL[b.category].toUpperCase()}
        </span>
        <span>{kindLabel(b)}</span>
      </div>
      <h2 className="biz-name">{b.name}</h2>
      {b.addr && <p className="biz-line">📍 {b.addr}, Shrewsbury</p>}
      {b.website && (
        <p className="biz-line">
          🔗{' '}
          <a href={b.website} target="_blank" rel="noopener noreferrer nofollow">
            {b.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
          </a>
        </p>
      )}
      {b.story ? (
        <>
          <p className="biz-story">{b.story}</p>
          <p className="biz-meta">
            {b.yearFounded && <>Since {b.yearFounded}</>}
            {b.jobs ? <> · {b.jobs} local jobs</> : null}
          </p>
        </>
      ) : (
        <p className="biz-empty">
          Listed from OpenStreetMap — <b>story not yet added</b>. We only show stories and photos that owners give us.
        </p>
      )}
      <div className="biz-actions">
        <a className="btn-primary slant" href={`/for-businesses?listing=${encodeURIComponent(b.id)}`} target="_blank" rel="noopener">
          <span className="unslant">IS THIS YOUR BUSINESS? ▸</span>
        </a>
      </div>
      <p className="biz-source">{b.source === 'osm' ? 'Source: © OpenStreetMap contributors (ODbL)' : 'Added by the owner, with consent'}</p>
    </div>
  )
}

/** Near a sign: the prompt; E or a tap opens the card. */
export function BusinessInteraction() {
  const district = useGame((s) => s.district)
  const [near, setNear] = useState<SignPlace | null>(null)
  const [open, setOpen] = useState<Business | null>(null)
  useEffect(() => {
    setOpen(null)
    // dev only: lets screenshot scripts find a sign
    if (process.env.NODE_ENV !== 'production') Object.assign(window, { __signs: () => placesFor(district), __player: player })
    const t = setInterval(() => {
      if (!player.pos || blocked()) return setNear((n) => (n ? null : n))
      let best: SignPlace | null = null
      let bd = REACH
      for (const p of placesFor(district)) {
        const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z)
        if (d < bd) ((bd = d), (best = p))
      }
      setNear((n) => (n?.b.id === best?.b.id ? n : best))
    }, 200)
    return () => clearInterval(t)
  }, [district])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      if (e.code === 'Escape' && open) return setOpen(null)
      if (e.code === 'KeyE' && near && !open && !blocked()) setOpen(near.b)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [near, open])
  if (open) return <BusinessCard b={open} onClose={() => setOpen(null)} />
  if (!near) return null
  return (
    <button className="prompt prompt--person slant biz-prompt" onClick={() => setOpen(near.b)}>
      <span className="unslant prompt-body">
        <span className="prompt-open" style={{ color: CATEGORY_COLOR[near.b.category] }}>
          {CATEGORY_LABEL[near.b.category].toUpperCase()}
        </span>
        <span className="prompt-name">{near.b.name}</span>
        <span className="prompt-action">
          <span className="keycap">E</span> VIEW BUSINESS
        </span>
      </span>
    </button>
  )
}

/** The ECONOMY toggle (key X) and, while on, this district's businesses by category. */
export function EconomyLayer() {
  const { on, toggle } = useEconomy()
  const district = useGame((s) => s.district)
  const phase = useGame((s) => s.phase)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTyping(e) && e.code === 'KeyX' && useGame.getState().phase === 'play') toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])
  if (phase !== 'play') return null
  const counts = ((economy.byDistrict as Record<string, Record<string, number>>)[district] ?? {}) as Record<BusinessCategory, number>
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]) as [BusinessCategory, number][]
  const total = rows.reduce((s, [, n]) => s + n, 0)
  return (
    <>
      <button className={`slant econ-toggle${on ? ' econ-toggle--on' : ''}`} onClick={toggle} aria-pressed={on}>
        <span className="unslant">
          ECONOMY <span className="keycap">X</span>
        </span>
      </button>
      {on && (
        <div className="panel econ-panel">
          <div className="econ-title">{districtInfo(district).title} · LOCAL ECONOMY</div>
          <div className="econ-total">
            <b>{total}</b> businesses mapped on OpenStreetMap
          </div>
          <ul>
            {rows.map(([c, n]) => (
              <li key={c}>
                <span className="econ-dot" style={{ background: CATEGORY_COLOR[c] }} />
                <span className="econ-cat">{CATEGORY_LABEL[c]}</span>
                <span className="econ-bar" style={{ width: `${(n / Math.max(1, rows[0]?.[1] ?? 1)) * 70}px`, background: CATEGORY_COLOR[c] }} />
                <b>{n}</b>
              </li>
            ))}
            {!rows.length && <li className="econ-none">No businesses mapped here yet — a residential area, or a gap in the map.</li>}
          </ul>
          <p className="econ-note">Coloured buildings and beacons are listed businesses. Mapped data undercounts; see the full picture on the economy page.</p>
          <a className="econ-link" href="/economy" target="_blank" rel="noopener">
            OPEN THE ECONOMY PAGE ▸
          </a>
        </div>
      )}
    </>
  )
}
