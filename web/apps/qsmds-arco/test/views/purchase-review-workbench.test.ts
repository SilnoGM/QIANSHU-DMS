import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 审核工作台契约使用 Node runner。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ref } from 'vue'
import { buildReviewQuery, countReviewViews } from '../../src/views/workbenches/purchase-reviews/logic'

test('审核工作台已通过采用服务端合并状态分页，搜索去除首尾空格', () => {
  assert.deepEqual(buildReviewQuery('APPROVED', '  PO/12  ', 3, 20), { view: 'all', reviewView: 'APPROVED', keyword: 'PO/12', page: 3, pageSize: 20 })
  assert.equal(buildReviewQuery('PENDING_REVIEW', '', 1, 20).keyword, undefined)
})
test('审核视图计数合并已确认和已完成，不将全部数加入', () => {
  assert.deepEqual(countReviewViews([{ value: 'ALL', count: 10 }, { value: 'PENDING_REVIEW', count: 2 }, { value: 'CONFIRMED', count: 3 }, { value: 'COMPLETED', count: 4 }, { value: 'CANCELLED', count: 1 }]), { PENDING_REVIEW: 2, APPROVED: 7, CANCELLED: 1 })
  assert.deepEqual(countReviewViews([]), { PENDING_REVIEW: 0, APPROVED: 0, CANCELLED: 0 })
})
test('工作台审核完成刷新列表与计数，详情抽屉不提供资金或凭证写入', async () => {
  const source = await readFile(new URL('../../src/views/workbenches/purchase-reviews/index.vue', import.meta.url), 'utf8')
  assert.match(source, /auth\('purchase-orders:read'\)/u)
  assert.match(source, /auth\('purchase-orders:review'\)/u)
  assert.match(source, /<PurchaseOrderReviewModal[\s\S]*?@detail-updated="refresh"/u)
  assert.match(source, /:can-manage-payment="false"/u)
  assert.match(source, /:can-attach-document="false"/u)
  assert.match(source, /epoch !== account.authEpoch/u)
})

test('旧身份的列表响应不回写，最后一页审核后自动回到有效页', async () => {
  const source = await readFile(new URL('../../src/views/workbenches/purchase-reviews/index.vue', import.meta.url), 'utf8')
  const start = source.indexOf('async function load():')
  const body = source.slice(start, source.indexOf('async function loadCounts()', start))
  let resolveResponse: (value: unknown) => void = () => {}
  const account = { authEpoch: 1 }
  const items = ref<unknown[]>([])
  const page = ref(3)
  const calls: number[] = []
  let deferred = true
  const context = {
    AbortController,
    account,
    items,
    page,
    pageSize: ref(20),
    keyword: ref(''),
    status: ref('PENDING_REVIEW'),
    canRead: ref(true),
    loading: ref(false),
    error: ref(''),
    total: ref(0),
    buildReviewQuery,
    getPurchaseOrderApiFailure: () => ({ message: 'failed' }),
    purchaseOrdersApi: { list: async (query: { page: number }) => {
      calls.push(query.page)
      if (deferred) {
        return await new Promise((resolve) => {
          resolveResponse = resolve
        })
      }
      return { data: { items: query.page === 3 ? [] : [{ id: 'remaining' }], total: 21 } }
    } },
  }
  const load = runInNewContext(ts.transpileModule(`let listController = null; ${body}; load`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context) as () => Promise<void>
  const pending = load()
  account.authEpoch = 2
  resolveResponse({ data: { items: [{ id: 'old-user' }], total: 1 } })
  await pending
  assert.deepEqual(items.value, [])
  deferred = false
  await load()
  assert.equal(page.value, 2)
  assert.deepEqual(calls, [3, 3, 2])
  assert.deepEqual(items.value, [{ id: 'remaining' }])
})
