import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'

const notoSnapshotRoot = 'assets/fonts/noto/google-fonts-css2-2026-07-22/'
const notoManifestPath = `${notoSnapshotRoot}manifest.json`
const fontBinaryPattern = /\.(?:eot|otf|ttf|woff2?)$/iu
const legacyFontPathPattern = /(?:fontwithasyntaxhighlighter|digital[-_ ]?7)/iu
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.mjs',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
])
const stylesheetHost = ['fonts', 'googleapis', 'com'].join('.')
const binaryHost = ['fonts', 'gstatic', 'com'].join('.')
const contentRules = [
  {
    name: 'remote-google-font-host',
    pattern: new RegExp(`${stylesheetHost.replaceAll('.', '\\.')}|${binaryHost.replaceAll('.', '\\.')}`, 'iu'),
  },
  { name: 'legacy-syntax-font', pattern: /fontwithasyntaxhighlighter/iu },
  { name: 'legacy-digital-font', pattern: /digital[-_ ]?7/iu },
]

function normalizeRelativePath(rootDirectory, absolutePath) {
  return path.relative(rootDirectory, absolutePath).replaceAll('\\', '/')
}

function splitCompressionSuffix(relativePath) {
  if (relativePath.endsWith('.gz')) {
    return { compression: 'gzip', basePath: relativePath.slice(0, -3) }
  }
  if (relativePath.endsWith('.br')) {
    return { compression: 'brotli', basePath: relativePath.slice(0, -3) }
  }
  return { compression: null, basePath: relativePath }
}

function decodeTextBuffer(buffer, compression) {
  if (compression === 'gzip') {
    return gunzipSync(buffer).toString('utf8')
  }
  if (compression === 'brotli') {
    return brotliDecompressSync(buffer).toString('utf8')
  }
  return buffer.toString('utf8')
}

/**
 * 校验最终可发布目录，而不是只校验入口 HTML：任何 chunk、source map、JSON、SVG 及其
 * `.gz`/`.br` 压缩副本都不能重新带入远程字体 host 或旧字体。Noto 快照的 manifest 是
 * 唯一内容例外，因为它必须保留可审计的上游下载来源；其文件集与哈希由 `fonts:verify` 负责。
 */
export async function verifyFontZeroResidue(outputDirectory) {
  const rootDirectory = path.resolve(outputDirectory)
  let rootStats

  try {
    rootStats = await lstat(rootDirectory)
  }
  catch (error) {
    throw new Error(`Font zero-residue output directory is unavailable: ${rootDirectory}`, { cause: error })
  }

  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`Font zero-residue output path must be a real directory: ${rootDirectory}`)
  }

  const violations = []
  let fileCount = 0
  let fontAssetCount = 0
  let textArtifactCount = 0

  async function inspectDirectory(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = normalizeRelativePath(rootDirectory, absolutePath)
      const stats = await lstat(absolutePath)

      if (stats.isSymbolicLink()) {
        violations.push({ path: relativePath, rule: 'symbolic-link-not-allowed' })
        continue
      }
      if (stats.isDirectory()) {
        await inspectDirectory(absolutePath)
        continue
      }
      if (!stats.isFile()) {
        violations.push({ path: relativePath, rule: 'unsupported-output-entry' })
        continue
      }

      fileCount += 1
      const { basePath, compression } = splitCompressionSuffix(relativePath)

      if (legacyFontPathPattern.test(relativePath)) {
        violations.push({ path: relativePath, rule: 'legacy-font-path' })
      }

      if (fontBinaryPattern.test(basePath)) {
        fontAssetCount += 1
        if (!basePath.startsWith(notoSnapshotRoot)) {
          violations.push({ path: relativePath, rule: 'font-binary-outside-noto-snapshot' })
        }
      }

      if (!textExtensions.has(path.extname(basePath).toLowerCase()) || basePath === notoManifestPath) {
        continue
      }

      textArtifactCount += 1
      let source
      try {
        source = decodeTextBuffer(await readFile(absolutePath), compression)
      }
      catch {
        violations.push({ path: relativePath, rule: 'text-artifact-unreadable' })
        continue
      }

      for (const rule of contentRules) {
        if (rule.pattern.test(source)) {
          violations.push({ path: relativePath, rule: rule.name })
        }
      }
    }
  }

  await inspectDirectory(rootDirectory)

  if (violations.length > 0) {
    const details = violations
      .map(violation => `${violation.rule}: ${violation.path}`)
      .join('\n')
    throw new Error(`Font zero-residue verification failed (${violations.length}):\n${details}`)
  }

  return {
    fileCount,
    fontAssetCount,
    textArtifactCount,
    violationCount: 0,
  }
}
