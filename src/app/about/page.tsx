import type { Metadata } from 'next'
import { SitePage } from '@/components/SitePage'
import { CITY } from '@/city/config'

export const metadata: Metadata = {
  title: `About — ${CITY.siteName}`,
  description: `What People of ${CITY.name} is, who makes it, and where its data comes from.`,
}

export default function About() {
  return (
    <SitePage kicker="ABOUT THIS PROJECT" title={`About People of ${CITY.name}`}>
      <p>
        People of {CITY.name} is a stylised 3D {CITY.fullName} that you can walk through. The streets, buildings, lakes and
        parks are generated from the real map, so Main Street is where Main Street is. Along the way you meet residents
        who chose to be here, and the local businesses that keep the town going.
      </p>
      <h2>A community project — and a Girl Scout project</h2>
      <p>
        It started as a family project: a Girl Scout&apos;s business-and-economics project about how a town&apos;s local
        economy works — which businesses are here, where they cluster, what might be missing, and why shopping local
        matters. The <a href="/economy">economy page</a> and the owner interviews come from that work. We don&apos;t
        publish any child&apos;s name, photo or personal details, and children never appear as residents.
      </p>
      <p>It&apos;s meant to grow for years: more districts, landmarks, local history, events and seasons, with schools, scouts and neighbours joining in.</p>
      <h2>The rules we keep</h2>
      <ul>
        <li>Real people appear only if they sign up and agree. Until then the town shows a few clearly labelled <b>sample</b> residents who are made up.</li>
        <li>Businesses appear from public map data with name and category only. Stories and photos come only from owners, with consent.</li>
        <li>No figures are guessed: statistics show their source and year, or a clearly marked placeholder.</li>
        <li>Not affiliated with the Town of {CITY.name}.</li>
      </ul>
      <h2>Data and credits</h2>
      <ul>
        <li>Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, available under the Open Database Licence (ODbL).</li>
        <li>Terrain: USGS 3D Elevation Program (public domain).</li>
        <li>Statistics (when filled in): US Census Bureau and Bureau of Labor Statistics (public domain).</li>
        <li>Characters: CC0 models by Quaternius. Sounds: see the credits in the source.</li>
        <li>
          Built on <a href="https://github.com/peopleofcity/peopleofcity">People of City</a>, the open foundation of People
          of Bengaluru. Our code is open source under the GNU AGPL-3.0 like theirs:{' '}
          <a href="https://github.com/sureshkrishnan-ai/people-of-shrewsbury">source code</a>.
        </li>
      </ul>
      <h2>Get involved</h2>
      <p>
        Own a business? <a href="/for-businesses">Add your story</a>. Live here? Walk in and become visible. Spotted a
        missing street or shop? Fix it on OpenStreetMap — it shows up here on the next map refresh.
      </p>
    </SitePage>
  )
}
