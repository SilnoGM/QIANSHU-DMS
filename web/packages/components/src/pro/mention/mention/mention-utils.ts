import type {
  MentionCollisionPadding,
  MentionItemRegistration,
  MentionRange,
} from './types'

const SEPARATORS_PATTERN = /[-_\s./\\|:;,]+/g
const UNWANTED_CHARS = /[^\p{L}\p{N}\s]/gu

export function normalizeWithGaps(value: string) {
  if (!value) {
    return ''
  }

  try {
    return value
      .toLowerCase()
      .normalize('NFC')
      .replace(UNWANTED_CHARS, ' ')
      .replace(SEPARATORS_PATTERN, ' ')
      .trim()
      .replace(/\s+/g, '')
  }
  catch {
    return value
      .toLowerCase()
      .normalize('NFC')
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim()
      .replace(/\s+/g, '')
  }
}

export function filterMentionItems(
  items: MentionItemRegistration[],
  term: string,
  exactMatch: boolean,
  onFilter?: (options: string[], term: string) => string[],
) {
  const values = items.map(item => item.value)

  if (!term) {
    return values
  }

  if (onFilter) {
    return onFilter(values, term)
  }

  const normalizedTerm = normalizeWithGaps(term)

  if (!normalizedTerm) {
    return values
  }

  return items
    .filter((item) => {
      const label = normalizeWithGaps(item.label)
      const value = normalizeWithGaps(item.value)

      return exactMatch
        ? label === normalizedTerm || value === normalizedTerm
        : label.includes(normalizedTerm) || value.includes(normalizedTerm)
    })
    .map(item => item.value)
}

export function resolveCollisionPadding(
  padding?: number | MentionCollisionPadding,
) {
  if (typeof padding === 'number') {
    return {
      top: padding,
      right: padding,
      bottom: padding,
      left: padding,
    }
  }

  return {
    top: padding?.top ?? 0,
    right: padding?.right ?? 0,
    bottom: padding?.bottom ?? 0,
    left: padding?.left ?? 0,
  }
}

export function createMentionValueList(
  values: string[],
  valueToRemove: string,
) {
  return values.filter(value => value !== valueToRemove)
}

export function removeMentionRanges(
  ranges: MentionRange[],
  mentionsToRemove: MentionRange[],
) {
  const removed = [...mentionsToRemove].sort((a, b) => a.start - b.start)

  return ranges
    .filter((range) => {
      return !removed.some(item => item.value === range.value && item.start === range.start)
    })
    .map((range) => {
      const shift = removed
        .filter(item => item.start < range.start)
        .reduce((total, item) => total + (item.end - item.start + 1), 0)

      return {
        ...range,
        start: range.start - shift,
        end: range.end - shift,
      }
    })
}
