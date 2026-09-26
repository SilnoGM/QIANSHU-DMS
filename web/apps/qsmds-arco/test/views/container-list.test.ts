import type { ComputedRef } from 'vue'
import type { ContainerBatchDto } from '../../src/api/generated/types.gen'
import type { QsGenericTableColumn } from '../../src/components/business/QsGenericTable/logic'
import type { DictionaryCatalog } from '../../src/dictionary-catalog/types'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 与柜次领域测试保持一致，执行真实页面脚本验证字典异步回填。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { computed, effectScope, ref, watch } from 'vue'
import { parse } from 'vue/compiler-sfc'
import { resolveDictionaryCatalogValue } from '../../src/dictionary-catalog/options'
import { formatContainerMeasurement } from '../../src/views/workbenches/containers/display.logic'

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
  const state = scope.run(() => runInNewContext(ts.transpileModule(`${script}; ({ columns, create })`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, {
    computed,
    ref,
    watch,
    formatContainerMeasurement,
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
  })) as { columns: ComputedRef<QsGenericTableColumn<ContainerBatchDto>[]>, create: (payload: unknown) => Promise<void> }
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
  assert.deepEqual(Array.from(columns, column => column.id), ['containerBatchNo', 'containerBatchName', 'loadingDate', 'warehouse', 'quantities', 'totals', 'remark'])
  assert.ok(columns.every(column => column.defaultVisible !== false))
  assert.notEqual(columns.find(column => column.id === 'containerBatchNo')!.copyable, true)
  const row = { itemCount: 10, shipmentCount: 8, packageCountTotal: 15, grossWeightKgTotal: '1173.400', volumeCaiTotal: '25.135', chargeableVolumeCaiTotal: 27 } as ContainerBatchDto
  assert.equal(columns.find(column => column.id === 'quantities')!.accessorFn!(row, 0), '10 8')
  assert.equal(columns.find(column => column.id === 'totals')!.accessorFn!(row, 0), '1173 kg 25.14 材')
  assert.equal(columns.find(column => column.id === 'totals')!.accessorFn!({ ...row, grossWeightKgTotal: null, volumeCaiTotal: null, chargeableVolumeCaiTotal: null }, 0), 'containerPage.unknown containerPage.unknown')
})
