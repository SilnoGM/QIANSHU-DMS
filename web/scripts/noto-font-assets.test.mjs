import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
// eslint-disable-next-line test/no-import-node-test -- Web 工程脚本使用 Node.js 内置 test runner，不引入额外测试运行时。
import test from 'node:test'

import {
  assertWoff2Buffer,
  DEFAULT_NOTO_FONT_RELEASE_DIRECTORY,
  localizeGoogleFontsCss,
  NOTO_FONT_FAMILIES,
  normalizeLicenseText,
  parseGoogleFontsCss,
  verifyNotoFontSnapshot,
} from './noto-font-assets.mjs'

const GOOGLE_FONTS_CSS_FIXTURE = `
@font-face {
  font-family: 'Noto Sans Mono';
  font-style: normal;
  font-weight: 400 700;
  font-stretch: 100%;
  font-display: block;
  src: url(https://fonts.gstatic.com/s/notosansmono/v37/mono-latin.woff2) format('woff2');
  unicode-range: U+0000-00ff;
}
@font-face {
  font-family: 'Noto Sans Mono';
  font-style: normal;
  font-weight: 400 700;
  font-stretch: 100%;
  font-display: block;
  src: url(https://fonts.gstatic.com/s/notosansmono/v37/mono-cyrillic.woff2) format('woff2');
  unicode-range: U+0400-045f;
}
`

test('Google Fonts CSS 解析保留可变字重、宽度和 Unicode 分片', () => {
  const fontFaces = parseGoogleFontsCss(GOOGLE_FONTS_CSS_FIXTURE)

  assert.equal(fontFaces.length, 2)
  assert.deepEqual(fontFaces[0], {
    family: 'Noto Sans Mono',
    fontDisplay: 'block',
    fontStretch: '100%',
    fontStyle: 'normal',
    fontWeight: '400 700',
    remoteUrl: 'https://fonts.gstatic.com/s/notosansmono/v37/mono-latin.woff2',
    unicodeRange: 'U+0000-00ff',
  })
  assert.equal(fontFaces[1].unicodeRange, 'U+0400-045f')
})

test('本地化 CSS 只改写字体 URL，不修改 Unicode 分片', () => {
  const localizedCss = localizeGoogleFontsCss(
    GOOGLE_FONTS_CSS_FIXTURE,
    new Map([
      [
        'https://fonts.gstatic.com/s/notosansmono/v37/mono-latin.woff2',
        './noto-sans-mono-001-a1b2c3d4e5f6.woff2',
      ],
      [
        'https://fonts.gstatic.com/s/notosansmono/v37/mono-cyrillic.woff2',
        './noto-sans-mono-002-f6e5d4c3b2a1.woff2',
      ],
    ]),
  )

  assert.doesNotMatch(localizedCss, /fonts\.gstatic\.com/u)
  assert.match(localizedCss, /\.\/noto-sans-mono-001-a1b2c3d4e5f6\.woff2/u)
  assert.match(localizedCss, /unicode-range:\s*U\+0000-00ff;/u)
  assert.match(localizedCss, /unicode-range:\s*U\+0400-045f;/u)
})

test('WOFF2 校验拒绝错误魔数', () => {
  assert.doesNotThrow(() => assertWoff2Buffer(Buffer.from('wOF2valid-fixture')))
  assert.throws(
    () => assertWoff2Buffer(Buffer.from('wOFFinvalid-fixture')),
    /WOFF2 magic/u,
  )
})

test('授权文本只规范化行尾空白并保留单个结尾换行', () => {
  assert.equal(
    normalizeLicenseText('line one  \r\nline two\t\r\n\r\n'),
    'line one\nline two\n',
  )
})

test('字体快照配置固定两个家族和首次分片数', () => {
  assert.deepEqual(
    NOTO_FONT_FAMILIES.map(family => ({
      expectedShardCount: family.expectedShardCount,
      family: family.family,
      id: family.id,
    })),
    [
      { expectedShardCount: 101, family: 'Noto Sans SC', id: 'noto-sans-sc' },
      { expectedShardCount: 7, family: 'Noto Sans Mono', id: 'noto-sans-mono' },
    ],
  )
})

test('已提交字体快照通过完整性校验', async () => {
  const verification = await verifyNotoFontSnapshot(DEFAULT_NOTO_FONT_RELEASE_DIRECTORY)

  assert.deepEqual(verification.familyShardCounts, {
    'noto-sans-mono': 7,
    'noto-sans-sc': 101,
  })
  assert.equal(verification.totalShardCount, 108)
})
