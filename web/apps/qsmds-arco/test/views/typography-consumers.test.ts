import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 排版消费契约只需静态检查模板，不需要浏览器环境。
import test from 'node:test'

function readRelativeSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

/**
 * 只截取目标内容所属的 opening tag，避免测试冻结同一页面里有意保留的展示型
 * eyebrow、布局 class 或其他无关文字节点。
 */
function openingTagBefore(source: string, tag: string, marker: string): string {
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `未找到模板标记：${marker}`)

  const start = source.lastIndexOf(`<${tag}`, markerIndex)
  const end = source.indexOf('>', start)
  assert.notEqual(start, -1, `未找到 ${tag} opening tag`)
  assert.notEqual(end, -1, `${tag} opening tag 未闭合`)
  return source.slice(start, end + 1)
}

test('登录页使用独立 auth-display，并由全局表单与操作 bridge 接管控件排版', () => {
  const source = readRelativeSource(
    '../../src/components/AppAccountForm/login.vue',
  )
  const globalStyles = readRelativeSource(
    '../../src/assets/styles/globals.css',
  )
  const titleTag = openingTagBefore(source, 'h3', '欢迎登录')
  const descriptionTag = openingTagBefore(source, 'p', '{{ title }}')

  assert.match(titleTag, /\bqs-type-auth-display\b/u)
  assert.doesNotMatch(titleTag, /\b(?:text-4xl|font-bold)\b/u)
  assert.match(descriptionTag, /\bqs-type-description\b/u)
  assert.doesNotMatch(descriptionTag, /\b(?:text-sm|text-base|lg:text-base)\b/u)

  assert.match(source, /<FaForm\b/u)
  assert.match(source, /<FaInput\b/u)
  assert.match(source, /<FaButton\b/u)
  assert.match(
    globalStyles,
    /\[data-slot="input"\][\s\S]*?font-size:\s*var\(--qs-type-size-md\)/u,
  )
  assert.match(
    globalStyles,
    /\[data-slot="button"\][\s\S]*?font-weight:\s*var\(--qs-type-weight-medium\)/u,
  )
})

test('组件目录 Hero、原则标题和说明使用稳定语义角色', () => {
  const source = readRelativeSource(
    '../../src/views/component_library/shared/ComponentCatalogPage.vue',
  )
  const heroTag = openingTagBefore(source, 'h2', '{{ headline }}')
  const summaryTag = openingTagBefore(source, 'p', '{{ summary }}')
  const principleTitleTag = openingTagBefore(
    source,
    'h3',
    '{{ principle.title }}',
  )
  const principleDescriptionTag = openingTagBefore(
    source,
    'p',
    '{{ principle.description }}',
  )

  assert.match(source, /<FaPageHeader\b/u)
  assert.match(heroTag, /\bqs-type-display-title\b/u)
  assert.doesNotMatch(
    heroTag,
    /\b(?:text-2xl|leading-tight|tracking-tight|font-semibold|md-text-3xl)\b/u,
  )
  assert.match(summaryTag, /\bqs-type-body-relaxed\b/u)
  assert.match(summaryTag, /\btext-muted-foreground\b/u)
  assert.doesNotMatch(
    summaryTag,
    /\b(?:text-sm|leading-7|md-text-base)\b/u,
  )
  assert.match(principleTitleTag, /\bqs-type-compact-title\b/u)
  assert.doesNotMatch(principleTitleTag, /\b(?:text-sm|font-semibold)\b/u)
  assert.match(principleDescriptionTag, /\bqs-type-body-relaxed\b/u)
  assert.match(principleDescriptionTag, /\btext-muted-foreground\b/u)
  assert.doesNotMatch(principleDescriptionTag, /\b(?:text-sm|leading-6)\b/u)
})
