import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 Node.js 内置 test runner 直接运行。
import test from 'node:test'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'

import { verifyFontZeroResidue } from './font-zero-residue.mjs'

const stylesheetHost = ['fonts', 'googleapis', 'com'].join('.')
const binaryHost = ['fonts', 'gstatic', 'com'].join('.')
const legacySyntaxFontName = ['FontWith', 'ASyntaxHighlighter'].join('')
const notoSnapshotPath = 'assets/fonts/noto/google-fonts-css2-2026-07-22'

async function createOutputDirectory(t) {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), 'qianshu-font-zero-'))
  t.after(() => rm(outputDirectory, { force: true, recursive: true }))
  return outputDirectory
}

async function writeOutputFile(outputDirectory, relativePath, content) {
  const absolutePath = path.join(outputDirectory, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content)
}

test('干净 Bundle、固定 Noto 字体和上游来源清单通过物理零残留校验', async (t) => {
  const outputDirectory = await createOutputDirectory(t)
  await writeOutputFile(outputDirectory, 'index.html', '<main>千树 DMS</main>')
  await writeOutputFile(outputDirectory, 'assets/app.js', 'console.info("ready")')
  await writeOutputFile(outputDirectory, `${notoSnapshotPath}/noto-sans-sc/font.woff2`, 'wOF2fixture')
  await writeOutputFile(
    outputDirectory,
    `${notoSnapshotPath}/manifest.json`,
    JSON.stringify({ remoteUrl: `https://${binaryHost}/snapshot.woff2` }),
  )

  const result = await verifyFontZeroResidue(outputDirectory)

  assert.equal(result.fontAssetCount, 1)
  assert.equal(result.violationCount, 0)
})

for (const fixture of [
  {
    content: `<link href="https://${stylesheetHost}/css2">`,
    expectedRule: 'remote-google-font-host',
    relativePath: 'index.html',
  },
  {
    content: `const fontUrl = "https://${binaryHost}/font.woff2"`,
    expectedRule: 'remote-google-font-host',
    relativePath: 'assets/app.js',
  },
  {
    content: `.${legacySyntaxFontName} { color: inherit; }`,
    expectedRule: 'legacy-syntax-font',
    relativePath: 'assets/app.css',
  },
  {
    content: '.digital-7 { color: inherit; }',
    expectedRule: 'legacy-digital-font',
    relativePath: 'assets/app.css',
  },
]) {
  test(`Bundle 内容拒绝 ${fixture.expectedRule}`, async (t) => {
    const outputDirectory = await createOutputDirectory(t)
    await writeOutputFile(outputDirectory, fixture.relativePath, fixture.content)

    await assert.rejects(
      verifyFontZeroResidue(outputDirectory),
      error => error.message.includes(fixture.expectedRule) && error.message.includes(fixture.relativePath),
    )
  })
}

test('Noto 快照目录外的字体二进制即使未被引用也会失败', async (t) => {
  const outputDirectory = await createOutputDirectory(t)
  await writeOutputFile(outputDirectory, 'assets/fonts/old/font.woff2', 'wOF2fixture')

  await assert.rejects(
    verifyFontZeroResidue(outputDirectory),
    /font-binary-outside-noto-snapshot/u,
  )
})

for (const fixture of [
  { compress: gzipSync, suffix: 'gz' },
  { compress: brotliCompressSync, suffix: 'br' },
]) {
  test(`压缩 Bundle .${fixture.suffix} 不能藏匿远程字体地址`, async (t) => {
    const outputDirectory = await createOutputDirectory(t)
    const content = Buffer.from(`const fontUrl = "https://${binaryHost}/font.woff2"`)
    await writeOutputFile(outputDirectory, `assets/app.js.${fixture.suffix}`, fixture.compress(content))

    await assert.rejects(
      verifyFontZeroResidue(outputDirectory),
      /remote-google-font-host/u,
    )
  })
}

for (const fixture of [
  { compress: content => content, relativePath: 'assets/app.js.map' },
  { compress: gzipSync, relativePath: 'assets/app.js.map.gz' },
  { compress: brotliCompressSync, relativePath: 'assets/app.css.map.br' },
]) {
  test(`source map ${fixture.relativePath} 不能保留远程字体地址`, async (t) => {
    const outputDirectory = await createOutputDirectory(t)
    const content = Buffer.from(JSON.stringify({ sourcesContent: [`https://${binaryHost}/font.woff2`] }))
    await writeOutputFile(outputDirectory, fixture.relativePath, fixture.compress(content))

    await assert.rejects(
      verifyFontZeroResidue(outputDirectory),
      /remote-google-font-host/u,
    )
  })
}
