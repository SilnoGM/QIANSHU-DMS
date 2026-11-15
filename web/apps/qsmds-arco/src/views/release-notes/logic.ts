import type { ReleaseNoteSection } from '../../components/business/QsReleaseNotesContent/logic'
import { parseReleaseNoteItem, RELEASE_AUDIENCES } from '../../components/business/QsReleaseNotesContent/logic'

export interface ReleaseNotesVersion {
  version: string
  sections: ReleaseNoteSection[]
  releasedAt?: string
}

export const RELEASE_NOTES_HISTORY_PATH = 'release-notes.json'
export const RELEASE_NOTES_REQUEST_TIMEOUT_MS = 10_000

const STABLE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u
const RELEASE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const MAX_VERSION_COUNT = 500
const MAX_SECTION_COUNT = 20
const MAX_ITEM_COUNT = 500
const MAX_ITEM_LENGTH = 2000
const SECTION_SHORT_LABELS: Record<string, string> = {
  功能新增: '新增',
  功能优化: '优化',
  缺陷修复: '修复',
  已知问题: '已知问题',
}

/** 版本号逐段比较；字符串排序会把 1.10.0 排到 1.9.0 前面。 */
export function compareReleaseVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index]
    }
  }
  return 0
}

function normalizeSections(value: unknown): ReleaseNoteSection[] {
  if (!Array.isArray(value)) {
    return []
  }
  const sections: ReleaseNoteSection[] = []
  for (const item of value.slice(0, MAX_SECTION_COUNT)) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const record = item as { title?: unknown, items?: unknown }
    if (typeof record.title !== 'string' || record.title.trim() === '' || !Array.isArray(record.items)) {
      continue
    }
    const items = record.items
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(entry => entry !== '')
      .slice(0, MAX_ITEM_COUNT)
      .map(entry => entry.slice(0, MAX_ITEM_LENGTH))
    if (items.length > 0) {
      sections.push({ title: record.title.trim().slice(0, 64), items })
    }
  }
  return sections
}

/**
 * 历史清单来自网络；只接受可安全按文本渲染的结构，并丢弃重复或非法的版本。
 * 排序在服务端已做过一次，这里再兜底一次，避免清单被改错顺序后导航错位。
 */
export function normalizeReleaseNotesHistory(value: unknown): ReleaseNotesVersion[] {
  if (typeof value !== 'object' || value === null) {
    return []
  }
  const versions = (value as { versions?: unknown }).versions
  if (!Array.isArray(versions)) {
    return []
  }
  const seen = new Set<string>()
  const normalized: ReleaseNotesVersion[] = []
  for (const item of versions.slice(0, MAX_VERSION_COUNT)) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const record = item as { version?: unknown, sections?: unknown, releasedAt?: unknown }
    if (typeof record.version !== 'string' || !STABLE_VERSION_PATTERN.test(record.version) || seen.has(record.version)) {
      continue
    }
    const sections = normalizeSections(record.sections)
    if (sections.length === 0) {
      continue
    }
    seen.add(record.version)
    normalized.push(typeof record.releasedAt === 'string' && RELEASE_DATE_PATTERN.test(record.releasedAt)
      ? { version: record.version, sections, releasedAt: record.releasedAt }
      : { version: record.version, sections })
  }
  return normalized.sort((left, right) => compareReleaseVersions(right.version, left.version))
}

/**
 * 深链版本不存在时退回最新版本：用户可能保存了已废弃的地址，页面仍要可用。
 * 同时接受带 v 前缀的查询值，方便人工手写链接。
 */
export function resolveSelectedVersion(
  versions: readonly ReleaseNotesVersion[],
  requested: string | null,
): string | null {
  if (versions.length === 0) {
    return null
  }
  if (requested !== null) {
    const candidate = requested.trim().replace(/^v/iu, '')
    if (versions.some(entry => entry.version === candidate)) {
      return candidate
    }
  }
  return versions[0].version
}

export function formatReleaseVersion(version: string): string {
  return `v${version}`
}

/** 左栏摘要：已知分类用短名，早期自定义分类保留原名，避免「对账 / 账单管理」信息丢失。 */
export function summarizeVersionSections(sections: readonly ReleaseNoteSection[]): string {
  return sections
    .map(section => `${SECTION_SHORT_LABELS[section.title] ?? section.title} ${section.items.length}`)
    .join(' · ')
}

export function collectVersionRoles(sections: readonly ReleaseNoteSection[]): string[] {
  const roles = new Set<string>()
  for (const section of sections) {
    for (const item of section.items) {
      for (const role of parseReleaseNoteItem(item).roles) {
        roles.add(role)
      }
    }
  }
  return RELEASE_AUDIENCES.filter(role => roles.has(role))
}

export function countVersionItems(sections: readonly ReleaseNoteSection[]): number {
  return sections.reduce((total, section) => total + section.items.length, 0)
}

/**
 * 历史清单跟随 Web 镜像发布，旧页面也能读取到新版本；使用 no-store + 超时，
 * 避免被浏览器缓存欺骗或在弱网下长期挂起。
 */
export async function fetchReleaseNotesHistory(signal?: AbortSignal): Promise<ReleaseNotesVersion[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}${RELEASE_NOTES_HISTORY_PATH}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) {
    throw new Error(`Release notes history unavailable: ${response.status}`)
  }
  return normalizeReleaseNotesHistory(await response.json())
}
