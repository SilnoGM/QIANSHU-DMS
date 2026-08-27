import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 人员显示组件的纯逻辑与源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  getPersonDisplayFallback,
  normalizePersonDisplayName,
} from '../../src/components/business/QsPersonDisplay/logic'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('人员显示名称会清理首尾空白并为缺失名称提供稳定回退', () => {
  assert.equal(normalizePersonDisplayName('  林雅婷  '), '林雅婷')
  assert.equal(normalizePersonDisplayName(''), '未知人员')
  assert.equal(normalizePersonDisplayName('   '), '未知人员')
})

test('头像回退只取用户可见的第一个字素簇', () => {
  assert.equal(getPersonDisplayFallback('林雅婷'), '林')
  assert.equal(getPersonDisplayFallback(' 👩🏽‍💻 研发主管'), '👩🏽‍💻')
  assert.equal(getPersonDisplayFallback(''), '未')
})

test('QsPersonDisplay 提供头像、名称截断、完整名称提示与三档尺寸', () => {
  const componentSource = readRelativeSource(
    '../../src/components/business/QsPersonDisplay/index.vue',
  )
  const typeSource = readRelativeSource(
    '../../src/components/business/QsPersonDisplay/types.ts',
  )

  assert.match(componentSource, /defineOptions\(\{ name: 'QsPersonDisplay' \}\)/u)
  assert.match(componentSource, /displayName: string/u)
  assert.match(componentSource, /avatarUrl\?: null \| string/u)
  assert.match(componentSource, /size\?: QsPersonDisplaySize/u)
  assert.match(componentSource, /size: 'md'/u)
  assert.match(componentSource, /<FaAvatar/u)
  assert.match(componentSource, /rounded-full/u)
  assert.match(componentSource, /<FaTooltip/u)
  assert.match(componentSource, /:text="normalizedName"/u)
  assert.match(componentSource, /\btruncate\b/u)
  assert.match(componentSource, /sm:.*size-6/u)
  assert.match(componentSource, /md:.*size-8/u)
  assert.match(componentSource, /lg:.*size-10/u)
  assert.match(typeSource, /'sm' \| 'md' \| 'lg'/u)
  assert.doesNotMatch(
    componentSource,
    /@click|router|@\/api|useApp\w*Store|fetch\(|axios/u,
  )
})

test('人员显示组件文档明确纯展示边界与公共属性', () => {
  const readmeSource = readRelativeSource(
    '../../src/components/business/QsPersonDisplay/README.md',
  )

  for (const field of ['displayName', 'avatarUrl', 'size']) {
    assert.match(readmeSource, new RegExp(`\\b${field}\\b`, 'u'))
  }
  assert.match(readmeSource, /纯展示/u)
  assert.match(readmeSource, /未知人员/u)
  assert.match(readmeSource, /不负责.*查询|不读取.*人员/u)
})

test('人员显示组件库示例覆盖图片、回退、长名称与三档尺寸', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/business/person-display.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/business/components/PersonDisplayShowcase.vue',
  )

  assert.match(
    pageSource,
    /defineOptions\(\{ name: 'ComponentLibraryQsPersonDisplay' \}\)/u,
  )
  assert.match(pageSource, /title="人员显示"/u)
  assert.match(
    pageSource,
    /route-path="\/component-library\/business\/person-display"/u,
  )
  assert.match(pageSource, /<PersonDisplayShowcase\s*\/>/u)
  assert.match(
    showcaseSource,
    /import QsPersonDisplay from '@\/components\/business\/QsPersonDisplay\/index\.vue'/u,
  )
  assert.match(showcaseSource, /avatar-url=/u)
  assert.match(showcaseSource, /size="sm"/u)
  assert.match(showcaseSource, /size="md"/u)
  assert.match(showcaseSource, /size="lg"/u)
  assert.match(showcaseSource, /未知人员/u)
  assert.match(showcaseSource, /max-w-/u)
  assert.doesNotMatch(
    showcaseSource,
    /@\/api|useApp\w*Store|fetch\(|axios|linear-gradient|radial-gradient/u,
  )
})
