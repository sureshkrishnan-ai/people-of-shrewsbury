import { describe, expect, it } from 'vitest'
import { BOUNDS, ROOM_DISTRICTS } from '@shared/net/config'
import { CITY, cityHour } from './config'

describe('city config', () => {
  it('lists the same districts as the live-city rooms', () => {
    expect([...ROOM_DISTRICTS].sort()).toEqual(CITY.districts.map((d) => d.id).sort())
  })
  it('keeps every district inside the movement bounds', () => {
    for (const d of CITY.districts) expect(d.half).toBeLessThan(BOUNDS)
  })
  it('has a default district', () => {
    expect(CITY.districts.some((d) => d.id === CITY.defaultDistrict)).toBe(true)
  })
  it('follows daylight saving', () => {
    // 4 July 2026 16:00 UTC = 12:00 EDT; 4 Jan 2026 17:00 UTC = 12:00 EST
    expect(Math.round(cityHour(Date.UTC(2026, 6, 4, 16, 0)))).toBe(12)
    expect(Math.round(cityHour(Date.UTC(2026, 0, 4, 17, 0)))).toBe(12)
  })
})
