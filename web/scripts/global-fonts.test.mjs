import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 Node.js 内置 test runner 直接运行。
import test from 'node:test'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = fileURLToPath(new URL('../', import.meta.url))

function readWebFile(relativePath) {
  return readFileSync(join(webRoot, relativePath), 'utf8')
}

const appHtml = readWebFile('apps/qsmds-arco/index.html')
const loadingTemplate = readWebFile('apps/qsmds-arco/loading.html')
const globalStyles = readWebFile('apps/qsmds-arco/src/assets/styles/globals.css')
const browserUpgradeStyles = readWebFile('apps/qsmds-arco/public/browser_upgrade/index.css')
const tableSource = readWebFile('apps/qsmds-arco/src/components/business/QsGenericTable/index.vue')
const codeComponentSource = readWebFile('packages/components/src/pro/code/index.vue')
const copyrightSource = readWebFile('packages/copyright/index.ts')
const unoConfig = readWebFile('uno.config.ts')

const sansFontStylesheet = '/assets/fonts/noto/google-fonts-css2-2026-07-22/noto-sans-sc/fonts.css'
const monoFontStylesheet = '/assets/fonts/noto/google-fonts-css2-2026-07-22/noto-sans-mono/fonts.css'
const nativeEmojiFamilies = [
  'Apple Color Emoji',
  'Segoe UI Emoji',
  'Noto Color Emoji',
]
const allowedFontFamilies = new Set([
  'Noto Sans SC',
  'Noto Sans Mono',
  ...nativeEmojiFamilies,
])
const runtimeSourceExtensions = new Set(['.css', '.html', '.scss', '.ts', '.vue'])
const controlledFontAssetRoots = [
  'apps/qsmds-arco',
  'packages',
]
const notoSnapshotRoot = 'apps/qsmds-arco/public/assets/fonts/noto/google-fonts-css2-2026-07-22/'
const fontBinaryPattern = /\.(?:eot|otf|ttf|woff2?)$/iu
const legacyFontPathPattern = /(?:fontwithasyntaxhighlighter|digital[-_ ]?7)/iu

function normalizeWebRelativePath(absolutePath) {
  return relative(webRoot, absolutePath).replaceAll('\\', '/')
}

function collectFiles(rootPath) {
  const files = []

  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const absolutePath = join(rootPath, entry.name)

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('dist-')) {
        continue
      }
      files.push(...collectFiles(absolutePath))
    }
    else if (entry.isFile()) {
      files.push(absolutePath)
    }
  }

  return files
}

function collectRuntimeSourceFiles(rootPath) {
  const files = []

  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const absolutePath = join(rootPath, entry.name)
    const webRelativePath = relative(webRoot, absolutePath)

    if (entry.isDirectory()) {
      if (
        entry.name === 'dist'
        || entry.name === 'node_modules'
        || webRelativePath.includes('apps/qsmds-arco/src/assets/fonts')
        || webRelativePath.includes('apps/qsmds-arco/public/assets/fonts')
      ) {
        continue
      }
      files.push(...collectRuntimeSourceFiles(absolutePath))
      continue
    }

    if (runtimeSourceExtensions.has(extname(entry.name))) {
      files.push(absolutePath)
    }
  }

  return files
}

function assertAllowedFontFamilyDeclarations(absolutePath) {
  const source = readFileSync(absolutePath, 'utf8')
  const relativePath = relative(webRoot, absolutePath)

  for (const declaration of source.matchAll(/font-family\s*:\s*([^;}\n]+)/giu)) {
    const value = declaration[1]
    const quotedFamilies = [...value.matchAll(/["']([^"']+)["']/gu)]

    for (const [, family] of quotedFamilies) {
      assert.ok(
        allowedFontFamilies.has(family),
        `${relativePath} 声明了未允许的字体家族：${family}`,
      )
    }

    const remainingValue = value
      .replace(/["'](?:Noto Sans SC|Noto Sans Mono|Apple Color Emoji|Segoe UI Emoji|Noto Color Emoji)["']/gu, '')
      .replace(/var\(--qs-font-(?:sans|mono)\)/gu, '')
      .replace(/\binherit\b/gu, '')
      .replace(/[\s,\\]/gu, '')

    assert.equal(
      remainingValue,
      '',
      `${relativePath} 的 font-family 包含未允许的回退：${value.trim()}`,
    )
  }
}

test('正式应用在首屏样式之前注册两份本地 Noto 字体 CSS', () => {
  const sansIndex = appHtml.indexOf(sansFontStylesheet)
  const monoIndex = appHtml.indexOf(monoFontStylesheet)
  const browserUpgradeIndex = appHtml.indexOf('/browser_upgrade/index.css')

  assert.ok(sansIndex >= 0)
  assert.ok(monoIndex > sansIndex)
  assert.ok(browserUpgradeIndex > monoIndex)
  assert.doesNotMatch(appHtml, /fonts\.(?:googleapis|gstatic)\.com/iu)
})

test('全局 Token 只组合 Noto Sans、Noto Mono 与原生 Emoji 例外', () => {
  assert.match(globalStyles, /--qs-font-text-sans:\s*"Noto Sans SC";/u)
  assert.match(globalStyles, /--qs-font-text-mono:\s*"Noto Sans Mono",\s*"Noto Sans SC";/u)
  assert.match(
    globalStyles,
    /--qs-font-native-emoji:\s*"Apple Color Emoji",\s*"Segoe UI Emoji",\s*"Noto Color Emoji";/u,
  )
  assert.match(
    globalStyles,
    /--qs-font-sans:\s*var\(--qs-font-text-sans\),\s*var\(--qs-font-native-emoji\);/u,
  )
  assert.match(
    globalStyles,
    /--qs-font-mono:\s*var\(--qs-font-text-mono\),\s*var\(--qs-font-native-emoji\);/u,
  )
  assert.match(globalStyles, /font-synthesis:\s*none/u)
  assert.match(globalStyles, /body[\s\S]*?font-family:\s*var\(--qs-font-sans\)/u)
  assert.match(globalStyles, /button,[\s\S]*?textarea[\s\S]*?font-family:\s*var\(--qs-font-sans\)/u)
  assert.match(globalStyles, /code,[\s\S]*?samp[\s\S]*?font-family:\s*var\(--qs-font-mono\)/u)
  assert.match(globalStyles, /\.font-qs-data-mono\s*\{[\s\S]*?font-family:\s*var\(--qs-font-mono\);/u)
})

test('Sonner Toast 以高于依赖默认规则的选择器消费全局 Sans Token', () => {
  assert.match(
    globalStyles,
    /html\s+\[data-sonner-toaster\]\s*\{[^}]*font-family:\s*var\(--qs-font-sans\);[^}]*\}/u,
  )
})

test('UnoCSS 的 font-sans 与 font-mono 映射到产品字体 Token', () => {
  assert.match(
    unoConfig,
    /font:\s*\{[\s\S]*?sans:\s*'var\(--qs-font-sans\)'[\s\S]*?mono:\s*'var\(--qs-font-mono\)'/u,
  )
})

test('Vue 生效前的 Loading 与浏览器升级页使用同一显式 Sans 栈', () => {
  const explicitSansStack = /"Noto Sans SC",\s*"Apple Color Emoji",\s*"Segoe UI Emoji",\s*"Noto Color Emoji"/u

  assert.match(loadingTemplate, explicitSansStack)
  assert.match(browserUpgradeStyles, explicitSansStack)
})

test('业务表格与公共组件只消费全局 Sans 或 Mono Token', () => {
  // 业务表格继承应用根字体，局部重复声明会重新制造组件级字体真相源。
  assert.doesNotMatch(tableSource, /font-family\s*:/u)
  assert.doesNotMatch(tableSource, /--qs-table-font-family|--qs-font-data-mono/u)

  assert.match(codeComponentSource, /font-family:\s*var\(--qs-font-mono\);/u)
  assert.doesNotMatch(codeComponentSource, /@font-face|FontWithASyntaxHighlighter|\bmonospace\b/u)

  assert.match(
    copyrightSource,
    /font-family:\s*\\?"Noto Sans Mono\\?",\s*\\?"Noto Sans SC\\?",\s*\\?"Apple Color Emoji\\?",\s*\\?"Segoe UI Emoji\\?",\s*\\?"Noto Color Emoji\\?";/u,
  )
})

test('项目自有正式运行时代码不再声明其他正文或等宽字体', () => {
  const runtimeFiles = [
    join(webRoot, 'apps/qsmds-arco/index.html'),
    join(webRoot, 'apps/qsmds-arco/loading.html'),
    join(webRoot, 'apps/qsmds-arco/public/browser_upgrade/index.css'),
    ...collectRuntimeSourceFiles(join(webRoot, 'apps/qsmds-arco/src')),
    ...collectRuntimeSourceFiles(join(webRoot, 'packages/components/src')),
    join(webRoot, 'packages/copyright/index.ts'),
  ]

  for (const runtimeFile of runtimeFiles) {
    assertAllowedFontFamilyDeclarations(runtimeFile)
  }
})

test('正式应用与共享包物理上只保留固定 Noto 字体快照', () => {
  // `web/examples` 是上游参考应用，用户已明确要求保留；守卫覆盖整个正式应用与共享包，
  // 只排除依赖目录和可重复生成的 dist*，避免旧字体藏到 src/public 之外。
  const controlledFiles = controlledFontAssetRoots.flatMap(root => collectFiles(join(webRoot, root)))
  const residues = controlledFiles
    .map(normalizeWebRelativePath)
    .filter((relativePath) => {
      if (legacyFontPathPattern.test(relativePath)) {
        return true
      }
      return fontBinaryPattern.test(relativePath) && !relativePath.startsWith(notoSnapshotRoot)
    })
    .sort()

  assert.equal(
    residues.length,
    0,
    `正式应用或共享包仍存在非 Noto 字体资产：\n${residues.join('\n')}`,
  )
})
