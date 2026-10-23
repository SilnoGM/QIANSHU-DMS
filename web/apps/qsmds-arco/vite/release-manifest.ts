import type { Plugin } from 'vite'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const RELEASE_NOTE_SECTIONS = ['功能新增', '功能优化', '缺陷修复', '已知问题'] as const

export interface ReleaseNoteSection {
  title: string
  items: string[]
}

export interface ReleaseManifest {
  version: string
  sections: ReleaseNoteSection[]
}

const STABLE_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u

function isSectionTitle(value: string): value is typeof RELEASE_NOTE_SECTIONS[number] {
  return (RELEASE_NOTE_SECTIONS as readonly string[]).includes(value)
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

/**
 * 构建时把 `release/notes/v<version>.md` 转成稳定的 `/release.json`。
 *
 * 运行中的旧页面无法读取新版本的 JS 常量，只能读取这个同源清单；因此它必须
 * 独立于主 bundle，并由 nginx 以 no-store 提供。
 */
export function createReleaseManifestPlugin(input: {
  version: string
  notesDirectory: string
}): Plugin {
  return {
    name: 'qsmds-release-manifest',
    apply: 'build',
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
    },
  }
}
