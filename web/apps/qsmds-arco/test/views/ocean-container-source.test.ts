import type { AxiosResponse } from 'axios'
import type { OperationsOceanContainerLineDto, PurchaseOrderDetailDto, SalesOrderDetailDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证来源抽屉先复核个人归属，再读取订单，取消后不能继续请求或回写。
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { useOceanContainerSource } from '../../src/views/operations/ocean-containers/use-ocean-container-source'

function deferred<T>() {
  let resolve!: (value: AxiosResponse<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<AxiosResponse<T>>((success, failure) => {
    resolve = success
    reject = failure
  })
  return { promise, resolve: (data: T) => resolve({ data } as AxiosResponse<T>), reject }
}
const line = (salesOrderId: string | null = 'sales-current', purchaseOrderId: string | null = 'purchase-current') => ({ id: 'line-1', containerBatchId: 'container-1', salesOrderId, purchaseOrderId } as OperationsOceanContainerLineDto)
const salesDetail = { id: 'sales-current' } as SalesOrderDetailDto
const purchaseDetail = { id: 'purchase-current' } as PurchaseOrderDetailDto
const request = { containerId: 'container-1', lineId: 'line-1', kind: 'sales' as const }
function setup() {
  const enabled = ref(true)
  const epoch = ref(1)
  const canViewSales = ref(true)
  const canViewPurchase = ref(true)
  const lines: { containerId: string, lineId: string, signal: AbortSignal, result: ReturnType<typeof deferred<OperationsOceanContainerLineDto>> }[] = []
  const sales: { id: string, signal: AbortSignal, result: ReturnType<typeof deferred<SalesOrderDetailDto>> }[] = []
  const purchases: { id: string, signal: AbortSignal, result: ReturnType<typeof deferred<PurchaseOrderDetailDto>> }[] = []
  const scope = effectScope()
  const state = scope.run(() => useOceanContainerSource(enabled, epoch, canViewSales, canViewPurchase, {
    item: (containerId, lineId, signal) => {
      const result = deferred<OperationsOceanContainerLineDto>()
      lines.push({ containerId, lineId, signal, result })
      return result.promise
    },
    sales: (id, signal) => {
      const result = deferred<SalesOrderDetailDto>()
      sales.push({ id, signal, result })
      return result.promise
    },
    purchase: (id, signal) => {
      const result = deferred<PurchaseOrderDetailDto>()
      purchases.push({ id, signal, result })
      return result.promise
    },
  }, '来源订单暂时无法查看'))!
  return { enabled, epoch, canViewSales, canViewPurchase, lines, sales, purchases, state, stop: () => scope.stop() }
}

test('销售和采购来源分别使用重新复核后的订单 ID，重开仍重新验证归属', async () => {
  const s = setup()
  const first = s.state.open(request)
  assert.equal(s.state.loading.value, true)
  assert.equal(s.sales.length, 0)
  assert.equal(s.lines[0].containerId, request.containerId)
  assert.equal(s.lines[0].lineId, request.lineId)
  s.lines[0].result.resolve(line())
  await Promise.resolve()
  assert.equal(s.sales[0].id, 'sales-current')
  s.sales[0].result.resolve(salesDetail)
  await first
  assert.equal(s.state.salesDetail.value, salesDetail)
  const second = s.state.open({ ...request, kind: 'purchase' })
  assert.equal(s.state.salesDetail.value, null)
  s.lines[1].result.resolve(line())
  await Promise.resolve()
  assert.equal(s.purchases[0].id, 'purchase-current')
  s.purchases[0].result.resolve(purchaseDetail)
  await second
  assert.equal(s.state.purchaseDetail.value, purchaseDetail)
  const retry = s.state.reload()
  assert.equal(s.lines.length, 3)
  assert.equal(s.state.purchaseDetail.value, null)
  s.lines[2].result.resolve(line(null, 'purchase-new'))
  await Promise.resolve()
  assert.equal(s.purchases[1].id, 'purchase-new')
  s.purchases[1].result.resolve({ id: 'purchase-new' } as PurchaseOrderDetailDto)
  await retry
  s.stop()
})

test('归属复核失败或关联已不存在时，不读取来源订单', async () => {
  const s = setup()
  const first = s.state.open(request)
  s.lines[0].result.reject({ status: 404 })
  await first
  assert.equal(s.state.error.value, '来源订单暂时无法查看')
  assert.equal(s.sales.length, 0)
  const second = s.state.open({ ...request, kind: 'purchase' })
  s.lines[1].result.resolve(line(null, null))
  await second
  assert.equal(s.state.error.value, '来源订单暂时无法查看')
  assert.equal(s.purchases.length, 0)
  s.stop()
})

test('关闭、失活、身份切换和撤权立即终止归属复核，不继续请求订单', async () => {
  for (const action of ['close', 'deactivate', 'identity', 'permission', 'dispose'] as const) {
    const s = setup()
    const pending = s.state.open(request)
    if (action === 'close') {
      s.state.close()
    }
    if (action === 'deactivate') {
      s.enabled.value = false
    }
    if (action === 'identity') {
      s.epoch.value++
    }
    if (action === 'permission') {
      s.canViewSales.value = false
    }
    if (action === 'dispose') {
      s.stop()
    }
    assert.equal(s.lines[0].signal.aborted, true, action)
    assert.equal(s.state.target.value, null, action)
    s.lines[0].result.resolve(line())
    await pending
    assert.equal(s.sales.length, 0, action)
    assert.equal(s.state.salesDetail.value, null, action)
    s.stop()
  }
})

test('撤销采购读取权限后不发起新请求，订单读取中撤权不能回填详情', async () => {
  const s = setup()
  s.canViewPurchase.value = false
  await s.state.open({ ...request, kind: 'purchase' })
  assert.equal(s.lines.length, 0)
  s.canViewPurchase.value = true
  const pending = s.state.open({ ...request, kind: 'purchase' })
  s.lines[0].result.resolve(line())
  await Promise.resolve()
  s.canViewPurchase.value = false
  assert.equal(s.purchases[0].signal.aborted, true)
  s.purchases[0].result.resolve(purchaseDetail)
  await pending
  assert.equal(s.state.purchaseDetail.value, null)
  assert.equal(s.state.target.value, null)
  s.stop()
})

test('切换来源后旧订单请求晚到不能覆盖新抽屉', async () => {
  const s = setup()
  const first = s.state.open(request)
  s.lines[0].result.resolve(line())
  await Promise.resolve()
  const second = s.state.open({ ...request, kind: 'purchase' })
  assert.equal(s.sales[0].signal.aborted, true)
  s.lines[1].result.resolve(line())
  await Promise.resolve()
  s.purchases[0].result.resolve(purchaseDetail)
  await second
  s.sales[0].result.resolve(salesDetail)
  await first
  assert.equal(s.state.target.value?.kind, 'purchase')
  assert.equal(s.state.purchaseDetail.value, purchaseDetail)
  assert.equal(s.state.salesDetail.value, null)
  s.stop()
})
