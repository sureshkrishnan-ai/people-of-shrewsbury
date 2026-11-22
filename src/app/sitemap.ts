import type { MetadataRoute } from 'next'
import { IS_PRODUCTION, SITE_URL } from '@/lib/site'

// The town is one page; people live inside it. The economy / business / about pages are plain pages.
export default function sitemap(): MetadataRoute.Sitemap {
  if (!IS_PRODUCTION) return []
  return [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1 },
    ...['economy', 'for-businesses', 'about'].map((p) => ({ url: `${SITE_URL}/${p}`, changeFrequency: 'weekly' as const, priority: 0.6 })),
  ]
}
