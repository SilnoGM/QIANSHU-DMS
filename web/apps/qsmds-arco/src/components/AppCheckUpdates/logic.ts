export interface ReleaseManifestSection {
  title: string
  items: string[]
}

export interface ReleaseManifest {
  version: string
  sections: ReleaseManifestSection[]
}

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const MAX_SECTION_COUNT = 8
const MAX_ITEM_COUNT = 200
const MAX_ITEM_LENGTH = 1000

function parseStableVersion(value: string): [number, number, number] | null {
  const match = value.match(STABLE_VERSION_PATTERN)
  if (match === null) {
    return null
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * 只在远端版本严格高于当前构建版本时提示。
 *
 * 回滚场景下远端版本会变低；此时刷新浏览器只会把用户带回更旧的 bundle，
 * 因此必须视为“没有更新”。无法解析的版本一律按不更新处理。
 */
export function isNewerVersion(remote: string, current: string): boolean {
  const remoteVersion = parseStableVersion(remote)
  const currentVersion = parseStableVersion(current)
  if (remoteVersion === null || currentVersion === null) {
    return false
  }
  for (let index = 0; index < 3; index += 1) {
    if (remoteVersion[index] !== currentVersion[index]) {
      return remoteVersion[index] > currentVersion[index]
    }
  }
  return false
}

function normalizeSection(value: unknown): ReleaseManifestSection | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as { title?: unknown, items?: unknown }
  if (typeof record.title !== 'string' || record.title.trim() === '' || !Array.isArray(record.items)) {
    return null
  }
  const items = record.items
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item !== '')
    .slice(0, MAX_ITEM_COUNT)
    .map(item => item.slice(0, MAX_ITEM_LENGTH))
  return items.length === 0 ? null : { title: record.title.trim().slice(0, 64), items }
}

/** 发布清单来自网络；只接受可安全按文本渲染的结构，拒绝任意 HTML 或超长内容。 */
export function normalizeReleaseManifest(value: unknown): ReleaseManifest | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as { version?: unknown, sections?: unknown }
  if (typeof record.version !== 'string' || !STABLE_VERSION_PATTERN.test(record.version) || !Array.isArray(record.sections)) {
    return null
  }
  const sections = record.sections
    .map(normalizeSection)
    .filter((section): section is ReleaseManifestSection => section !== null)
    .slice(0, MAX_SECTION_COUNT)
  return { version: record.version, sections }
}
