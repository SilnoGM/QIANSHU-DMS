export interface ReleaseNoteSection {
  title: string
  items: string[]
}

export interface ReleaseNoteItem {
  readonly roles: readonly string[]
  readonly text: string
}

const RELEASE_ITEM_PATTERN = /^【([^】]+)】(.*)$/u

/** Release 文案的角色前缀只用于展示，正文仍保持纯文本渲染。 */
export function parseReleaseNoteItem(item: string): ReleaseNoteItem {
  const normalized = item.trim()
  const match = normalized.match(RELEASE_ITEM_PATTERN)
  if (match === null) {
    return { roles: [], text: normalized }
  }
  const roles = [...new Set(match[1].split('、').map(role => role.trim()).filter(Boolean))]
  return { roles, text: match[2].trim() }
}
