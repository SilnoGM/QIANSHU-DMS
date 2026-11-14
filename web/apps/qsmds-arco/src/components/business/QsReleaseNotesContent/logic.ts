export interface ReleaseNoteSection {
  title: string
  items: string[]
}

export interface ReleaseNoteItem {
  readonly roles: readonly string[]
  readonly text: string
}

export interface ReleaseSectionAudience {
  readonly commonRoles: readonly string[] | null
  readonly showItemRoles: boolean
}

export const RELEASE_AUDIENCES = [
  '运营人员',
  '财务人员',
  '采运人员',
  '系统管理员',
] as const

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

/** 四个内置角色齐全时不再逐条重复标注适用范围。 */
export function isAllReleaseAudience(roles: readonly string[]): boolean {
  return RELEASE_AUDIENCES.every(role => roles.includes(role))
}

/**
 * 同一分类的角色完全一致时在分类头展示一次；混合角色时逐条展示；
 * 无角色前缀或覆盖全部角色时不展示。
 */
export function resolveReleaseSectionAudience(
  items: readonly ReleaseNoteItem[],
): ReleaseSectionAudience {
  const roleSets = items.map(item => item.roles).filter(roles => roles.length > 0)
  if (roleSets.length === 0) {
    return { commonRoles: null, showItemRoles: false }
  }
  const [first, ...rest] = roleSets
  const shareRoles = rest.every(roles => (
    roles.length === first.length
    && roles.every(role => first.includes(role))
  )) && roleSets.length === items.length
  if (!shareRoles) {
    return { commonRoles: null, showItemRoles: true }
  }
  return {
    commonRoles: isAllReleaseAudience(first) ? null : first,
    showItemRoles: false,
  }
}
