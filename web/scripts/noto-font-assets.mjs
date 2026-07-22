import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(scriptsDirectory, '..')

export const NOTO_FONT_RELEASE_ID = 'google-fonts-css2-2026-07-22'
export const NOTO_FONT_CAPTURE_DATE = '2026-07-22'
export const NOTO_FONT_USER_AGENT = 'Mozilla/5.0 AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
export const DEFAULT_NOTO_FONT_RELEASE_DIRECTORY = path.join(
  webRoot,
  'apps/qsmds-arco/public/assets/fonts/noto',
  NOTO_FONT_RELEASE_ID,
)

export const NOTO_FONT_FAMILIES = Object.freeze([
  Object.freeze({
    cssUrl: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300..700&display=block',
    expectedShardCount: 101,
    family: 'Noto Sans SC',
    fontStretch: null,
    fontStyle: 'normal',
    fontWeight: '300 700',
    id: 'noto-sans-sc',
    licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt',
    officialRepositoryUrl: 'https://github.com/google/fonts/tree/main/ofl/notosanssc',
  }),
  Object.freeze({
    cssUrl: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Mono:wdth,wght@100,400..700&display=block',
    expectedShardCount: 7,
    family: 'Noto Sans Mono',
    fontStretch: '100%',
    fontStyle: 'normal',
    fontWeight: '400 700',
    id: 'noto-sans-mono',
    licenseUrl: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansmono/OFL.txt',
    officialRepositoryUrl: 'https://github.com/google/fonts/tree/main/ofl/notosansmono',
  }),
])

const FONT_FACE_PATTERN = /@font-face\s*\{([\s\S]*?)\}/gu
const REMOTE_WOFF2_PATTERN = /url\(\s*(['"]?)(https:\/\/fonts\.gstatic\.com\/[^)'"]+\.woff2)\1\s*\)/u
const LOCAL_WOFF2_PATTERN = /url\(\s*(['"]?)(\.\/[^)'"]+\.woff2)\1\s*\)/u
const GOOGLE_FONT_ENDPOINT_PATTERN = /https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com)/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function readCssDeclaration(block, property, { required = true } = {}) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = block.match(new RegExp(`${escapedProperty}\\s*:\\s*([^;]+);`, 'u'))
  if (!match) {
    if (!required) {
      return null
    }
    throw new Error(`Google Fonts CSS is missing ${property}`)
  }
  return match[1].trim()
}

function unquoteCssValue(value) {
  if (
    value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\'')))
  ) {
    return value.slice(1, -1)
  }
  return value
}

export function normalizeLicenseText(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Font license must be text')
  }

  // 授权正文保持原样，仅统一换行并移除行尾空白，避免上游格式噪音破坏仓库检查。
  return `${text.replace(/\r\n?/gu, '\n').replace(/[\t ]+$/gmu, '').trimEnd()}\n`
}

function parseFontFaceBlocks(css, urlPattern, urlField) {
  if (typeof css !== 'string' || css.trim() === '') {
    throw new Error('Google Fonts CSS must be non-empty text')
  }

  const fontFaces = []
  for (const match of css.matchAll(FONT_FACE_PATTERN)) {
    const block = match[1]
    const urlMatch = block.match(urlPattern)
    if (!urlMatch) {
      throw new Error('Google Fonts CSS contains an unsupported font source')
    }

    fontFaces.push({
      family: unquoteCssValue(readCssDeclaration(block, 'font-family')),
      fontDisplay: readCssDeclaration(block, 'font-display'),
      fontStretch: readCssDeclaration(block, 'font-stretch', { required: false }),
      fontStyle: readCssDeclaration(block, 'font-style'),
      fontWeight: readCssDeclaration(block, 'font-weight'),
      [urlField]: urlMatch[2],
      unicodeRange: readCssDeclaration(block, 'unicode-range'),
    })
  }

  if (fontFaces.length === 0) {
    throw new Error('Google Fonts CSS does not contain any @font-face rule')
  }
  return fontFaces
}

export function parseGoogleFontsCss(css) {
  const fontFaces = parseFontFaceBlocks(css, REMOTE_WOFF2_PATTERN, 'remoteUrl')
  const uniqueUrls = new Set(fontFaces.map(fontFace => fontFace.remoteUrl))
  if (uniqueUrls.size !== fontFaces.length) {
    throw new Error('Google Fonts CSS contains duplicate WOFF2 URLs')
  }
  return fontFaces
}

function parseLocalizedFontsCss(css) {
  return parseFontFaceBlocks(css, LOCAL_WOFF2_PATTERN, 'localUrl')
}

export function localizeGoogleFontsCss(css, localUrlByRemoteUrl) {
  if (!(localUrlByRemoteUrl instanceof Map)) {
    throw new TypeError('Font URL mapping must be a Map')
  }

  let localizedCss = css
  for (const fontFace of parseGoogleFontsCss(css)) {
    const localUrl = localUrlByRemoteUrl.get(fontFace.remoteUrl)
    if (typeof localUrl !== 'string' || !localUrl.startsWith('./') || !localUrl.endsWith('.woff2')) {
      throw new Error(`Missing local WOFF2 mapping for ${fontFace.remoteUrl}`)
    }
    localizedCss = localizedCss.replaceAll(fontFace.remoteUrl, localUrl)
  }

  if (GOOGLE_FONT_ENDPOINT_PATTERN.test(localizedCss)) {
    throw new Error('Localized font CSS still contains a Google Fonts endpoint')
  }
  return localizedCss
}

export function assertWoff2Buffer(buffer, source = 'font buffer') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 4).toString('ascii') !== 'wOF2') {
    throw new Error(`${source} has an invalid WOFF2 magic`)
  }
}

async function pathExists(targetPath) {
  try {
    await lstat(targetPath)
    return true
  }
  catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function readRequiredRegularFile(filePath) {
  const stats = await lstat(filePath)
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Font snapshot entry must be a regular file: ${filePath}`)
  }
  return readFile(filePath)
}

async function fetchBuffer(url, fetchImplementation) {
  const response = await fetchImplementation(url, {
    headers: {
      'User-Agent': NOTO_FONT_USER_AGENT,
    },
    redirect: 'follow',
  })
  if (!response.ok) {
    throw new Error(`Font download failed with HTTP ${response.status}: ${url}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function mapInBatches(items, batchSize, mapper) {
  const results = []
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize)
    results.push(...await Promise.all(batch.map((item, offset) => mapper(item, start + offset))))
  }
  return results
}

async function listSnapshotFiles(rootDirectory, currentDirectory = rootDirectory) {
  const relativeFiles = []
  const entries = await readdir(currentDirectory, { withFileTypes: true })
  for (const entry of entries) {
    const absolutePath = path.join(currentDirectory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`Font snapshot cannot contain a symbolic link: ${absolutePath}`)
    }
    if (entry.isDirectory()) {
      relativeFiles.push(...await listSnapshotFiles(rootDirectory, absolutePath))
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`Font snapshot contains an unsupported entry: ${absolutePath}`)
    }
    relativeFiles.push(path.relative(rootDirectory, absolutePath).split(path.sep).join('/'))
  }
  return relativeFiles.sort()
}

function resolveSnapshotPath(rootDirectory, relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath === ''
    || path.posix.isAbsolute(relativePath)
    || relativePath.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Font snapshot contains an invalid relative path: ${relativePath}`)
  }

  const absoluteRoot = path.resolve(rootDirectory)
  const absolutePath = path.resolve(absoluteRoot, ...relativePath.split('/'))
  if (!absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`Font snapshot path escapes its root: ${relativePath}`)
  }
  return absolutePath
}

async function writeChecksumFile(rootDirectory) {
  const relativeFiles = (await listSnapshotFiles(rootDirectory))
    .filter(relativePath => relativePath !== 'SHA256SUMS')
  const checksumLines = []
  for (const relativePath of relativeFiles) {
    const buffer = await readRequiredRegularFile(resolveSnapshotPath(rootDirectory, relativePath))
    checksumLines.push(`${sha256(buffer)}  ${relativePath}`)
  }
  await writeFile(path.join(rootDirectory, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`, { flag: 'wx' })
}

function assertFontFaceMatchesConfiguration(fontFace, familyConfiguration) {
  if (
    fontFace.family !== familyConfiguration.family
    || fontFace.fontDisplay !== 'block'
    || fontFace.fontStyle !== familyConfiguration.fontStyle
    || fontFace.fontWeight !== familyConfiguration.fontWeight
    || fontFace.fontStretch !== familyConfiguration.fontStretch
  ) {
    throw new Error(`Unexpected Google Fonts face metadata for ${familyConfiguration.family}`)
  }
}

export async function downloadNotoFontSnapshot({
  destinationDirectory = DEFAULT_NOTO_FONT_RELEASE_DIRECTORY,
  fetchImplementation = globalThis.fetch,
} = {}) {
  if (typeof fetchImplementation !== 'function') {
    throw new TypeError('A fetch implementation is required to download fonts')
  }

  const absoluteDestination = path.resolve(destinationDirectory)
  if (await pathExists(absoluteDestination)) {
    throw new Error(`Font snapshot destination already exists: ${absoluteDestination}`)
  }

  const parentDirectory = path.dirname(absoluteDestination)
  const temporaryDirectory = path.join(
    parentDirectory,
    `.${path.basename(absoluteDestination)}.tmp-${process.pid}`,
  )
  if (await pathExists(temporaryDirectory)) {
    throw new Error(`Font snapshot temporary directory already exists: ${temporaryDirectory}`)
  }

  await mkdir(parentDirectory, { recursive: true })
  await mkdir(temporaryDirectory)
  let completed = false

  try {
    const familyManifests = []
    for (const familyConfiguration of NOTO_FONT_FAMILIES) {
      const familyDirectory = path.join(temporaryDirectory, familyConfiguration.id)
      await mkdir(familyDirectory)

      const remoteCssBuffer = await fetchBuffer(familyConfiguration.cssUrl, fetchImplementation)
      const remoteCss = remoteCssBuffer.toString('utf8')
      const fontFaces = parseGoogleFontsCss(remoteCss)
      if (fontFaces.length !== familyConfiguration.expectedShardCount) {
        throw new Error(
          `${familyConfiguration.family} returned ${fontFaces.length} shards; expected ${familyConfiguration.expectedShardCount}`,
        )
      }
      fontFaces.forEach(fontFace => assertFontFaceMatchesConfiguration(fontFace, familyConfiguration))

      const downloadedFaces = await mapInBatches(fontFaces, 8, async (fontFace, index) => {
        const buffer = await fetchBuffer(fontFace.remoteUrl, fetchImplementation)
        assertWoff2Buffer(buffer, fontFace.remoteUrl)
        const digest = sha256(buffer)
        const fileName = `${familyConfiguration.id}-${String(index + 1).padStart(3, '0')}-${digest.slice(0, 12)}.woff2`
        await writeFile(path.join(familyDirectory, fileName), buffer, { flag: 'wx' })
        return {
          bytes: buffer.length,
          file: `${familyConfiguration.id}/${fileName}`,
          fontDisplay: fontFace.fontDisplay,
          fontStretch: fontFace.fontStretch,
          fontStyle: fontFace.fontStyle,
          fontWeight: fontFace.fontWeight,
          remoteUrl: fontFace.remoteUrl,
          sha256: digest,
          unicodeRange: fontFace.unicodeRange,
        }
      })

      const localUrlByRemoteUrl = new Map(downloadedFaces.map(fontFace => [
        fontFace.remoteUrl,
        `./${path.posix.basename(fontFace.file)}`,
      ]))
      const localizedCss = `${localizeGoogleFontsCss(remoteCss, localUrlByRemoteUrl).trim()}\n`
      const cssRelativePath = `${familyConfiguration.id}/fonts.css`
      await writeFile(
        path.join(familyDirectory, 'fonts.css'),
        localizedCss,
        { encoding: 'utf8', flag: 'wx' },
      )

      const remoteLicenseBuffer = await fetchBuffer(familyConfiguration.licenseUrl, fetchImplementation)
      const licenseText = normalizeLicenseText(remoteLicenseBuffer.toString('utf8'))
      if (!licenseText.includes('SIL OPEN FONT LICENSE Version 1.1')) {
        throw new Error(`${familyConfiguration.family} license is not SIL OFL 1.1`)
      }
      const licenseBuffer = Buffer.from(licenseText)
      await writeFile(path.join(familyDirectory, 'OFL.txt'), licenseBuffer, { flag: 'wx' })

      familyManifests.push({
        cssFile: cssRelativePath,
        cssSha256: sha256(Buffer.from(localizedCss)),
        cssUrl: familyConfiguration.cssUrl,
        expectedShardCount: familyConfiguration.expectedShardCount,
        family: familyConfiguration.family,
        fontStretch: familyConfiguration.fontStretch,
        fontStyle: familyConfiguration.fontStyle,
        fontWeight: familyConfiguration.fontWeight,
        id: familyConfiguration.id,
        licenseFile: `${familyConfiguration.id}/OFL.txt`,
        licenseSha256: sha256(licenseBuffer),
        licenseUrl: familyConfiguration.licenseUrl,
        officialRepositoryUrl: familyConfiguration.officialRepositoryUrl,
        remoteCssSha256: sha256(remoteCssBuffer),
        remoteLicenseSha256: sha256(remoteLicenseBuffer),
        shards: downloadedFaces,
      })
    }

    const manifest = {
      capturedDate: NOTO_FONT_CAPTURE_DATE,
      families: familyManifests,
      releaseId: NOTO_FONT_RELEASE_ID,
      schemaVersion: 1,
      totalShardCount: familyManifests.reduce((total, family) => total + family.shards.length, 0),
      userAgent: NOTO_FONT_USER_AGENT,
    }
    await writeFile(
      path.join(temporaryDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    )
    await writeChecksumFile(temporaryDirectory)
    await rename(temporaryDirectory, absoluteDestination)
    completed = true
    return manifest
  }
  finally {
    // 仅清理本次下载专用的精确临时目录，不触碰目标快照或其他用户文件。
    if (!completed) {
      await rm(temporaryDirectory, { force: true, recursive: true })
    }
  }
}

async function verifyChecksumFile(rootDirectory) {
  const checksumBuffer = await readRequiredRegularFile(path.join(rootDirectory, 'SHA256SUMS'))
  const checksumEntries = new Map()
  for (const line of checksumBuffer.toString('utf8').trim().split('\n')) {
    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/u)
    if (!match || checksumEntries.has(match[2])) {
      throw new Error(`Invalid SHA256SUMS entry: ${line}`)
    }
    checksumEntries.set(match[2], match[1])
  }

  const actualRelativeFiles = (await listSnapshotFiles(rootDirectory))
    .filter(relativePath => relativePath !== 'SHA256SUMS')
  assertSameStringSet(checksumEntries.keys(), actualRelativeFiles, 'SHA256SUMS file set')

  for (const [relativePath, expectedHash] of checksumEntries) {
    const buffer = await readRequiredRegularFile(resolveSnapshotPath(rootDirectory, relativePath))
    if (sha256(buffer) !== expectedHash) {
      throw new Error(`SHA256SUMS mismatch for ${relativePath}`)
    }
  }
}

function assertSameStringSet(actualValues, expectedValues, label) {
  const actual = [...actualValues].sort()
  const expected = [...expectedValues].sort()
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} mismatch`)
  }
}

export async function verifyNotoFontSnapshot(
  releaseDirectory = DEFAULT_NOTO_FONT_RELEASE_DIRECTORY,
) {
  const absoluteRoot = path.resolve(releaseDirectory)
  const rootStats = await lstat(absoluteRoot)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`Font snapshot root must be a real directory: ${absoluteRoot}`)
  }

  const manifestBuffer = await readRequiredRegularFile(path.join(absoluteRoot, 'manifest.json'))
  const manifest = JSON.parse(manifestBuffer.toString('utf8'))
  if (
    manifest.schemaVersion !== 1
    || manifest.releaseId !== NOTO_FONT_RELEASE_ID
    || manifest.capturedDate !== NOTO_FONT_CAPTURE_DATE
    || manifest.userAgent !== NOTO_FONT_USER_AGENT
    || !Array.isArray(manifest.families)
  ) {
    throw new Error('Font snapshot manifest metadata is invalid')
  }

  const familyShardCounts = {}
  for (const familyConfiguration of NOTO_FONT_FAMILIES) {
    const familyManifest = manifest.families.find(family => family.id === familyConfiguration.id)
    if (
      !familyManifest
      || familyManifest.family !== familyConfiguration.family
      || familyManifest.cssUrl !== familyConfiguration.cssUrl
      || familyManifest.licenseUrl !== familyConfiguration.licenseUrl
      || typeof familyManifest.remoteLicenseSha256 !== 'string'
      || !SHA256_PATTERN.test(familyManifest.remoteLicenseSha256)
      || familyManifest.officialRepositoryUrl !== familyConfiguration.officialRepositoryUrl
      || familyManifest.fontStyle !== familyConfiguration.fontStyle
      || familyManifest.fontWeight !== familyConfiguration.fontWeight
      || familyManifest.fontStretch !== familyConfiguration.fontStretch
      || familyManifest.expectedShardCount !== familyConfiguration.expectedShardCount
      || !Array.isArray(familyManifest.shards)
      || familyManifest.shards.length !== familyConfiguration.expectedShardCount
    ) {
      throw new Error(`Font snapshot manifest is invalid for ${familyConfiguration.family}`)
    }

    const cssBuffer = await readRequiredRegularFile(
      resolveSnapshotPath(absoluteRoot, familyManifest.cssFile),
    )
    if (sha256(cssBuffer) !== familyManifest.cssSha256) {
      throw new Error(`Font CSS checksum mismatch for ${familyConfiguration.family}`)
    }
    const css = cssBuffer.toString('utf8')
    if (GOOGLE_FONT_ENDPOINT_PATTERN.test(css)) {
      throw new Error(`Font CSS contains an external Google endpoint for ${familyConfiguration.family}`)
    }
    const localFaces = parseLocalizedFontsCss(css)
    if (localFaces.length !== familyConfiguration.expectedShardCount) {
      throw new Error(`Font CSS shard count mismatch for ${familyConfiguration.family}`)
    }

    const localFaceByFile = new Map(localFaces.map((fontFace) => {
      assertFontFaceMatchesConfiguration(fontFace, familyConfiguration)
      return [fontFace.localUrl.slice(2), fontFace]
    }))
    if (localFaceByFile.size !== localFaces.length) {
      throw new Error(`Font CSS contains duplicate local files for ${familyConfiguration.family}`)
    }

    for (const shard of familyManifest.shards) {
      if (
        typeof shard.file !== 'string'
        || typeof shard.remoteUrl !== 'string'
        || typeof shard.sha256 !== 'string'
        || !SHA256_PATTERN.test(shard.sha256)
        || !Number.isInteger(shard.bytes)
        || shard.bytes <= 4
      ) {
        throw new Error(`Font shard metadata is invalid for ${familyConfiguration.family}`)
      }

      const fontBuffer = await readRequiredRegularFile(resolveSnapshotPath(absoluteRoot, shard.file))
      assertWoff2Buffer(fontBuffer, shard.file)
      if (fontBuffer.length !== shard.bytes || sha256(fontBuffer) !== shard.sha256) {
        throw new Error(`Font shard integrity mismatch for ${shard.file}`)
      }

      const fileName = path.posix.basename(shard.file)
      const localFace = localFaceByFile.get(fileName)
      if (
        !localFace
        || localFace.unicodeRange !== shard.unicodeRange
        || localFace.fontDisplay !== shard.fontDisplay
        || localFace.fontStyle !== shard.fontStyle
        || localFace.fontWeight !== shard.fontWeight
        || localFace.fontStretch !== shard.fontStretch
      ) {
        throw new Error(`Font CSS and manifest disagree for ${shard.file}`)
      }
    }

    const licenseBuffer = await readRequiredRegularFile(
      resolveSnapshotPath(absoluteRoot, familyManifest.licenseFile),
    )
    if (
      sha256(licenseBuffer) !== familyManifest.licenseSha256
      || !licenseBuffer.toString('utf8').includes('SIL OPEN FONT LICENSE Version 1.1')
    ) {
      throw new Error(`Font license integrity mismatch for ${familyConfiguration.family}`)
    }

    const familyDirectory = resolveSnapshotPath(absoluteRoot, familyConfiguration.id)
    const actualFontFiles = (await readdir(familyDirectory, { withFileTypes: true }))
      .filter(entry => entry.name.endsWith('.woff2'))
      .map((entry) => {
        if (!entry.isFile() || entry.isSymbolicLink()) {
          throw new Error(`Font shard must be a regular file: ${entry.name}`)
        }
        return entry.name
      })
    assertSameStringSet(
      actualFontFiles,
      familyManifest.shards.map(shard => path.posix.basename(shard.file)),
      `${familyConfiguration.family} WOFF2 file set`,
    )
    assertSameStringSet(
      localFaceByFile.keys(),
      actualFontFiles,
      `${familyConfiguration.family} CSS WOFF2 references`,
    )
    familyShardCounts[familyConfiguration.id] = actualFontFiles.length
  }

  if (manifest.families.length !== NOTO_FONT_FAMILIES.length) {
    throw new Error('Font snapshot contains an unexpected family')
  }
  const totalShardCount = Object.values(familyShardCounts)
    .reduce((total, count) => total + count, 0)
  if (manifest.totalShardCount !== totalShardCount) {
    throw new Error('Font snapshot total shard count is invalid')
  }

  await verifyChecksumFile(absoluteRoot)
  return { familyShardCounts, totalShardCount }
}
