import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// eslint-disable-next-line test/no-import-node-test -- 编译并挂载真实分组组件，验证桌面与移动端的集成契约。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import * as grouping from '../../src/components/business/QsGenericTable/grouping'
import * as logic from '../../src/components/business/QsGenericTable/logic'

interface HostNode {
  tag: string
  parent: HostNode | null
  children: HostNode[]
  props: Record<string, any>
  text: string
  querySelector: () => null
}
interface DataRow { id: string, name: string, amount: number, entries?: DataRow[] }

const { createRenderer, defineComponent, h, nextTick, normalizeClass, reactive, ref } = Vue
const node = (tag = '', text = ''): HostNode => ({ tag, text, parent: null, children: [], props: {}, querySelector: () => null })
const flatten = (current: HostNode): HostNode[] => [current, ...current.children.flatMap(flatten)]
const requireDependency = createRequire(new URL('../../../../packages/components/package.json', import.meta.url))
const folder = new URL('../../src/components/business/QsGenericTable/', import.meta.url)
const faTableUrl = new URL('../../../../packages/components/src/basic/table/index.vue', import.meta.url)
const compiledCache = new Map<string, string>()
const element = (tag: string) => defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(tag, attrs, slots.default?.()) })
const primitives = Object.fromEntries(Object.entries({ Table: 'table', TableBody: 'tbody', TableCaption: 'caption', TableCell: 'td', TableEmpty: 'td', TableFooter: 'tfoot', TableHead: 'th', TableHeader: 'thead', TableRow: 'tr' }).map(([name, tag]) => [name, element(tag)]))

function loadComponents(isNarrow: ReturnType<typeof ref<boolean>>) {
  const components = new Map<string, any>()
  const load = (url: URL): any => {
    if (components.has(url.href)) {
      return components.get(url.href)
    }
    let code = compiledCache.get(url.href)
    if (!code) {
      const compiled = compileScript(parse(readFileSync(url, 'utf8')).descriptor, { id: url.pathname, inlineTemplate: true })
      code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
      compiledCache.set(url.href, code)
    }
    const result = { exports: {} as Record<string, any> }
    runInNewContext(code, {
      ...Vue,
      exports: result.exports,
      module: result,
      useI18n: ({ messages }: any) => ({ t: (key: string, values: Record<string, unknown> = {}) => String(messages['zh-cn'][key]).replace(/\{(\w+)\}/gu, (_, name) => String(values[name])) }),
      require: (specifier: string) => {
        if (specifier === '@vueuse/core') {
          return { useMediaQuery: () => isNarrow, useResizeObserver: () => {} }
        }
        if (specifier === './logic') {
          return logic
        }
        if (specifier === './grouping') {
          return grouping
        }
        if (specifier === './GroupHeader.vue' || specifier === './GroupedMobileRows.vue') {
          return { __esModule: true, default: load(new URL(specifier, url)) }
        }
        if (specifier === '#utils') {
          return { cn: (...values: unknown[]) => normalizeClass(values) }
        }
        if (specifier === './table') {
          return primitives
        }
        if (specifier === './table/utils') {
          return { valueUpdater: (value: any, target: any) => {
            target.value = typeof value === 'function' ? value(target.value) : value
          } }
        }
        if (specifier.includes('/checkbox')) {
          return { Checkbox: element('input') }
        }
        if (specifier.includes('/radio-group')) {
          return { RadioGroup: element('div'), RadioGroupItem: element('input') }
        }
        if (specifier.endsWith('.vue')) {
          return { __esModule: true, default: element(specifier.includes('/button/') ? 'button' : 'span') }
        }
        return requireDependency(specifier)
      },
    })
    components.set(url.href, result.exports.default)
    return result.exports.default
  }
  return { QsGenericTable: load(new URL('index.vue', folder)), FaTable: load(faTableUrl) }
}

function fixture(options: { grouped?: boolean, narrow?: boolean, total?: number, unit?: string } = {}) {
  const isNarrow = ref(options.narrow ?? false)
  const { QsGenericTable, FaTable } = loadComponents(isNarrow)
  const entries: DataRow[] = [{ id: 'first', name: '项目 A', amount: 10 }, { id: 'second', name: '项目 B', amount: 20 }]
  const data: DataRow[] = options.grouped === false
    ? entries
    : [
        { id: 'group-a', name: '第一组', amount: 1000, entries },
        { id: 'group-b', name: '第二组', amount: 2000, entries: [{ id: 'first', name: '项目 C', amount: 30 }] },
      ]
  const props = reactive({
    columns: [{ id: 'name', accessorKey: 'name', title: '名称' }, { id: 'amount', accessorKey: 'amount', title: '金额', summary: { type: 'sum' } }],
    data,
    rowKey: 'id',
    grouping: options.grouped === false ? undefined : { getRows: (row: DataRow) => row.entries ?? [], getLabel: (row: DataRow) => row.name },
    page: 2,
    pageSize: 20,
    expanded: true as true | Record<string, boolean>,
    total: options.total,
    paginationUnit: options.unit,
    addable: false,
    searchable: false,
    showColumnSettings: false,
  })
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: tag => node(tag),
    createText: text => node('', text),
    createComment: () => node(),
    insert: (child, parent, anchor) => {
      if (child.parent) {
        child.parent.children.splice(child.parent.children.indexOf(child), 1)
      }
      child.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    },
    remove: (child) => { child.parent?.children.splice(child.parent.children.indexOf(child), 1) },
    parentNode: child => child.parent,
    nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] ?? null,
    patchProp: (target, key, _previous, value) => { target.props[key] = value },
    setText: (target, text) => { target.text = text },
    setElementText: (target, text) => {
      target.text = text
      target.children = []
    },
  })
  const root = node('root')
  const app = renderer.createApp(defineComponent({ setup: () => () => h(QsGenericTable, {
    ...props,
    'onUpdate:expanded': (expanded: typeof props.expanded) => { props.expanded = expanded },
  }, {
    'group-header': (scope: any) => h('span', { 'data-group-scope': scope }, scope.row.name),
    'actions': (scope: any) => h('button', { 'data-action-scope': scope }, '执行'),
    'mobile-row': (scope: any) => h('div', { 'data-mobile-scope': scope }, scope.row.name),
    'summary-amount': (scope: any) => h('strong', { 'data-summary': scope.value }, String(scope.value)),
  }) }))
  app.component('FaTable', FaTable)
  for (const name of ['FaButton', 'FaIcon', 'FaEmpty', 'FaInput', 'FaTag', 'FaPopover', 'FaAlert']) {
    app.component(name, element(name === 'FaButton' ? 'button' : 'span'))
  }
  app.component('FaDrawer', defineComponent({ setup: () => () => null }))
  app.component('FaPagination', element('nav'))
  app.mount(root)
  const nodes = () => flatten(root)
  const actionScopes = () => nodes().filter(item => item.props['data-action-scope']).map(item => item.props['data-action-scope'])
  const groupScopes = () => nodes().filter(item => item.props['data-group-scope']).map(item => item.props['data-group-scope'])
  const summary = () => nodes().find(item => item.props['data-summary'] !== undefined)?.props['data-summary']
  const pagination = () => nodes().find(item => item.tag === 'nav')!
  const toggle = (label: string) => {
    const button = nodes().find(item => item.tag === 'button' && item.props['aria-label']?.endsWith(label))
    assert.ok(button, `应存在 ${label} 的折叠按钮`)
    button.props.onClick({ stopPropagation: () => {} })
  }
  return { app, props, isNarrow, nodes, actionScopes, groupScopes, summary, pagination, toggle }
}

function actionIdentity(scope: any) {
  return { row: scope.row.id, group: scope.group?.id, groupIndex: scope.groupIndex, index: scope.index, rowNumber: scope.rowNumber }
}

test('普通模式继续平铺 data，桌面与手机保持原来的行号与操作语义', async () => {
  const f = fixture({ grouped: false })
  try {
    const expected = [
      { row: 'first', group: undefined, groupIndex: undefined, index: 0, rowNumber: 21 },
      { row: 'second', group: undefined, groupIndex: undefined, index: 1, rowNumber: 22 },
    ]
    assert.deepEqual(f.actionScopes().map(actionIdentity), expected)
    assert.equal(f.groupScopes().length, 0)
    assert.equal(f.summary(), 30)
    assert.equal(f.pagination().props['text-templates'].total(2), '共 2 条')
    f.isNarrow.value = true
    await nextTick()
    assert.deepEqual(f.actionScopes().map(actionIdentity), expected)
    assert.equal(f.groupScopes().length, 0)
  }
  finally { f.app.unmount() }
})

test('分组父标题不进入 actions，子行携带准确的组身份、组内索引与跨页组号', async () => {
  const f = fixture()
  try {
    const expected = [
      { row: 'first', group: 'group-a', groupIndex: 0, index: 0, rowNumber: 21 },
      { row: 'second', group: 'group-a', groupIndex: 0, index: 1, rowNumber: 21 },
      { row: 'first', group: 'group-b', groupIndex: 1, index: 0, rowNumber: 22 },
    ]
    assert.deepEqual(f.actionScopes().map(actionIdentity), expected)
    assert.deepEqual(f.groupScopes().map(scope => [scope.row.id, scope.index, scope.rowNumber]), [['group-a', 0, 21], ['group-b', 1, 22]])
    f.isNarrow.value = true
    await nextTick()
    assert.deepEqual(f.actionScopes().map(actionIdentity), expected)
    assert.deepEqual(f.nodes().filter(item => item.props['data-mobile-scope']).map(item => actionIdentity(item.props['data-mobile-scope'])), expected)
  }
  finally { f.app.unmount() }
})

test('桌面和手机共用折叠状态，当前页汇总只计子行且不随折叠变化', async () => {
  const f = fixture()
  try {
    assert.equal(f.summary(), 60)
    f.toggle('第一组')
    await nextTick()
    assert.deepEqual(f.actionScopes().map(scope => scope.group.id), ['group-b'])
    assert.equal(f.summary(), 60)
    f.isNarrow.value = true
    await nextTick()
    assert.deepEqual(f.actionScopes().map(scope => scope.group.id), ['group-b'])
    assert.equal(f.summary(), 60)
    f.toggle('第一组')
    await nextTick()
    assert.equal(f.actionScopes().length, 3)
    f.isNarrow.value = false
    await nextTick()
    assert.equal(f.actionScopes().length, 3)
    assert.equal(f.summary(), 60)
  }
  finally { f.app.unmount() }
})

test('分组分页默认按根组数量计数，并接受服务端组总数和自定义单位', async () => {
  const f = fixture()
  try {
    assert.equal(f.pagination().props.total, 2)
    assert.equal(f.pagination().props['text-templates'].total(2), '共 2 组')
    assert.equal(f.pagination().props['text-templates'].sizes(20), '20 组/页')
    f.props.total = 83
    f.props.paginationUnit = '单'
    await nextTick()
    assert.equal(f.pagination().props.total, 83)
    assert.equal(f.pagination().props['text-templates'].total(83), '共 83 单')
    assert.equal(f.pagination().props['text-templates'].sizes(20), '20 单/页')
    assert.equal(f.actionScopes().length, 3, '分页由调用方按整组切片，组件不截断组内明细')
  }
  finally { f.app.unmount() }
})
