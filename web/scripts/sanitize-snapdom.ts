import type { Plugin } from 'vite'

const SNAPDOM_MODULE_PATH = '/@zumer/snapdom/dist/snapdom.mjs'
const EXPECTED_REMOTE_ICON_URL_COUNT = 4
const stylesheetHost = ['fonts', 'googleapis', 'com'].join('.')
const binaryHost = ['fonts', 'gstatic', 'com'].join('.')

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

const remoteIconUrlPattern = new RegExp(
  `https:\\/\\/${escapeRegExp(binaryHost)}\\/s\\/materialicons[^"']+\\.woff2`,
  'gu',
)
const remoteHostListSegment = `"${stylesheetHost}","${binaryHost}",`

function countOccurrences(source: string, token: string) {
  return source.split(token).length - 1
}

function createLineSourceMap(moduleId: string, source: string) {
  // 每行首列映射回清洗后的同一行；这样测试模式仍能调试依赖，同时不会让 sourcesContent
  // 回退到 Vite 读取的未清洗 node_modules 原文。
  const lineCount = source.split('\n').length
  const mappings = Array.from(
    { length: lineCount },
    (_, index) => index === 0 ? 'AAAA' : 'AACA',
  ).join(';')

  return {
    version: 3 as const,
    names: [],
    sources: [moduleId],
    sourcesContent: [source],
    mappings,
  }
}

/**
 * SnapDOM 2.15.0 内置了四份 Google Material Icons 字体作为截图兜底，但正式应用只使用
 * Iconify SVG。这里清空远程默认值并移除远程字体 host 白名单，同时保留
 * `window.__SNAPDOM_ICON_FONTS__`，以后如确需字体图标可显式配置项目内的本地 WOFF2。
 *
 * 两组命中数量是上游模块结构契约；升级 SnapDOM 后若结构变化，构建会失败并要求重新审计，
 * 避免远程字体地址静默回到生产 Bundle。
 */
export function sanitizeSnapdomFontSource(source: string) {
  const remoteIconUrlCount = source.match(remoteIconUrlPattern)?.length ?? 0
  const remoteHostListCount = countOccurrences(source, remoteHostListSegment)

  if (remoteIconUrlCount !== EXPECTED_REMOTE_ICON_URL_COUNT || remoteHostListCount !== 1) {
    throw new Error(
      'SnapDOM remote font contract changed: '
      + `expected ${EXPECTED_REMOTE_ICON_URL_COUNT} icon URLs and 1 host list, `
      + `received ${remoteIconUrlCount} icon URLs and ${remoteHostListCount} host lists`,
    )
  }

  const sanitizedSource = source
    .replace(remoteIconUrlPattern, '')
    .replace(remoteHostListSegment, '')

  if (sanitizedSource.includes(stylesheetHost) || sanitizedSource.includes(binaryHost)) {
    throw new Error('SnapDOM remote font contract changed: forbidden font host remains after sanitizing')
  }

  return sanitizedSource
}

export function createSnapdomFontIsolationPlugin(): Plugin {
  return {
    name: 'qsmds-snapdom-local-font-isolation',
    enforce: 'pre',
    transform(source, id) {
      const normalizedId = id.replaceAll('\\', '/').split('?', 1)[0]

      if (!normalizedId.includes(SNAPDOM_MODULE_PATH)) {
        return undefined
      }

      const sanitizedSource = sanitizeSnapdomFontSource(source)
      return {
        code: sanitizedSource,
        map: createLineSourceMap(normalizedId, sanitizedSource),
      }
    },
  }
}
