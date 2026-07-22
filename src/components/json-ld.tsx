import { serializeJsonLd } from '@/lib/seo'

/**
 * schema.org JSON-LD block (docs/00 D23) — structured data for search and
 * AI crawlers. The serializer escapes `<`, so user captions can't break
 * out of the script element.
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  )
}
