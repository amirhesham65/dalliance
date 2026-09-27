import { cardAlt, cardSize, socialCard } from '@/lib/card'

export const alt = cardAlt
export const size = cardSize
export const contentType = 'image/png'

export default function Image() {
  return socialCard()
}
