/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function readWebFile(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const source = readWebFile('../packages/components/src/pro/combobox/index.vue')
const comboboxBarrel = readWebFile('../packages/components/src/pro/combobox/index.ts')
const componentsBarrel = readWebFile('../packages/components/src/index.ts')
const readme = readWebFile('../packages/components/src/pro/combobox/README.md')
const handbook = readWebFile(
  '../../docs/前端文档/前端开发手册/Fantastic-admin内置组件/专业版组件.md',
)
const handbookComboboxSection = handbook.match(
  /(?:^|\n)## FaCombobox\n[\s\S]*?(?=\n## [^\n]+(?:\n|$)|$)/u,
)?.[0] ?? ''

const safeInputAttributeNames = [
  'id',
  'tabindex',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-invalid',
  'aria-required',
  'aria-errormessage',
  'aria-busy',
]

test('FaCombobox 只公开白名单化的真实 input 属性入口', () => {
  const inputAttrsType = source.match(
    /type ComboboxInputAttrs = Pick<\s*InputHTMLAttributes,([\s\S]*?)\n>/u,
  )
  assert.ok(inputAttrsType, '必须以 SFC 私有 Pick 类型声明 ComboboxInputAttrs')

  const declaredNames = [...inputAttrsType[1].matchAll(/'([^']+)'/gu)]
    .map(match => match[1])
  assert.deepEqual(declaredNames, safeInputAttributeNames)
  assert.doesNotMatch(inputAttrsType[1], /name|value|onInput|aria-expanded|aria-controls|aria-autocomplete|aria-activedescendant/u)
  assert.doesNotMatch(source, /export\s+(?:interface|type)\s+ComboboxInputAttrs/u)

  assert.match(source, /inputAttrs\?: ComboboxInputAttrs/u)
  assert.match(source, /v-bind="safeInputAttrs"/u)
  assert.doesNotMatch(source, /v-bind="(?:props\.)?inputAttrs"/u)
  assert.doesNotMatch(source, /\$attrs/u)
  for (const attributeName of safeInputAttributeNames) {
    assert.match(
      source,
      new RegExp(`['\"]?${attributeName}['\"]?\\s*:\\s*props\\.inputAttrs\\?\\.`, 'u'),
      `运行时白名单必须只投影 ${attributeName}`,
    )
  }
})

test('FaCombobox 保持既有 barrel 导出边界', () => {
  const expectedTypeNames = [
    'ComboboxGroupOption',
    'ComboboxOption',
    'ComboboxProps',
  ]
  const comboboxBarrelLines = comboboxBarrel.trim().split('\n')
  assert.deepEqual(comboboxBarrelLines, [
    "export { default as Combobox } from './index.vue'",
    "export type { ComboboxGroupOption, ComboboxOption, ComboboxProps } from './index.vue'",
  ])

  const componentsComboboxLines = componentsBarrel
    .split('\n')
    .filter(line => line.includes("from './pro/combobox'"))
  assert.deepEqual(componentsComboboxLines, [
    "export { Combobox as FaCombobox } from './pro/combobox'",
    "export type { ComboboxGroupOption, ComboboxOption, ComboboxProps } from './pro/combobox'",
  ])

  for (const [barrelName, barrelSource, typeExportPattern] of [
    ['combobox barrel', comboboxBarrel, /export type \{([^}]+)\} from '\.\/index\.vue'/u],
    ['components barrel', componentsBarrel, /export type \{([^}]+)\} from '\.\/pro\/combobox'/u],
  ]) {
    const typeExport = barrelSource.match(typeExportPattern)
    assert.ok(typeExport, `${barrelName} 必须保留 FaCombobox 类型导出`)
    assert.deepEqual(
      typeExport[1].split(',').map(name => name.trim()),
      expectedTypeNames,
    )
    assert.doesNotMatch(barrelSource, /ComboboxInputAttrs/u)
  }
})

test('FaCombobox 接入按钮名称、真实 input 焦点事件与公开焦点方法', () => {
  assert.match(source, /clearAriaLabel\?: string/u)
  assert.match(source, /triggerAriaLabel\?: string/u)
  assert.match(source, /clearAriaLabel:\s*'清空选择'/u)
  assert.match(source, /triggerAriaLabel:\s*'展开或收起选项'/u)

  const input = source.match(/<ComboboxInput[\s\S]*?\/>/u)?.[0] ?? ''
  assert.match(input, /ref="comboboxInputRef"/u)
  assert.match(input, /@focus="handleInputFocus"/u)
  assert.match(input, /@blur="handleInputBlur"/u)

  const clearButton = source.match(/<Button\s+v-if="showClear"[\s\S]*?<\/Button>/u)?.[0] ?? ''
  assert.match(clearButton, /data-slot="combobox-clear"/u)
  assert.match(clearButton, /:aria-label="clearAriaLabel"/u)

  const trigger = source.match(/<ComboboxTrigger\s+[\s\S]*?\/>/u)?.[0] ?? ''
  assert.match(trigger, /:aria-label="triggerAriaLabel"/u)

  assert.match(source, /focus:\s*\[event: FocusEvent\]/u)
  assert.match(source, /blur:\s*\[event: FocusEvent\]/u)
  const focusHandler = source.match(
    /function handleInputFocus\(event: FocusEvent\) \{([\s\S]*?)\n\}/u,
  )?.[1] ?? ''
  const blurHandler = source.match(
    /function handleInputBlur\(event: FocusEvent\) \{([\s\S]*?)\n\}/u,
  )?.[1] ?? ''
  assert.match(focusHandler, /isFocused\.value = true\s+emits\('focus', event\)/u)
  assert.match(blurHandler, /isFocused\.value = false\s+emits\('blur', event\)/u)
  assert.match(source, /function focus\(\)[\s\S]*?comboboxInputRef\.value\?\.ref\?\.focus\(\)/u)
  assert.match(source, /function blur\(\)[\s\S]*?comboboxInputRef\.value\?\.ref\?\.blur\(\)/u)
  assert.match(source, /defineExpose\(\{\s*blur,\s*focus,?\s*\}\)/u)
  assert.doesNotMatch(source, /querySelector/u)
})

test('FaCombobox 只把 contentClass 透传给 Teleport 内容层', () => {
  const propsType = source.match(
    /export interface ComboboxProps \{([\s\S]*?)\n\}/u,
  )?.[1] ?? ''
  assert.match(propsType, /contentClass\?: HTMLAttributes\['class'\]/u)

  const content = source.match(/<ComboboxContent[\s\S]*?>/u)?.[0] ?? ''
  assert.match(content, /:class="cn\('z-2000', contentClass\)"/u)
  assert.doesNotMatch(content, /v-bind="(?:props\.)?contentAttrs"/u)

  const templateStart = source.indexOf('\n<template>')
  const templateEnd = source.lastIndexOf('\n</template>')
  assert.ok(templateStart >= 0)
  assert.ok(templateEnd > templateStart)
  const template = source.slice(templateStart, templateEnd)
  assert.equal(
    [...template.matchAll(/\bcontentClass\b/gu)].length,
    1,
    'contentClass 在 template 中必须只有 Teleport 内容层一个运行时落点',
  )
})

test('FaCombobox 加固不改变既有 props、模型与选择接线', () => {
  const propsType = source.match(
    /export interface ComboboxProps \{([\s\S]*?)\n\}/u,
  )?.[1] ?? ''
  for (const existingProp of [
    /disabled\?: boolean/u,
    /clearable\?: boolean/u,
    /position\?: ComboboxContentProps\['position'\]/u,
    /options: \(ComboboxOption \| ComboboxGroupOption\)\[\]/u,
    /placeholder\?: string/u,
    /emptyText\?: string/u,
    /filter\?: \(searchValue: string, option: ComboboxOption\) => boolean/u,
    /virtualList\?: boolean/u,
    /class\?: HTMLAttributes\['class'\]/u,
  ]) {
    assert.match(propsType, existingProp)
  }

  assert.match(source, /change: \[value: AcceptableValue \| undefined\]/u)
  assert.match(source, /clear: \[\]/u)
  assert.match(source, /const value = defineModel<AcceptableValue \| undefined>\(\)/u)
  assert.match(source, /watch\(value, \(newValue\) => \{\s*emits\('change', newValue\)\s*\}\)/u)
  assert.match(source, /function handleClear\(\) \{\s*value\.value = undefined\s*searchValue\.value = ''\s*emits\('clear'\)\s*\}/u)

  const groupedItem = source.match(
    /<ComboboxItem\s+v-for="item in option\.options"[\s\S]*?<\/ComboboxItem>/u,
  )?.[0] ?? ''
  assert.match(groupedItem, /:value="item\.value"/u)
  assert.match(groupedItem, /:disabled="item\.disabled"/u)
  assert.match(groupedItem, /:text-value="item\.label"/u)

  const virtualizer = source.match(
    /<ComboboxVirtualizer[\s\S]*?<\/ComboboxVirtualizer>/u,
  )?.[0] ?? ''
  assert.match(virtualizer, /:options="filteredVirtualValues"/u)
  assert.match(virtualizer, /:text-content="option => findLabelByValue\(option\)"/u)
  assert.match(virtualizer, /:value="option"/u)
  assert.match(virtualizer, /:disabled="findOptionByValue\(option\)\?\.disabled"/u)
  assert.match(virtualizer, /:text-value="findLabelByValue\(option\)"/u)
})

test('FaCombobox 平铺和分组条目使用 value 身份而不是 Label', () => {
  assert.match(source, /new WeakMap<object, number>\(\)/u)
  assert.match(source, /function getOptionValueKey\(optionValue: AcceptableValue\): string/u)
  assert.match(source, /typeof optionValue/u)
  assert.match(source, /String\(optionValue\)/u)
  assert.match(source, /objectValueKeys\.get\(optionValue\)/u)
  assert.match(source, /objectValueKeys\.set\(optionValue, objectKey\)/u)

  assert.match(
    source,
    /:key="isGroup\(option\) \? `group:\$\{option\.label\}` : getOptionValueKey\(option\.value\)"/u,
  )
  assert.match(source, /:key="getOptionValueKey\(item\.value\)"/u)
  assert.doesNotMatch(source, /<template v-for="option in filteredOptions" :key="option\.label">/u)
  assert.doesNotMatch(source, /:key="String\(item\.value\)"/u)

  // 本文件只固定静态接线；分组、虚拟列表与真实 DOM 行为由 examples build 和 Task 7 Chrome 证明。
  assert.match(source, /<ComboboxGroup v-if="isGroup\(option\)">/u)
  assert.match(source, /<ComboboxVirtualizer/u)
  assert.match(source, /:options="filteredVirtualValues"/u)
})

test('FaCombobox 文档记录 additive API 与 Reka owned ARIA 边界', () => {
  assert.ok(handbookComboboxSection, '专业版组件手册必须保留独立的 FaCombobox 章节')
  for (const documentedName of [
    'inputAttrs',
    'clearAriaLabel',
    'triggerAriaLabel',
    'contentClass',
    'focus()',
    'blur()',
    'aria-expanded',
    'aria-activedescendant',
    'WeakMap',
  ]) {
    assert.ok(readme.includes(documentedName), `FaCombobox README 缺少 ${documentedName}`)
    assert.ok(handbookComboboxSection.includes(documentedName), `专业版组件手册 FaCombobox 章节缺少 ${documentedName}`)
  }

  assert.match(readme, /搜索 input 不承载业务 `name`/u)
  assert.match(handbookComboboxSection, /搜索 input 不承载业务 `name`/u)
  assert.match(
    readme,
    /contentClass[^。\n]*只作用于 Teleport 下拉内容层[^。\n]*不会传给输入控件/u,
  )
  assert.match(
    handbookComboboxSection,
    /contentClass[^。\n]*只传给 Teleport 下拉内容层[^。\n]*不改变输入控件默认样式/u,
  )
})
