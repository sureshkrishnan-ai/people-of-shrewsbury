import type { MetadataRoute } from 'next'
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site'
import { CITY } from '@/city/config'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: CITY.name,
    description: SITE_DESCRIPTION,
    start_url: '/',
    display: 'fullscreen',
    background_color: '#1C1F2B',
    theme_color: '#1C1F2B',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  }
}
