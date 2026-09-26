import type { SlhBillListItemDto } from '../../src/api/generated/types.gen'
import type { QsGenericTableColumn } from '../../src/components/business/QsGenericTable/logic'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 执行真实列表页脚本验证查询与行点击行为。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, ref, shallowRef, watch } from 'vue'
import { parse } from 'vue/compiler-sfc'
import { containerFailure } from '../../src/views/workbenches/containers/use-container-resource'
import { buildSlhBillListQuery, normalizeSlhBillAmountBound, resolveSlhBillAmountRange } from '../../src/views/workbenches/slh-bills/list.logic'

interface SlhBillListPageState {
  amountError: { value: string | null }
  items: { value: SlhBillListItemDto[] }
  onRowClick: (row: SlhBillListItemDto, index: number, event: unknown) => void
  payableMaxDraft: { value: string }
  payableMinDraft: { value: string }
  query: { value: Record<string, unknown> }
  search: () => void
  total: { value: number }
  columns: { value: QsGenericTableColumn<SlhBillListItemDto>[] }
}

async function fixture(options: { permissions?: string[] } = {}) {
  const source = await readFile(new URL('../../src/views/workbenches/slh-bills/index.vue', import.meta.url), 'utf8')
  const script = parse(source).descriptor.scriptSetup!.content.replace(/^import.*$/gm, '')
  const queries: Record<string, unknown>[] = []
  const navigations: { name?: string, params?: Record<string, unknown> }[] = []
  const state = runInNewContext(ts.transpileModule(`${script}\n;({ amountError, columns, items, onRowClick, payableMaxDraft, payableMinDraft, query, search, total })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    AbortController,
    buildSlhBillListQuery,
    computed,
    containerFailure,
    defineOptions: () => {},
    normalizeSlhBillAmountBound,
    onBeforeUnmount: () => {},
    ref,
    resolveSlhBillAmountRange,
    shallowRef,
    slhBillsApi: {
      list: async (query: Record<string, unknown>) => {
        queries.push(query)
        return { data: { items: [], page: 1, pageSize: 20, total: 0 } }
      },
    },
    useAppAccountStore: () => ({ authEpoch: 1 }),
    useAppAuth: () => ({ auth: (permission: string) => options.permissions === undefined || options.permissions.includes(permission) }),
    useCurrencyCatalog: () => ({ currencies: ref([]) }),
    useI18n: () => ({ t: (key: string) => key }),
    useRouter: () => ({ push: (target: { name?: string, params?: Record<string, unknown> }) => navigations.push(target) }),
    watch,
  }) as SlhBillListPageState
  return { navigations, queries, state }
}

const row = { id: 'bill-1', slhBillNo: 'CBILL/202608-01' } as SlhBillListItemDto

test('无读取权限时不请求账单列表', async () => {
  const f = await fixture({ permissions: [] })
  await Promise.resolve()
  assert.deepEqual(f.queries, [])
  assert.equal(f.state.items.value.length, 0)
  assert.equal(f.state.total.value, 0)
})

test('金额区间非法时本地拦截，合法时随查询条件提交', async (context) => {
  const f = await fixture({ permissions: ['slh-bills:read'] })
  context.after(() => f.state.items.value = [])
  await Promise.resolve()
  assert.equal(f.queries.length, 1)
  f.state.payableMinDraft.value = '1.234'
  f.state.search()
  assert.equal(f.state.amountError.value, 'format')
  assert.equal(f.queries.length, 1)
  f.state.payableMinDraft.value = '100'
  f.state.payableMaxDraft.value = '10'
  f.state.search()
  assert.equal(f.state.amountError.value, 'order')
  assert.equal(f.queries.length, 1)
  f.state.payableMaxDraft.value = '100.50'
  f.state.search()
  assert.equal(f.state.amountError.value, null)
  assert.equal(f.queries.length, 2)
  assert.equal(f.queries[1]?.payableMin, '100')
  assert.equal(f.queries[1]?.payableMax, '100.50')
  assert.equal(f.state.query.value.state, 'active')
  assert.equal(new Set(f.state.columns.value.map(column => column.id)).size, f.state.columns.value.length)
})

test('行点击进入详情，行内按钮与复制按钮不触发导航', async () => {
  const f = await fixture({ permissions: ['slh-bills:read'] })
  await Promise.resolve()
  f.state.onRowClick(row, 0, { target: { closest: () => ({}) } })
  assert.equal(f.navigations.length, 0)
  f.state.onRowClick(row, 0, { target: { closest: () => null } })
  f.state.onRowClick(row, 1, { target: null })
  // 跨 realm 的对象直接 deepEqual 会比较原型，这里只比对导航目标字段。
  assert.deepEqual(f.navigations.map(item => [item.name, item.params?.id]), [
    ['qsFinanceBillReconciliationSlhBillDetail', 'bill-1'],
    ['qsFinanceBillReconciliationSlhBillDetail', 'bill-1'],
  ])
})
