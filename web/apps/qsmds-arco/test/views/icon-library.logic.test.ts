// eslint-disable-next-line test/no-import-node-test -- 与本文件的 Node.js runner 共用测试上下文类型。
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 图标示例页的本地交互通过 Node.js runner 验证。
import test from 'node:test'
import { effectScope } from 'vue'
import { useIconLibrary } from '../../src/views/component_library/basic/components/icon-library.logic'

const catalog = [
  { name: 'qs-sales-order', label: '销售订单', category: '订单', usages: ['待办订单', '全部订单'], source: 'brand' },
  { name: 'qs-fund-transactions', label: '资金账户流水', category: '财务', usages: ['收支明细'], source: 'brand' },
  { name: 'app-search', label: '搜索', category: '通用图标', usages: ['菜单搜索'], source: 'local' },
  { name: 'i-lucide:check', label: '确认', category: '通用图标', usages: ['完成操作'], source: 'iconify' },
] as const

function createLibrary(context: TestContext) {
  const scope = effectScope()
  const library = scope.run(() => useIconLibrary(catalog))!
  context.after(() => scope.stop())
  return { library, scope }
}

test('图标页初始立即展示完整清单，并采用品牌菜单的 24px 尺寸', (context) => {
  const { library } = createLibrary(context)
  assert.equal(library.filteredIcons.value.length, 4)
  assert.equal(library.selectedIcon.value?.name, 'qs-sales-order')
  assert.equal(library.size.value, 24)
  assert.equal(library.previewState.value, 'default')
  assert.equal(library.brandCount.value, 2)
  assert.equal(library.generalCount.value, 2)
})

test('搜索覆盖技术名称、中文名称、业务分组与中文用途，忽略大小写和首尾空白', (context) => {
  const { library } = createLibrary(context)
  for (const query of [' QS-SALES ', '销售', '待办', '订单']) {
    library.query.value = query
    assert.deepEqual(library.filteredIcons.value.map(icon => icon.name), ['qs-sales-order'])
  }
  library.query.value = '收支'
  assert.equal(library.selectedIcon.value?.name, 'qs-fund-transactions')
  library.query.value = 'LUCIDE:CHECK'
  assert.equal(library.selectedIcon.value?.name, 'i-lucide:check')
})

test('品牌和通用类型与搜索共同生效，通用同时包含本地和 Iconify 图标', (context) => {
  const { library } = createLibrary(context)
  library.setTypeFilter('general')
  assert.deepEqual(library.filteredIcons.value.map(icon => icon.name), ['app-search', 'i-lucide:check'])
  library.query.value = '菜单'
  assert.deepEqual(library.filteredIcons.value.map(icon => icon.name), ['app-search'])
  library.setTypeFilter('brand')
  assert.deepEqual(library.filteredIcons.value, [])
  library.resetFilters()
  assert.equal(library.filteredIcons.value.length, 4)
  assert.equal(library.typeFilter.value, 'all')
  assert.equal(library.query.value, '')
})

test('筛选隐藏当前选中图标时展示首个可见结果，空结果不保留失效详情', (context) => {
  const { library } = createLibrary(context)
  library.selectIcon('qs-fund-transactions')
  assert.equal(library.selectedIcon.value?.name, 'qs-fund-transactions')
  library.query.value = '确认'
  assert.equal(library.selectedIcon.value?.name, 'i-lucide:check')
  library.query.value = 'missing-icon'
  assert.equal(library.selectedIcon.value, undefined)
  assert.equal(library.usageCode.value, '')
  library.resetFilters()
  assert.ok(library.selectedIcon.value)
  library.selectIcon('not-in-catalog')
  assert.ok(library.selectedIcon.value)
})

test('20、24、32px 的使用代码匹配实际 FaIcon 尺寸，预览背景不污染代码', (context) => {
  const { library } = createLibrary(context)
  for (const [size, className] of [[20, 'size-5'], [24, 'size-6'], [32, 'size-8']] as const) {
    library.size.value = size
    assert.equal(library.usageCode.value, `<FaIcon name="qs-sales-order" class="${className}" />`)
  }
  const code = library.usageCode.value
  library.previewState.value = 'selected'
  assert.equal(library.usageCode.value, code)
})

test('复制成功只写入当前选中图标的代码，并提供成功状态', async (context) => {
  const { library } = createLibrary(context)
  const written: string[] = []
  library.selectIcon('app-search')
  library.size.value = 24
  const result = await library.copySelectedCode(async (value) => {
    written.push(value)
  })
  assert.equal(result, 'copied')
  assert.deepEqual(written, ['<FaIcon name="app-search" class="size-6" />'])
  assert.equal(library.copyStatus.value, 'copied')
  assert.equal(library.copyPending.value, false)
})

test('剪贴板不可用和权限拒绝均返回可恢复的错误状态，不抛出未处理异常', async (context) => {
  const { library } = createLibrary(context)
  assert.equal(await library.copySelectedCode(), 'unavailable')
  assert.equal(library.copyStatus.value, 'unavailable')
  assert.equal(await library.copySelectedCode(async () => {
    throw new Error('Permission denied')
  }), 'failed')
  assert.equal(library.copyStatus.value, 'failed')
  assert.equal(library.copyPending.value, false)
  assert.equal(await library.copySelectedCode(async () => {}), 'copied')
})

test('连续点击不会重复复制，等待期间改变图标不会给新选择显示旧成功状态', async (context) => {
  const { library } = createLibrary(context)
  let complete!: () => void
  let writes = 0
  const writer = async () => {
    writes += 1
    await new Promise<void>((resolve) => {
      complete = resolve
    })
  }
  const pending = library.copySelectedCode(writer)
  assert.equal(library.copyPending.value, true)
  assert.equal(await library.copySelectedCode(writer), 'ignored')
  library.selectIcon('app-search')
  complete()
  assert.equal(await pending, 'ignored')
  assert.equal(writes, 1)
  assert.equal(library.copyStatus.value, 'idle')
  assert.equal(library.copyPending.value, false)
})

test('空结果及离开页面后不发布复制成功反馈', async (context) => {
  const { library, scope } = createLibrary(context)
  library.query.value = 'missing-icon'
  assert.equal(await library.copySelectedCode(async () => {
    assert.fail('Unexpected clipboard write')
  }), 'ignored')
  library.resetFilters()
  let complete!: () => void
  const pending = library.copySelectedCode(async () => {
    await new Promise<void>((resolve) => {
      complete = resolve
    })
  })
  scope.stop()
  complete()
  assert.equal(await pending, 'ignored')
  assert.equal(library.copyStatus.value, 'idle')
})

test('原生搜索清空输入后产生的 undefined 值恢复完整清单', (context) => {
  const { library } = createLibrary(context)
  library.query.value = '收支'
  assert.equal(library.filteredIcons.value.length, 1)
  library.query.value = undefined
  assert.equal(library.filteredIcons.value.length, catalog.length)
})

test('简中、繁中、英文拥有相同文案键与完整数量占位符', () => {
  function messageEntries(value: Record<string, unknown>, prefix = ''): [string, string][] {
    return Object.entries(value).flatMap(([key, message]) => typeof message === 'string'
      ? [[`${prefix}${key}`, message]]
      : messageEntries(message as Record<string, unknown>, `${prefix}${key}.`))
  }
  const messages = ['zh-cn', 'zh-tw', 'en'].map(locale => new Map(messageEntries(JSON.parse(readFileSync(
    new URL(`../../src/locales/lang/icon-library/${locale}.json`, import.meta.url),
    'utf8',
  )))))
  for (const translated of messages) {
    assert.deepEqual([...translated.keys()].sort(), [...messages[0].keys()].sort())
    for (const [key, value] of messages[0]) {
      const placeholders = value.match(/\{\w+\}/gu) ?? []
      assert.deepEqual(translated.get(key)?.match(/\{\w+\}/gu) ?? [], placeholders, key)
      assert.ok(translated.get(key)?.trim(), key)
    }
  }
})
