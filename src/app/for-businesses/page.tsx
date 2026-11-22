import type { Metadata } from 'next'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SitePage } from '@/components/SitePage'
import { CITY } from '@/city/config'
import { BusinessForm } from './BusinessForm'

export const metadata: Metadata = {
  title: `For businesses — ${CITY.siteName}`,
  description: `Get your ${CITY.name} business listed in the 3D town, with your own story and photos.`,
}

const consent = readFileSync(join(process.cwd(), 'docs/consent/business-v1.md'), 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('>'))
  .map((l) => l.replace(/^>\s?/, ''))
  .join('\n')
  .trim()

export default async function ForBusinesses({ searchParams }: { searchParams: Promise<{ listing?: string }> }) {
  const { listing } = await searchParams
  return (
    <SitePage kicker="FOR LOCAL BUSINESSES" title="Get your business on the map">
      <p>
        People of {CITY.name} is a free, non-commercial community map of the town in 3D. Businesses already on OpenStreetMap
        appear with their name and a sign — but <b>no story</b> until the owner adds one. We never invent stories or copy
        photos from the web.
      </p>
      <h2>How to be listed</h2>
      <ol>
        <li>Find your sign in the 3D town (or skip this if you aren&apos;t on the map yet).</li>
        <li>Sign in from the game (press L, or tap SIGN IN) with your email.</li>
        <li>Fill in the form below: a short story, year founded, website, optionally jobs and up to six of your own photos.</li>
        <li>A volunteer checks it (usually within a week) and it goes live. You can edit or remove it any time.</li>
      </ol>
      <p className="site-note">
        Not on OpenStreetMap at all? Add your business at <a href="https://www.openstreetmap.org">openstreetmap.org</a> (it
        helps every map app), or tell us in the form and we&apos;ll place it on the next map refresh.
      </p>
      <h2>What you agree to</h2>
      <pre>{consent}</pre>
      <h2>Your listing</h2>
      <BusinessForm osmId={listing ?? ''} consentVersion="business-v1" />
      <h2>Interviews</h2>
      <p>
        Students in the project may ask to interview you about running a local business. Saying no is completely fine. The
        questions they use are public: <a href="https://github.com/sureshkrishnan-ai/people-of-shrewsbury/blob/shrewsbury/docs/business-interview-template.md">owner interview template</a>.
      </p>
    </SitePage>
  )
}
