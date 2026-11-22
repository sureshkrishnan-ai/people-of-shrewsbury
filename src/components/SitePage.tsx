import Link from 'next/link'
import type { ReactNode } from 'react'
import { CITY } from '@/city/config'

/** The plain pages around the game (economy, for businesses, about): same ink-and-cream look, scrollable. */
export function SitePage({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <div className="site-page">
      <header className="site-head">
        <Link href="/" className="site-brand">
          <span className="site-brand-of">PEOPLE OF</span> {CITY.titleWord}
        </Link>
        <nav className="site-nav">
          <Link href="/">Walk the town</Link>
          <Link href="/economy">Economy</Link>
          <Link href="/for-businesses">For businesses</Link>
          <Link href="/about">About</Link>
        </nav>
      </header>
      <main className="site-main">
        <div className="site-kicker">{kicker}</div>
        <h1 className="site-title">{title}</h1>
        {children}
      </main>
      <footer className="site-foot">
        {CITY.mapCredit} · Code: AGPL-3.0, built on{' '}
        <a href="https://github.com/peopleofcity/peopleofcity" rel="noopener">
          People of City
        </a>{' '}
        · A community project, not affiliated with the Town of {CITY.name}.
      </footer>
    </div>
  )
}

/** A labelled horizontal bar list: one series, one hue, value printed at the end of each bar. */
export function Bars({ rows, unit = '' }: { rows: { label: string; value: number; note?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <table className="bars">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} title={`${r.label}: ${r.value}${unit}${r.note ? ` — ${r.note}` : ''}`}>
            <th scope="row">{r.label}</th>
            <td>
              <span className="bar" style={{ width: `${(r.value / max) * 100}%` }} />
            </td>
            <td className="bar-v">
              {r.value}
              {unit}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
