'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CATEGORIES, CATEGORY_LABEL, businessById } from '@/city/businesses'

/** Owner form → public.businesses (pending until a reviewer approves). Needs Supabase and a signed-in owner. */
export function BusinessForm({ osmId, consentVersion }: { osmId: string; consentVersion: string }) {
  const listed = osmId ? businessById(osmId) : undefined
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | string>('idle')
  useEffect(() => {
    if (!supabase) return setSignedIn(false)
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user))
  }, [])
  if (!supabase)
    return (
      <div className="site-card">
        The listing form isn&apos;t switched on for this copy of the site yet (no database connected). Meanwhile, the
        maintainers can add a listing by hand — see <code>docs/MAINTAINING.md</code>.
      </div>
    )
  if (signedIn === false)
    return (
      <div className="site-card">
        Please <a href="/">sign in from the game</a> first (press L), then come back to this page.
      </div>
    )
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    if (f.get('consent') !== 'on') return setState('Please tick the consent box.')
    setState('sending')
    const { data } = await supabase!.auth.getUser()
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null)
    const { error } = await supabase!.from('businesses').insert({
      owner_id: data.user?.id,
      osm_id: osmId || null,
      name: String(f.get('name') ?? '').trim(),
      category: f.get('category'),
      address: String(f.get('address') ?? '').trim() || null,
      website: String(f.get('website') ?? '').trim() || null,
      story: String(f.get('story') ?? '').trim() || null,
      owner_name: String(f.get('owner_name') ?? '').trim() || null,
      year_founded: num('year_founded'),
      jobs: num('jobs'),
      consent_version: consentVersion,
    })
    setState(error ? `Couldn't save: ${error.message}` : 'sent')
  }
  if (state === 'sent') return <div className="site-card">Thank you! A volunteer will review your listing soon.</div>
  return (
    <form className="site-card biz-form" onSubmit={submit}>
      <label>Business name<input name="name" required minLength={2} maxLength={80} defaultValue={listed?.name ?? ''} /></label>
      <label>
        Category
        <select name="category" defaultValue={listed?.category ?? 'retail'}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
      </label>
      <label>Address<input name="address" maxLength={120} defaultValue={listed?.addr ?? ''} /></label>
      <label>Website (https://…)<input name="website" type="url" pattern="https://.*" maxLength={200} defaultValue={listed?.website ?? ''} /></label>
      <label>Your story (up to 1200 characters)<textarea name="story" maxLength={1200} rows={6} /></label>
      <label>Year founded<input name="year_founded" type="number" min={1700} max={2100} /></label>
      <label>Local jobs (optional)<input name="jobs" type="number" min={0} /></label>
      <label>Your name, if you want it shown (optional)<input name="owner_name" maxLength={60} /></label>
      <p className="site-note">Photos: after review, the maintainers will ask you for them directly (upload comes in a later version).</p>
      <label className="biz-consent"><input type="checkbox" name="consent" /> I am the owner or authorised by the owner, and I agree to the text above (version {consentVersion}).</label>
      <button className="btn-primary slant" type="submit" disabled={state === 'sending'}><span className="unslant">SEND FOR REVIEW ▸</span></button>
      {state !== 'idle' && state !== 'sending' && <p className="site-note">{state}</p>}
    </form>
  )
}
