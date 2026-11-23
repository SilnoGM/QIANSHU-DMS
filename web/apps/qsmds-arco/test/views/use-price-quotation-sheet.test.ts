import type { PriceQuotationSheetRequestDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 核价单预览生命周期使用 Node.js 内置 runner。
import test, { after } from 'node:test'
import { effectScope, ref } from 'vue'

import { usePriceQuotationSheet } from '../../src/views/operations/purchase-orders/use-price-quotation-sheet'

const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL
after(() => {
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
})

function request(): PriceQuotationSheetRequestDto {
  return {
    productMode: 'CATALOG',
    supplierValue: 'SUPPLIER-A',
    orderDate: '2026-11-22',
    lines: [{
      lineType: 'CATALOG',
      productId: '11111111-1111-4111-8111-111111111111',
      expectedReferencePurchaseUnitPriceAmount: '1.00',
      actualPurchaseUnitPriceAmount: '1.00',
      quantity: 1,
      description: null,
    }],
  }
}

function fixture() {
  const epoch = ref(1)
  const calls: PriceQuotationSheetRequestDto[] = []
  const created: Blob[] = []
  const revoked: string[] = []
  const copied: Blob[] = []
  let nextUrl = 0
  let deferred: { resolve: (blob: Blob) => void, reject: (error: unknown) => void } | null = null
  URL.createObjectURL = (blob: Blob) => {
    created.push(blob)
    return `blob:preview-${++nextUrl}`
  }
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url)
  }
  const api = {
    generatePriceQuotationSheet: async (data: PriceQuotationSheetRequestDto) => {
      calls.push(data)
      return { data: new Blob(['png'], { type: 'image/png' }) }
    },
  }
  const scope = effectScope()
  const state = scope.run(() => usePriceQuotationSheet({
    epoch,
    copy: async (blob: Blob) => {
      copied.push(blob)
    },
  }, api))!
  return {
    state,
    scope,
    epoch,
    api,
    calls,
    created,
    revoked,
    copied,
    useDeferred: () => {
      api.generatePriceQuotationSheet = (_data: PriceQuotationSheetRequestDto, signal: AbortSignal) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        deferred = {
          resolve: blob => resolve({ data: blob }),
          reject,
        }
      })
      return () => deferred
    },
  }
}

test('打开后生成并保留当前预览，失效时释放 Blob URL', async () => {
  const f = fixture()
  await f.state.open(request())

  assert.equal(f.state.visible.value, true)
  assert.equal(f.state.generating.value, false)
  assert.equal(f.state.error.value, '')
  assert.deepEqual(f.calls, [request()])
  assert.equal(f.created.length, 1)
  assert.equal(f.state.previewUrl.value, 'blob:preview-1')
  assert.equal(f.state.previewBlob.value, f.created[0])

  f.state.markLoaded('blob:preview-1')
  assert.equal(f.state.imageLoaded.value, true)
  f.state.invalidate()
  assert.equal(f.state.visible.value, false)
  assert.equal(f.state.previewUrl.value, null)
  assert.deepEqual(f.revoked, ['blob:preview-1'])
  f.scope.stop()
})

test('失效后迟到的响应不会重新打开弹窗或泄漏旧预览', async () => {
  const f = fixture()
  const getDeferred = f.useDeferred()
  const opening = f.state.open(request())
  await Promise.resolve()
  f.state.invalidate()
  const deferred = getDeferred()
  assert.ok(deferred !== null)
  deferred.resolve(new Blob(['png'], { type: 'image/png' }))
  await opening

  assert.equal(f.state.visible.value, false)
  assert.equal(f.state.previewUrl.value, null)
  assert.equal(f.state.previewBlob.value, null)
  f.scope.stop()
})

test('复制只使用当前预览 Blob，没有预览时拒绝', async () => {
  const f = fixture()
  await assert.rejects(f.state.copy())
  await f.state.open(request())
  await f.state.copy()
  assert.deepEqual(f.copied, [f.state.previewBlob.value])
  f.scope.stop()
})

test('关闭会中止正在进行的生成', async () => {
  const f = fixture()
  f.useDeferred()
  const opening = f.state.open(request())
  await Promise.resolve()
  f.state.close()
  await opening
  assert.equal(f.state.visible.value, false)
  assert.equal(f.state.generating.value, false)
  assert.equal(f.state.previewUrl.value, null)
  f.scope.stop()
})
