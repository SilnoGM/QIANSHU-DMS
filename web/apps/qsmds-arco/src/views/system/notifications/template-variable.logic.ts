const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/gu

/** 从正文、标题和跳转链接中提取占位符，按首次出现顺序去重。 */
export function extractTemplatePlaceholders(
  ...texts: Array<string | null | undefined>
): string[] {
  const names = new Set<string>()
  for (const text of texts) {
    if (typeof text !== 'string') {
      continue
    }
    for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
      if (match[1] !== undefined) {
        names.add(match[1])
      }
    }
  }
  return [...names]
}

/** 在光标位置插入文本；没有有效选区时追加到末尾。 */
export function insertTextAtSelection(
  value: string,
  inserted: string,
  start: number | null,
  end: number | null,
): { cursor: number, value: string } {
  const safeStart = start === null || !Number.isInteger(start) || start < 0 || start > value.length
    ? value.length
    : start
  const safeEnd = end === null || !Number.isInteger(end) || end < safeStart || end > value.length
    ? safeStart
    : end
  return {
    cursor: safeStart + inserted.length,
    value: `${value.slice(0, safeStart)}${inserted}${value.slice(safeEnd)}`,
  }
}
