'use client'

import dynamic from 'next/dynamic'
import { CITY } from '@/city/config'

// WebGL world is client-only. Until it loads, the boot screen shows the intro's title in the same spot,
// so it reads as one screen; it's also the page's text for search engines (the game itself is a canvas).
const Game = dynamic(() => import('@/game/Game'), {
  ssr: false,
  loading: () => (
    <div className="boot">
      <div className="intro-title">
        <div className="intro-kicker">PEOPLE OF</div>
        <h1>{CITY.titleWord}</h1>
        <p>{CITY.tagline}</p>
      </div>
    </div>
  ),
})

export default function GameClient() {
  return <Game />
}
