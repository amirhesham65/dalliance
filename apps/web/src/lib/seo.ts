import { createElement } from 'react'
import { site } from './site'

/** Who publishes the site, for structured data. The logo is the mark from `apple-icon.tsx`, a 180px PNG */
export const publisher = {
  '@type': 'Organization',
  '@id': `${site.url}/#publisher`,
  name: site.name,
  url: `${site.url}/`,
  logo: { '@type': 'ImageObject', url: `${site.url}/apple-icon`, width: 180, height: 180 },
  founder: { '@type': 'Person', name: site.author },
}

/** Structured data as a script tag. `<` is escaped so text in the data can never close the tag */
export function jsonLdScript(data: object) {
  return createElement('script', {
    type: 'application/ld+json',
    dangerouslySetInnerHTML: { __html: JSON.stringify(data).replace(/</g, '\\u003c') },
  })
}
