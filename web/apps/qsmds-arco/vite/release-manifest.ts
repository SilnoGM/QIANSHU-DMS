import type { Plugin } from 'vite'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export const RELEASE_NOTE_SECTIONS = ['功能新增', '功能优化', '缺陷修复', '已知问题'] as const

export const RELEASE_NOTES_HISTORY_FILE_NAME = 'release-notes.json'

export interface ReleaseNoteSection {
  title: string
  items: string[]
}

export interface ReleaseManifest {
  version: string
  sections: ReleaseNoteSection[]
}

export interface ReleaseNotesVersion {
  version: string
  sections: ReleaseNoteSection[]
}

const STABLE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u
const RELEASE_NOTES_FILE_PATTERN = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\.md$/u
const RELEASE_NOTES_AUDIENCE_PREFIX = '本版影响角色：'

function isSectionTitle(value: string): value is typeof RELEASE_NOTE_SECTIONS[number] {
  return (RELEASE_NOTE_SECTIONS as readonly string[]).includes(value)
}

function splitStableVersion(version: string): [number, number, number] {
  const [major, minor, patch] = version.split('.').map(Number)
  return [major, minor, patch]
}

/** 历史清单按版本号倒序；字符串排序会把 1.10.0 排到 1.9.0 前面，必须逐段比较。 */
export function compareReleaseVersions(left: string, right: string): number {
  const leftParts = splitStableVersion(left)
  const rightParts = splitStableVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index]
    }
  }
  return 0
}

/**
 * Release 文案的格式由 `scripts/release-version.mjs` 在打 Tag 前强校验；
 * 这里只做展示层解析，容忍未知行，避免构建因文案排版细节直接失败。
 */
export function parseReleaseNotes(source: string): ReleaseNoteSection[] {
  const itemsBySection = new Map<string, string[]>()
  let currentSection: string[] | null = null

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (isSectionTitle(line)) {
      currentSection = []
      itemsBySection.set(line, currentSection)
      continue
    }
    if (currentSection === null || !line.startsWith('- ')) {
      continue
    }
    const item = line.slice(2).trim()
    if (item !== '' && item !== '无') {
      currentSection.push(item)
    }
  }

  return RELEASE_NOTE_SECTIONS.flatMap((title) => {
    const items = itemsBySection.get(title) ?? []
    return items.length === 0 ? [] : [{ title, items }]
  })
}

/**
 * 历史清单的容错解析：v0.4.0 至 v0.5.1 的文案分类不固定（问题修复、体验改进、对账等），
 * 严格解析会把这些版本整段丢掉。这里把任意非条目行当作分类标题，只跳过角色头行。
 * 重复的分类标题按出现顺序合并，避免同名标题覆盖前一段内容。
 */
export function parseReleaseNotesHistory(source: string): ReleaseNoteSection[] {
  const itemsBySection = new Map<string, string[]>()
  let currentSection: string[] | null = null

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith(RELEASE_NOTES_AUDIENCE_PREFIX)) {
      continue
    }
    if (line.startsWith('- ')) {
      const item = line.slice(2).trim()
      if (currentSection !== null && item !== '' && item !== '无') {
        currentSection.push(item)
      }
      continue
    }
    const existing = itemsBySection.get(line)
    currentSection = existing ?? []
    itemsBySection.set(line, currentSection)
  }

  return [...itemsBySection.entries()]
    .map(([title, items]) => ({ title, items }))
    .filter(section => section.items.length > 0)
}

export function loadReleaseManifest(input: {
  version: string
  notesDirectory: string
  warn?: (message: string) => void
}): ReleaseManifest {
  if (!STABLE_VERSION_PATTERN.test(input.version)) {
    return { version: input.version, sections: [] }
  }

  const fileName = `v${input.version}.md`
  try {
    const source = readFileSync(path.join(input.notesDirectory, fileName), 'utf8')
    return { version: input.version, sections: parseReleaseNotes(source) }
  }
  catch {
    input.warn?.(`Release notes not found: ${fileName}`)
    return { version: input.version, sections: [] }
  }
}

/** 读取 `release/notes/` 下全部稳定版本文案，按版本号倒序返回；非法文件名直接忽略。 */
export function loadReleaseNotesHistory(input: {
  notesDirectory: string
  warn?: (message: string) => void
}): ReleaseNotesVersion[] {
  let fileNames: string[]
  try {
    fileNames = readdirSync(input.notesDirectory)
  }
  catch {
    input.warn?.(`Release notes directory not found: ${input.notesDirectory}`)
    return []
  }

  const versions: ReleaseNotesVersion[] = []
  for (const fileName of fileNames) {
    const matched = fileName.match(RELEASE_NOTES_FILE_PATTERN)
    if (matched === null) {
      continue
    }
    try {
      const source = readFileSync(path.join(input.notesDirectory, fileName), 'utf8')
      const sections = parseReleaseNotesHistory(source)
      if (sections.length > 0) {
        versions.push({ version: matched[1], sections })
      }
    }
    catch {
      input.warn?.(`Release notes unreadable: ${fileName}`)
    }
  }

  return versions.sort((left, right) => compareReleaseVersions(right.version, left.version))
}

/**
 * 构建时把 `release/notes/v<version>.md` 转成两个稳定文件：
 *
 * - `/release.json`：当前版本的文案，供更新弹窗轮询，必须保持小巧；
 * - `/release-notes.json`：全部版本的历史清单，供版本更新日志页按需读取。
 *
 * 运行中的旧页面无法读取新版本的 JS 常量，只能读取这两个同源清单；因此它们必须
 * 独立于主 bundle，并由 nginx 以 no-store 提供。开发服务器直接提供同一路径，
 * 让页面在本地也能读到真实文案。
 */
export function createReleaseManifestPlugin(input: {
  version: string
  notesDirectory: string
}): Plugin {
  return {
    name: 'qsmds-release-manifest',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `/${RELEASE_NOTES_HISTORY_FILE_NAME}`) {
          next()
          return
        }
        // 开发服务器没有静态产物，按与构建时相同的规则即时生成历史清单。
        const history = loadReleaseNotesHistory({
          notesDirectory: input.notesDirectory,
          warn: message => server.config.logger.warn(message),
        })
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(`${JSON.stringify({ versions: history })}\n`)
      })
    },
    generateBundle() {
      const manifest = loadReleaseManifest({
        version: input.version,
        notesDirectory: input.notesDirectory,
        warn: message => this.warn(message),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'release.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      })
      const history = loadReleaseNotesHistory({
        notesDirectory: input.notesDirectory,
        warn: message => this.warn(message),
      })
      this.emitFile({
        type: 'asset',
        fileName: RELEASE_NOTES_HISTORY_FILE_NAME,
        source: `${JSON.stringify({ versions: history })}\n`,
      })
    },
  }
}
