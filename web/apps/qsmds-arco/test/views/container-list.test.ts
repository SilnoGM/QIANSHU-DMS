import type { ComputedRef, Ref } from 'vue'
import type { ContainerBatchDto } from '../../src/api/generated/types.gen'
import type { QsGenericTableColumn } from '../../src/components/business/QsGenericTable/logic'
import type { DictionaryCatalog } from '../../src/dictionary-catalog/types'
import type { ContainerBindingFilter } from '../../src/views/workbenches/containers/binding-stats.logic'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 与柜次领域测试保持一致，执行真实页面脚本验证字典异步回填。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, ref, watch } from 'vue'
import { parse } from 'vue/compiler-sfc'
import { withStatusSwitchCounts } from '../../src/components/business/QsStatusSwitchToolbar/logic'
import { resolveDictionaryCatalogValue } from '../../src/dictionary-catalog/options'
import { containerBindingFilterDefinitions, resolveContainerBindingStats } from '../../src/views/workbenches/containers/binding-stats.logic'
import { formatContainerMeasurement, formatContainerWeight } from '../../src/views/workbenches/containers/display.logic'

interface ContainerListState {
  readonly bindingCounts: Ref<{ value: ContainerBindingFilter, count: number }[]>
  readonly bindingState: Ref<ContainerBindingFilter>
  readonly bindingTabs: ComputedRef<{ value: string, label: string, count?: number }[]>
  readonly columns: ComputedRef<QsGenericTableColumn<ContainerBatchDto>[]>
  readonly create: (payload: unknown) => Promise<void>
  readonly page: Ref<number>
  readonly query: ComputedRef<{ page: number, pageSize: number, search?: string, warehouseValue?: string, bindingState: ContainerBindingFilter }>
  readonly selectBindingState: (value: string) => void
}

async function fixture(options: { permissions?: string[], created?: { id: string } | null } = {}) {
  const source = await readFile(new URL('../../src/views/workbenches/containers/index.vue', import.meta.url), 'utf8')
  const script = parse(source).descriptor.scriptSetup!.content.replace(/^import.*$/gm, '')
  const warehouse = {
    catalog: ref<DictionaryCatalog | null>(null),
    loading: ref(true),
    error: ref<string | null>(null),
    missing: ref(false),
    resolve: (value: string) => resolveDictionaryCatalogValue(warehouse.catalog.value, value),
  }
  const scope = effectScope()
  const navigations: { name: string, params: { id: string } }[] = []
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}; ({ columns, create, bindingTabs, selectBindingState, bindingState, bindingCounts, page, query })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    ref,
    watch,
    formatContainerMeasurement,
    formatContainerWeight,
    resolveContainerBindingStats,
    containerBindingFilterDefinitions,
    withStatusSwitchCounts,
    defineOptions: () => {},
    useI18n: () => ({ t: (key: string) => key === 'containerManagement.volumeUnit' ? '材' : key }),
    useAppAuth: () => ({ auth: (permission: string) => !options.permissions || options.permissions.includes(permission) }),
    useRouter: () => ({ push: (target: typeof navigations[number]) => navigations.push(target) }),
    useRoute: () => ({ name: 'qsPurchaseTransportContainers' }),
    useAppAccountStore: () => ({ authEpoch: 1 }),
    useQsToast: () => ({ success: () => {} }),
    useDictionaryCatalog: () => warehouse,
    useContainerResource: () => ({ data: ref(null), loading: ref(false), error: ref('') }),
    useContainerMutation: () => ({ submitting: ref(false), retryOnly: ref(false), error: ref(''), fieldErrors: ref({}), submit: async () => options.created ?? null }),
    onActivated: () => {},
    onDeactivated: () => {},
  })) as unknown as ContainerListState
  return { state, warehouse, navigations, dispose: () => scope.stop() }
}

test('创建柜次成功后统一进入详情页，创建失败不跳转', async (context) => {
  for (const [options, expected] of [
    [{ created: { id: 'new-container' } }, 'qsPurchaseTransportContainerDetail'],
    // 拥有导入相关权限也不再直接进解析页；解析入口留在详情页内，权限不影响创建后的去向。
    [{ created: { id: 'new-container' }, permissions: ['container-batches:read', 'container-batches:create', 'container-batches:update', 'purchase-orders:read'] }, 'qsPurchaseTransportContainerDetail'],
    [{ created: null }, null],
  ] as const) {
    const f = await fixture(options)
    context.after(f.dispose)
    await f.state.create({ sourceFileId: 'source' })
    assert.equal(f.navigations.length, expected ? 1 : 0)
    if (expected) {
      assert.equal(f.navigations[0]?.name, expected)
      assert.equal(f.navigations[0]?.params.id, 'new-container')
    }
  }
})

test('柜次仓库在字典后到达时更新中文名称，加载和失败不冒充稳定值为展示名称', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  const column = f.state.columns.value.find(column => column.id === 'warehouse')!
  const row = { warehouseValue: 'B5' } as ContainerBatchDto
  const display = () => column.accessorFn!(row, 0)
  assert.equal(display(), 'containerPage.warehouseLoading')
  await Promise.resolve()
  f.warehouse.loading.value = false
  f.warehouse.catalog.value = {
    code: 'mainland.warehouse',
    enabled: true,
    items: [{ value: 'B5', label: '顺联航-深圳南浦科技园B5仓', effectiveEnabled: true }],
  } as DictionaryCatalog
  assert.equal(display(), '顺联航-深圳南浦科技园B5仓')
  f.warehouse.catalog.value = null
  f.warehouse.error.value = 'Unavailable'
  assert.equal(display(), 'containerPage.warehouseUnavailable')
})

test('柜次列表保留指定汇总数据，系统编号不提供复制', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  const columns = f.state.columns.value
  assert.deepEqual(Array.from(columns, column => column.id), ['containerBatchNo', 'containerBatchName', 'loadingDate', 'warehouse', 'quantities', 'bindingStats', 'totals', 'remark'])
  assert.ok(columns.every(column => column.defaultVisible !== false))
  assert.notEqual(columns.find(column => column.id === 'containerBatchNo')!.copyable, true)
  const row = { itemCount: 10, boundItemCount: 8, shipmentCount: 8, packageCountTotal: 15, grossWeightKgTotal: '1173.400', volumeCaiTotal: '25.135', chargeableVolumeCaiTotal: 27 } as ContainerBatchDto
  assert.equal(columns.find(column => column.id === 'quantities')!.accessorFn!(row, 0), '10 8')
  assert.equal(columns.find(column => column.id === 'bindingStats')!.accessorFn!(row, 0), '8/10 [containerPage.bindingPartial]')
  assert.equal(columns.find(column => column.id === 'bindingStats')!.align, 'right')
  assert.equal(columns.find(column => column.id === 'bindingStats')!.accessorFn!({ ...row, boundItemCount: 10 }, 0), '10/10 [containerPage.bindingAll]')
  assert.equal(columns.find(column => column.id === 'bindingStats')!.accessorFn!({ ...row, boundItemCount: 0 }, 0), '0/10 [containerPage.bindingNone]')
  assert.equal(columns.find(column => column.id === 'bindingStats')!.accessorFn!({ ...row, boundItemCount: 0, itemCount: 0 }, 0), '0/0 [containerPage.bindingEmpty]')
  assert.equal(columns.find(column => column.id === 'totals')!.accessorFn!(row, 0), '1173.4 kg 25.14 材')
  assert.equal(columns.find(column => column.id === 'totals')!.accessorFn!({ ...row, grossWeightKgTotal: null, volumeCaiTotal: null, chargeableVolumeCaiTotal: null }, 0), 'containerPage.unknown containerPage.unknown')
})

test('柜次绑定页签按全部/完全/部分/未绑定排序并直接使用列表返回的计数', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  assert.deepEqual(f.state.bindingTabs.value.map(item => [item.value, item.label, item.count]), [
    ['ALL', 'containerPage.bindingFilterAll', 0],
    ['FULL', 'containerPage.bindingAll', 0],
    ['PARTIAL', 'containerPage.bindingPartial', 0],
    ['NONE', 'containerPage.bindingNone', 0],
  ])
  // 计数忽略页签自身的维度，由服务端与列表同快照下发；切换页签不会改变数字。
  f.state.bindingCounts.value = [
    { value: 'ALL', count: 41 },
    { value: 'FULL', count: 16 },
    { value: 'PARTIAL', count: 23 },
    { value: 'NONE', count: 2 },
  ]
  assert.deepEqual(f.state.bindingTabs.value.map(item => item.count), [41, 16, 23, 2])
})

test('切换绑定页签写入查询参数并重置到第一页，未知取值不改变状态', async (context) => {
  const f = await fixture()
  context.after(f.dispose)
  assert.equal(f.state.query.value.bindingState, 'ALL')
  f.state.page.value = 3
  f.state.selectBindingState('FULL')
  assert.equal(f.state.bindingState.value, 'FULL')
  assert.equal(f.state.page.value, 1)
  assert.equal(f.state.query.value.page, 1)
  assert.equal(f.state.query.value.bindingState, 'FULL')
  f.state.page.value = 2
  f.state.selectBindingState('EMPTY')
  assert.equal(f.state.bindingState.value, 'FULL')
  assert.equal(f.state.page.value, 2)
  f.state.selectBindingState('FULL')
  assert.equal(f.state.page.value, 2)
})
