import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 Node.js 内置 test runner 直接运行。
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const webRoot = fileURLToPath(new URL('../', import.meta.url))
const globalStyles = readWebFile('apps/qsmds-arco/src/assets/styles/globals.css')
const unoConfig = readWebFile('uno.config.ts')
const sharedComponentSources = {
  badge: readWebFile('packages/components/src/basic/badge/badge/Badge.vue'),
  button: readWebFile('packages/components/src/basic/button/button/Button.vue'),
  dialogDescription: readWebFile(
    'packages/components/src/basic/modal/dialog/DialogDescription.vue',
  ),
  dialogTitle: readWebFile(
    'packages/components/src/basic/modal/dialog/DialogTitle.vue',
  ),
  formControl: readWebFile(
    'packages/components/src/basic/form/form/FormControl.vue',
  ),
  formDescription: readWebFile(
    'packages/components/src/basic/form/form/FormDescription.vue',
  ),
  formItem: readWebFile('packages/components/src/basic/form/FormItem.vue'),
  formLabel: readWebFile(
    'packages/components/src/basic/form/form/FormLabel.vue',
  ),
  formMessage: readWebFile(
    'packages/components/src/basic/form/form/FormMessage.vue',
  ),
  input: readWebFile('packages/components/src/basic/input/input/Input.vue'),
  label: readWebFile('packages/components/src/basic/label/label/Label.vue'),
  pageHeader: readWebFile(
    'packages/components/src/basic/page-header/index.vue',
  ),
  selectTrigger: readWebFile(
    'packages/components/src/basic/select/select/SelectTrigger.vue',
  ),
  sheetDescription: readWebFile(
    'packages/components/src/basic/drawer/sheet/SheetDescription.vue',
  ),
  sheetTitle: readWebFile(
    'packages/components/src/basic/drawer/sheet/SheetTitle.vue',
  ),
  table: readWebFile('packages/components/src/basic/table/table/Table.vue'),
  tableCell: readWebFile(
    'packages/components/src/basic/table/table/TableCell.vue',
  ),
  tableFooter: readWebFile(
    'packages/components/src/basic/table/table/TableFooter.vue',
  ),
  tableHead: readWebFile(
    'packages/components/src/basic/table/table/TableHead.vue',
  ),
  tag: readWebFile('packages/components/src/basic/tag/tag/Tag.vue'),
  textarea: readWebFile(
    'packages/components/src/basic/textarea/textarea/Textarea.vue',
  ),
}

function readWebFile(relativePath) {
  return readFileSync(join(webRoot, relativePath), 'utf8')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function readCustomProperty(source, name) {
  const match = source.match(new RegExp(`${escapeRegExp(name)}\\s*:\\s*([^;]+);`, 'u'))
  assert.ok(match, `缺少排版 Token：${name}`)
  return match[1].replace(/\s+/gu, ' ').trim()
}

function readShortcut(name) {
  const match = unoConfig.match(
    new RegExp(`['"]${escapeRegExp(name)}['"]\\s*:\\s*'([^']+)'`, 'u'),
  )
  assert.ok(match, `缺少 UnoCSS 排版 shortcut：${name}`)
  return match[1]
}

function readMarkedSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)

  assert.notEqual(start, -1, `缺少样式区段起始标记：${startMarker}`)
  assert.notEqual(end, -1, `缺少样式区段结束标记：${endMarker}`)
  assert.ok(end > start, `样式区段标记顺序错误：${startMarker}`)

  return source.slice(start + startMarker.length, end)
}

function readRuleContaining(source, selectorPattern, requiredDeclaration) {
  const selector = new RegExp(selectorPattern, 'u')
  const matches = [...source.matchAll(/([^{}]+)\{([^}]*)\}/gu)]
  const rule = matches.find(([, selectors, declarations]) =>
    selector.test(selectors) && declarations.includes(requiredDeclaration))

  assert.ok(rule, `缺少选择器 ${selectorPattern} 的 ${requiredDeclaration} 声明`)
  return rule[2]
}

test('正式应用显式声明全局排版基础 Token', () => {
  const expectedTokens = new Map([
    ['--qs-type-size-xs', '0.75rem'],
    ['--qs-type-size-sm', '0.875rem'],
    ['--qs-type-size-md', '1rem'],
    ['--qs-type-size-lg', '1.125rem'],
    ['--qs-type-size-xl', '1.25rem'],
    ['--qs-type-size-2xl', '1.5rem'],
    ['--qs-type-size-3xl', '1.875rem'],
    ['--qs-type-size-4xl', '2.25rem'],
    ['--qs-type-leading-xs', '1rem'],
    ['--qs-type-leading-sm', '1.25rem'],
    ['--qs-type-leading-md', '1.5rem'],
    ['--qs-type-leading-lg', '1.75rem'],
    ['--qs-type-leading-xl', '2rem'],
    ['--qs-type-leading-2xl', '2.375rem'],
    ['--qs-type-leading-3xl', '2.5rem'],
    ['--qs-type-weight-regular', '400'],
    ['--qs-type-weight-medium', '500'],
    ['--qs-type-weight-semibold', '600'],
    ['--qs-type-weight-bold', '700'],
    ['--qs-type-tracking-normal', '0'],
    ['--qs-type-tracking-tight', '-0.025em'],
    ['--qs-type-tracking-wide', '0.16em'],
  ])

  for (const [name, value] of expectedTokens) {
    assert.equal(readCustomProperty(globalStyles, name), value)
  }
})

test('body 显式接管 Sans 14/20/400 根排版', () => {
  const bodyRule = readRuleContaining(globalStyles, '(?:^|\\n)body', 'box-sizing')

  assert.match(bodyRule, /font-family:\s*var\(--qs-font-sans\)/u)
  assert.match(bodyRule, /font-size:\s*var\(--qs-type-size-sm\)/u)
  assert.match(bodyRule, /font-weight:\s*var\(--qs-type-weight-regular\)/u)
  assert.match(bodyRule, /line-height:\s*var\(--qs-type-leading-sm\)/u)
})

test('全局字体保持灰度抗锯齿，避免移除 Arco normalize 后字重变粗', () => {
  const htmlRule = readRuleContaining(globalStyles, '(?:^|\\n)html', 'font-synthesis')

  assert.match(htmlRule, /-webkit-font-smoothing:\s*antialiased/u)
  assert.match(htmlRule, /-moz-osx-font-smoothing:\s*grayscale/u)
})

test('UnoCSS 提供完整语义角色并为应用 Token 设置静态 fallback', () => {
  const requiredShortcuts = [
    'qs-type-display-title',
    'qs-type-auth-display',
    'qs-type-page-title',
    'qs-type-section-title',
    'qs-type-component-title',
    'qs-type-compact-title',
    'qs-type-body',
    'qs-type-body-medium',
    'qs-type-body-relaxed',
    'qs-type-description',
    'qs-type-meta',
    'qs-type-compact-label',
    'qs-type-form-label',
    'qs-type-form-help',
    'qs-type-form-control',
    'qs-type-action',
    'qs-type-action-disabled',
    'qs-type-tag',
    'qs-type-status-tag',
    'qs-type-dialog-title',
    'qs-type-table-header',
    'qs-type-data',
    'qs-type-data-emphasis',
  ]

  for (const name of requiredShortcuts) {
    const shortcut = readShortcut(name)
    const tokenReferences = [...shortcut.matchAll(/var\(--qs-type-[^)]+\)/gu)]

    assert.match(
      shortcut,
      name === 'qs-type-data' || name === 'qs-type-data-emphasis'
        ? /\bfont-mono\b/u
        : /\bfont-sans\b/u,
      `${name} 未选择正确的字体语义`,
    )
    for (const [reference] of tokenReferences) {
      assert.match(reference, /,/u, `${name} 的 ${reference} 缺少静态 fallback`)
    }
  }

  assert.match(unoConfig, /safelist:\s*\[\s*\.\.\.Object\.keys\(qsTypographyShortcuts\)/u)
  assert.match(
    unoConfig,
    /sans:\s*'var\(--qs-font-sans,\s*"Noto Sans SC"\)'/u,
  )
  assert.match(
    unoConfig,
    /mono:\s*'var\(--qs-font-mono,\s*"Noto Sans Mono",\s*"Noto Sans SC"\)'/u,
  )
})

test('响应式表单、表头与结构化数据角色符合已确认规格', () => {
  const formControl = readShortcut('qs-type-form-control')
  const tableHeader = readShortcut('qs-type-table-header')
  const data = readShortcut('qs-type-data')
  const dataEmphasis = readShortcut('qs-type-data-emphasis')
  const formHelp = readShortcut('qs-type-form-help')
  const tag = readShortcut('qs-type-tag')
  const statusTag = readShortcut('qs-type-status-tag')

  assert.match(formControl, /\[font-size:var\(--qs-type-size-md,1rem\)\]/u)
  assert.match(formControl, /\[line-height:var\(--qs-type-leading-md,1\.5rem\)\]/u)
  assert.match(formControl, /md:\[font-size:var\(--qs-type-size-sm,0\.875rem\)\]/u)
  assert.match(formControl, /md:\[line-height:var\(--qs-type-leading-sm,1\.25rem\)\]/u)

  assert.match(tableHeader, /\[font-size:0\.8125rem\]/u)
  assert.match(tableHeader, /\[line-height:1\.125rem\]/u)
  assert.match(tableHeader, /\[font-weight:var\(--qs-type-weight-semibold,600\)\]/u)
  assert.match(tableHeader, /text-muted-foreground/u)

  assert.match(data, /\bfont-mono\b/u)
  assert.match(data, /\[font-weight:var\(--qs-type-weight-regular,400\)\]/u)
  assert.match(data, /tabular-nums/u)
  assert.match(dataEmphasis, /\bfont-mono\b/u)
  assert.match(dataEmphasis, /\[font-weight:var\(--qs-type-weight-medium,500\)\]/u)
  assert.match(dataEmphasis, /tabular-nums/u)

  assert.match(formHelp, /text-muted-foreground/u)
  assert.match(tag, /\[font-weight:var\(--qs-type-weight-medium,500\)\]/u)
  assert.match(statusTag, /\[font-weight:var\(--qs-type-weight-semibold,600\)\]/u)
})

test('应用级 Fa 与 Arco bridge 只映射已确认的排版指标', () => {
  const bridge = readMarkedSection(
    globalStyles,
    '/* qs-typography-bridge:start */',
    '/* qs-typography-bridge:end */',
  )

  for (const slot of [
    'button',
    'label',
    'form-label',
    'form-description',
    'form-message',
    'form-control',
    'input',
    'textarea',
    'input-group-control',
    'select-trigger',
    'tag',
    'badge',
    'table',
    'table-cell',
    'table-head',
    'table-footer',
    'dialog-title',
    'dialog-description',
    'sheet-title',
    'sheet-description',
  ]) {
    assert.match(bridge, new RegExp(`\\[data-slot="${slot}"\\]`, 'u'))
  }

  for (const arcoSelector of [
    '\\.arco-btn:not\\(\\.arco-btn-size-mini\\)',
    '\\.arco-btn-size-mini',
    '\\.arco-form-item-label',
    '\\.arco-form-item-extra',
    '\\.arco-form-item-message',
    '\\.arco-input',
    '\\.arco-textarea',
    '\\.arco-tag',
    '\\.arco-modal-title',
    '\\.arco-modal-body',
  ]) {
    assert.match(bridge, new RegExp(arcoSelector, 'u'))
  }

  const miniButtonRule = readRuleContaining(
    bridge,
    '(?:^|,)\\s*\\.arco-btn-size-mini\\s*(?:,|$)',
    'font-family',
  )
  const tagRule = readRuleContaining(
    bridge,
    '\\[data-slot="tag"\\]:not\\(\\.qs-type-status-tag\\)',
    'font-family',
  )
  const statusTagRule = readRuleContaining(
    bridge,
    '\\[data-slot="tag"\\]\\.qs-type-status-tag',
    'font-family',
  )

  assert.doesNotMatch(miniButtonRule, /font-size|line-height/u)
  assert.match(tagRule, /font-weight:\s*var\(--qs-type-weight-medium\)/u)
  assert.doesNotMatch(tagRule, /--qs-type-weight-semibold/u)
  assert.match(statusTagRule, /font-weight:\s*var\(--qs-type-weight-semibold\)/u)

  assert.match(bridge, /color:\s*oklch\(var\(--muted-foreground\)\)/u)
  assert.match(bridge, /color:\s*oklch\(var\(--destructive\)\)/u)
  assert.doesNotMatch(bridge, /#[\da-f]{3,8}\b/iu)
  assert.doesNotMatch(
    bridge,
    /^\s*(padding|height|width|background|border|box-shadow|transition)\s*:/mu,
  )
})

test('共享基础组件通过稳定 data-slot 接入应用级排版 bridge', () => {
  const expectedSlots = new Map([
    ['badge', 'badge'],
    ['button', 'button'],
    ['dialogDescription', 'dialog-description'],
    ['dialogTitle', 'dialog-title'],
    ['formControl', 'form-control'],
    ['formDescription', 'form-description'],
    ['formLabel', 'form-label'],
    ['formMessage', 'form-message'],
    ['input', 'input'],
    ['label', 'label'],
    ['selectTrigger', 'select-trigger'],
    ['sheetDescription', 'sheet-description'],
    ['sheetTitle', 'sheet-title'],
    ['table', 'table'],
    ['tableCell', 'table-cell'],
    ['tableFooter', 'table-footer'],
    ['tableHead', 'table-head'],
    ['tag', 'tag'],
    ['textarea', 'textarea'],
  ])

  for (const [component, slot] of expectedSlots) {
    assert.match(
      sharedComponentSources[component],
      new RegExp(`data-slot="${slot}"`, 'u'),
      `${component} 缺少稳定 data-slot="${slot}"`,
    )
  }

  // 状态字重只能由业务调用点显式声明，基础 Tag 不得根据 variant 自动推断。
  assert.doesNotMatch(
    sharedComponentSources.tag,
    /\bqs-type-status-tag\b/u,
  )
})

test('共享组件移除与全局语义角色冲突的局部排版 utility', () => {
  assert.match(
    sharedComponentSources.pageHeader,
    /\bqs-type-page-title\b/u,
  )
  assert.match(
    sharedComponentSources.pageHeader,
    /\bqs-type-description\b/u,
  )
  assert.doesNotMatch(sharedComponentSources.pageHeader, /\btext-2xl\b/u)
  assert.doesNotMatch(
    sharedComponentSources.pageHeader,
    /\btext-secondary-foreground\/50\b/u,
  )

  for (const component of ['formItem', 'label', 'dialogTitle']) {
    assert.doesNotMatch(
      sharedComponentSources[component],
      /\bleading-none\b/u,
      `${component} 仍覆盖全局行高`,
    )
  }
})
