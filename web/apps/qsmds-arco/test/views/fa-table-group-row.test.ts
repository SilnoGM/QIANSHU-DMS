import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// eslint-disable-next-line test/no-import-node-test -- 使用真实 SFC 与 TanStack 行模型验证表格基础渲染。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createRenderer, defineComponent, h, nextTick, normalizeClass, reactive } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

interface HostNode { tag: string, parent: HostNode | null, children: HostNode[], props: Record<string, any>, text: string }
interface DataRow { id: string, name: string, amount?: number, group?: boolean, entries?: DataRow[] }

const node = (tag = '', text = ''): HostNode => ({ tag, text, parent: null, children: [], props: {} })
const flatten = (current: HostNode): HostNode[] => [current, ...current.children.flatMap(flatten)]
const requireComponentDependency = createRequire(new URL('../../../../packages/components/package.json', import.meta.url))
const source = readFileSync(new URL('../../../../packages/components/src/basic/table/index.vue', import.meta.url), 'utf8')
const compiled = compileScript(parse(source).descriptor, { id: 'fa-table-group-test', inlineTemplate: true })
const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const element = (tag: string) => defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(tag, attrs, slots.default?.()) })
const primitives = Object.fromEntries(Object.entries({ Table: 'table', TableBody: 'tbody', TableCaption: 'caption', TableCell: 'td', TableEmpty: 'td', TableFooter: 'tfoot', TableHead: 'th', TableHeader: 'thead', TableRow: 'tr' }).map(([name, tag]) => [name, element(tag)]))
const moduleResult = { exports: {} as Record<string, any> }
runInNewContext(code, {
  exports: moduleResult.exports,
  module: moduleResult,
  require: (specifier: string) => {
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
    return requireComponentDependency(specifier)
  },
})

function fixture(overrides: Record<string, any> = {}, includeGroupSlot = true) {
  const scopes: any[] = []
  const cells: string[] = []
  const actions: string[] = []
  const changes: any[] = []
  const data: DataRow[] = [
    { id: 'group-a', name: '第一组', group: true, entries: [{ id: 'child-a', name: '子项 A', amount: 10 }] },
    { id: 'group-empty', name: '空组', group: true, entries: [] },
    { id: 'normal', name: '普通行', amount: 20 },
  ]
  const props = reactive({
    columns: [
      { header: '信息', columns: [{ accessorKey: 'name', header: '名称' }, { accessorKey: 'amount', header: '金额' }] },
      { id: 'actions', header: '操作', cell: '' },
    ],
    data,
    rowKey: 'id',
    tree: true,
    defaultExpanded: true,
    getSubRows: (row: DataRow) => row.entries,
    groupRow: (row: any) => row.original.group === true,
    ...overrides,
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
  const app = renderer.createApp(defineComponent({ setup: () => () => h(moduleResult.exports.default, {
    ...props,
    'onUpdate:expanded': (value: unknown) => changes.push(value),
  }, {
    ...(includeGroupSlot
      ? { 'group-header': (scope: any) => {
          scopes.push(scope)
          return h('button', { 'data-group-id': scope.row.id, 'onClick': scope.toggle }, scope.row.original.name)
        } }
      : {}),
    'cell-name': (scope: any) => {
      cells.push(scope.row.id)
      return scope.value
    },
    'cell-actions': (scope: any) => {
      actions.push(scope.row.id)
      return h('button', { 'data-action-id': scope.row.id }, '操作')
    },
  }) }))
  app.mount(root)
  return { app, props, scopes, cells, actions, changes, nodes: () => flatten(root), rows: () => flatten(root).find(item => item.tag === 'tbody')!.children.filter(item => item.tag === 'tr') }
}

test('分组标题跨全部可见叶列，空组仍显示，只有明细进入普通单元格及操作插槽', () => {
  const f = fixture()
  try {
    assert.deepEqual(f.rows().map(row => row.children.filter(child => child.tag === 'td').length), [1, 3, 1, 3])
    assert.deepEqual(f.scopes.map(scope => [scope.row.id, scope.index, scope.colspan, scope.expanded]), [['group-a', 0, 3, true], ['group-empty', 1, 3, true]])
    assert.deepEqual(f.cells, ['child-a', 'normal'])
    assert.deepEqual(f.actions, ['child-a', 'normal'])
    assert.equal(f.rows()[0].children.find(child => child.tag === 'td')?.props.colspan, 3)
  }
  finally { f.app.unmount() }
})

test('列隐藏后分组标题 colspan 跟随可见叶列变化', async () => {
  const f = fixture()
  try {
    assert.ok(f.scopes[0], '分组标题应得到完整的 table 作用域')
    f.scopes[0].table.getColumn('amount').toggleVisibility(false)
    await nextTick()
    assert.equal(f.rows()[0].children.find(child => child.tag === 'td')?.props.colspan, 2)
    assert.equal(f.scopes.at(-1).colspan, 2)
  }
  finally { f.app.unmount() }
})

test('分组按钮遵循受控展开：先通知父层，父层更新后才展开子行', async () => {
  const f = fixture({ expanded: {} })
  try {
    const button = f.nodes().find(item => item.props['data-group-id'] === 'group-a')
    assert.ok(button, '折叠的组也应显示分组标题')
    assert.equal(f.rows().length, 3)
    button.props.onClick()
    await nextTick()
    assert.equal(f.changes[0]['group-a'], true)
    assert.equal(f.rows().length, 3)
    f.props.expanded = f.changes[0]
    await nextTick()
    assert.equal(f.rows().length, 4)
    assert.equal(f.scopes.filter(scope => scope.row.id === 'group-a').at(-1).expanded, true)
  }
  finally { f.app.unmount() }
})

test('未配置分组判定时保留普通树表与单元格渲染', () => {
  const f = fixture({ groupRow: undefined })
  try {
    assert.deepEqual(f.rows().map(row => row.children.filter(child => child.tag === 'td').length), [3, 3, 3, 3])
    assert.deepEqual(f.cells, ['group-a', 'child-a', 'group-empty', 'normal'])
    assert.deepEqual(f.actions, ['group-a', 'child-a', 'group-empty', 'normal'])
    assert.equal(f.scopes.length, 0)
  }
  finally { f.app.unmount() }
})

test('分组未提供标题插槽时也不会把组数据传给普通单元格或操作', () => {
  const f = fixture({}, false)
  try {
    assert.deepEqual(f.actions, ['child-a', 'normal'])
    assert.equal(f.rows()[0].children.filter(child => child.tag === 'td').length, 1)
  }
  finally { f.app.unmount() }
})
