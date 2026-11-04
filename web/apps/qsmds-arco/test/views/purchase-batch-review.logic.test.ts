import type {
  PurchaseOrderDetailDto,
  PurchaseOrderImageDraftDto,
  PurchaseOrderListItemDto,
} from '../../src/api/generated/types.gen'
import type {
  PurchaseBatchItemState,
  PurchaseBatchItemStatus,
} from '../../src/views/workbenches/purchase-reviews/batch-review.logic'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 批量审核纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  createPurchaseBatchItem,
  isPurchaseBatchAuthError,
  isPurchaseBatchImageStaleError,
  isPurchaseBatchRetryableError,
  isPurchaseBatchSelectionDisabled,
  PURCHASE_BATCH_REVIEW_LIMIT,
  reconcilePurchaseBatchSelection,
  resolvePurchaseBatchActions,
  resolvePurchaseBatchPageSelection,
  resolvePurchaseBatchSelectedPageIds,
  summarizePurchaseBatch,
} from '../../src/views/workbenches/purchase-reviews/batch-review.logic'

function order(
  id: string,
  overrides: Partial<PurchaseOrderListItemDto> = {},
): PurchaseOrderListItemDto {
  return {
    id,
    orderNo: `PO/TEST-${id}`,
    orderStatus: 'PENDING_REVIEW',
    purchaseTotalAmount: '100.00',
    ...overrides,
  } as PurchaseOrderListItemDto
}

function draft(id = 'draft-1'): PurchaseOrderImageDraftDto {
  return {
    id,
    purchaseOrderId: 'order-1',
    orderVersion: 1,
    isCurrent: true,
    generatedAt: '2026-11-03T00:00:00.000Z',
    generatedBy: { id: 'user-1', displayName: '审核员', avatarUrl: null },
    contentUrl: `/api/purchase-orders/order-1/order-image-drafts/${id}/content`,
  } as PurchaseOrderImageDraftDto
}

function detail(id = 'order-1'): PurchaseOrderDetailDto {
  return {
    id,
    orderNo: `PO/TEST-${id}`,
    orderStatus: 'PENDING_REVIEW',
    version: 3,
  } as PurchaseOrderDetailDto
}

function item(
  status: PurchaseBatchItemStatus,
  overrides: Partial<PurchaseBatchItemState> = {},
): PurchaseBatchItemState {
  return {
    ...createPurchaseBatchItem(order('order-1')),
    status,
    ...overrides,
  }
}

test('批量审核单次上限固定为 20 单', () => {
  assert.equal(PURCHASE_BATCH_REVIEW_LIMIT, 20)
})

test('达到 20 单后只禁用未选中行，非待审核行始终禁用', () => {
  const selected = new Map<string, PurchaseOrderListItemDto>()
  for (let index = 0; index < PURCHASE_BATCH_REVIEW_LIMIT; index += 1) {
    const current = order(`order-${index}`)
    selected.set(current.id, current)
  }

  assert.equal(isPurchaseBatchSelectionDisabled(selected, order('order-0')), false)
  assert.equal(isPurchaseBatchSelectionDisabled(selected, order('order-20')), true)
  assert.equal(isPurchaseBatchSelectionDisabled(selected, order('cancelled', { orderStatus: 'CANCELLED' })), true)

  const cancelled = order('cancelled', { orderStatus: 'CANCELLED' })
  const withCancelled = new Map(selected)
  withCancelled.set(cancelled.id, cancelled)
  assert.equal(isPurchaseBatchSelectionDisabled(withCancelled, cancelled), false)

  const belowLimit = new Map([...selected].slice(0, 19))
  assert.equal(isPurchaseBatchSelectionDisabled(belowLimit, order('order-19')), false)
})

test('选择同步跨页保留快照、已选失效项仍可取消，并在超过 20 时标记 limited', () => {
  const firstPage = [order('a'), order('b')]
  let selected = reconcilePurchaseBatchSelection(new Map(), firstPage, { a: true, b: true }).selected
  assert.deepEqual([...selected.keys()], ['a', 'b'])

  const secondPage = [order('b'), order('c')]
  const second = reconcilePurchaseBatchSelection(selected, secondPage, { a: true, b: true, c: true })
  selected = second.selected
  assert.deepEqual([...selected.keys()], ['a', 'b', 'c'])
  assert.equal(second.limited, false)

  const cancelled = reconcilePurchaseBatchSelection(selected, [order('a', { orderStatus: 'CANCELLED' }), order('b')], {
    a: true,
    b: true,
    c: true,
  })
  assert.deepEqual([...cancelled.selected.keys()], ['a', 'b', 'c'])
  assert.equal(isPurchaseBatchSelectionDisabled(cancelled.selected, cancelled.selected.get('a')!), false)

  const nineteen = Array.from({ length: 19 }, (_, index) => order(`cap-${index}`))
  const selectedNineteen = new Map(nineteen.map(current => [current.id, current]))
  const overflow = reconcilePurchaseBatchSelection(
    selectedNineteen,
    [order('cap-19'), order('cap-20')],
    Object.fromEntries([...nineteen, order('cap-19'), order('cap-20')].map(current => [current.id, true])),
  )
  assert.equal(overflow.selected.size, 20)
  assert.equal(overflow.limited, true)
})

test('勾选本页计划按剩余名额补足，跳过已选与非待审核行', () => {
  const page = [
    order('a'),
    order('b'),
    order('cancelled', { orderStatus: 'CANCELLED' }),
    ...Array.from({ length: 25 }, (_, index) => order(`p-${index}`)),
  ]

  const empty = resolvePurchaseBatchPageSelection(page, new Map())
  assert.equal(empty.count, 20)
  assert.equal(empty.remaining, 20)
  assert.deepEqual(empty.ids.slice(0, 2), ['a', 'b'])
  assert.equal(empty.ids.includes('cancelled'), false)
  assert.equal(empty.ids.length, 20)

  const selectedFifteen = new Map(
    Array.from({ length: 15 }, (_, index) => {
      const current = order(`selected-${index}`)
      return [current.id, current] as const
    }),
  )
  const fillFive = resolvePurchaseBatchPageSelection(page, selectedFifteen)
  assert.equal(fillFive.count, 5)
  assert.equal(fillFive.remaining, 5)
  assert.deepEqual(fillFive.ids, ['a', 'b', 'p-0', 'p-1', 'p-2'])

  const selectedTwenty = new Map(
    Array.from({ length: 20 }, (_, index) => {
      const current = order(`full-${index}`)
      return [current.id, current] as const
    }),
  )
  const full = resolvePurchaseBatchPageSelection(page, selectedTwenty)
  assert.equal(full.count, 0)
  assert.equal(full.remaining, 0)
  assert.deepEqual(full.ids, [])

  const shortPage = [order('x'), order('y')]
  const short = resolvePurchaseBatchPageSelection(shortPage, new Map())
  assert.equal(short.count, 2)
  assert.deepEqual(short.ids, ['x', 'y'])
})

test('取消勾选本页只返回当前页已选订单，保留其他页选择', () => {
  const page = [order('a'), order('b'), order('c')]
  const selected = new Map([
    ['a', order('a')],
    ['c', order('c', { orderStatus: 'CANCELLED' })],
    ['other-page', order('other-page')],
  ])

  assert.deepEqual(resolvePurchaseBatchSelectedPageIds(page, selected), ['a', 'c'])
  assert.deepEqual(resolvePurchaseBatchSelectedPageIds(page, new Map()), [])
  assert.deepEqual(resolvePurchaseBatchSelectedPageIds([], selected), [])
})

test('批量状态汇总区分生成失败、审核失败、已审核和失效', () => {
  const summary = summarizePurchaseBatch([
    item('idle'),
    item('generating'),
    item('ready', { previewLoaded: true }),
    item('generate-failed'),
    item('reviewing'),
    item('approved'),
    item('review-failed', { previewLoaded: true }),
    item('blocked'),
  ])

  assert.deepEqual({
    total: summary.total,
    active: summary.active,
    idle: summary.idle,
    generating: summary.generating,
    ready: summary.ready,
    generateFailed: summary.generateFailed,
    reviewing: summary.reviewing,
    approved: summary.approved,
    reviewFailed: summary.reviewFailed,
    blocked: summary.blocked,
    generated: summary.generated,
    failed: summary.failed,
    reviewable: summary.reviewable,
    loaded: summary.loaded,
    remainingPreview: summary.remainingPreview,
  }, {
    total: 8,
    active: 7,
    idle: 1,
    generating: 1,
    ready: 1,
    generateFailed: 1,
    reviewing: 1,
    approved: 1,
    reviewFailed: 1,
    blocked: 1,
    generated: 4,
    failed: 2,
    reviewable: 2,
    loaded: 2,
    remainingPreview: 0,
  })
})

test('主按钮按未生成、失败重试、全部成功依次切换，确认必须等图片加载完成', () => {
  const idleActions = resolvePurchaseBatchActions(summarizePurchaseBatch([
    item('idle'),
    item('idle'),
  ]))
  assert.equal(idleActions.primary, 'generate')
  assert.equal(idleActions.primaryCompleted, 0)
  assert.equal(idleActions.total, 2)
  assert.equal(idleActions.confirmEnabled, false)

  const retryActions = resolvePurchaseBatchActions(summarizePurchaseBatch([
    item('ready', { previewLoaded: true }),
    item('generate-failed'),
  ]))
  assert.equal(retryActions.primary, 'retry')
  assert.equal(retryActions.primaryFailed, 1)
  assert.equal(retryActions.confirmEnabled, false)

  const unloadedActions = resolvePurchaseBatchActions(summarizePurchaseBatch([
    item('ready', { previewLoaded: true }),
    item('ready', { previewLoaded: false }),
  ]))
  assert.equal(unloadedActions.primary, 'regenerate')
  assert.equal(unloadedActions.confirmEnabled, false)
  assert.equal(unloadedActions.remainingPreview, 1)

  const readyActions = resolvePurchaseBatchActions(summarizePurchaseBatch([
    item('ready', { previewLoaded: true }),
    item('ready', { previewLoaded: true }),
  ]))
  assert.equal(readyActions.primary, 'regenerate')
  assert.equal(readyActions.confirmEnabled, true)
  assert.equal(readyActions.confirmCount, 2)
  assert.equal(readyActions.confirmLabel, 'all')

  const remainingActions = resolvePurchaseBatchActions(summarizePurchaseBatch([
    item('approved'),
    item('ready', { previewLoaded: true }),
  ]))
  assert.equal(remainingActions.confirmEnabled, true)
  assert.equal(remainingActions.confirmCount, 1)
  assert.equal(remainingActions.confirmLabel, 'remaining')
  assert.equal(remainingActions.primary, 'regenerate')
  assert.equal(remainingActions.total, 1)
  assert.equal(remainingActions.primaryCompleted, 1)
})

test('审核失败但图片仍可用时允许只重试未审核项', () => {
  const summary = summarizePurchaseBatch([
    item('review-failed', { previewLoaded: true }),
    item('approved'),
    item('ready', { previewLoaded: true }),
  ])

  assert.equal(summary.reviewable, 2)
  assert.equal(summary.reviewFailed, 1)
  assert.equal(summary.canConfirm, true)
  assert.equal(resolvePurchaseBatchActions(summary).confirmLabel, 'remaining')
})

test('审核失效或认证失败不自动重试，网络与存储错误可重试', () => {
  assert.equal(isPurchaseBatchAuthError('FORBIDDEN'), true)
  assert.equal(isPurchaseBatchAuthError('PASSWORD_CHANGE_REQUIRED'), true)
  assert.equal(isPurchaseBatchAuthError('PURCHASE_ORDER_STATE_CHANGED'), false)

  assert.equal(isPurchaseBatchRetryableError(null), true)
  assert.equal(isPurchaseBatchRetryableError('MEDIA_STORAGE_UNAVAILABLE'), true)
  assert.equal(isPurchaseBatchRetryableError('PURCHASE_ORDER_STATE_CHANGED'), true)
  assert.equal(isPurchaseBatchRetryableError('PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE'), false)
  assert.equal(isPurchaseBatchRetryableError('PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS'), false)

  assert.equal(isPurchaseBatchImageStaleError('PURCHASE_ORDER_IMAGE_STALE'), true)
  assert.equal(isPurchaseBatchImageStaleError('PURCHASE_ORDER_IMAGE_UNAVAILABLE'), true)
  assert.equal(isPurchaseBatchImageStaleError('PURCHASE_ORDER_IMAGE_MARKS_REQUIRED'), true)
  assert.equal(isPurchaseBatchImageStaleError('PURCHASE_ORDER_DOCUMENT_ALREADY_EXISTS'), false)
})

test('新建批次项保留订单快照且初始无草稿、无预览', () => {
  const source = order('order-1')
  const created = createPurchaseBatchItem(source)

  assert.equal(created.order, source)
  assert.equal(created.status, 'idle')
  assert.equal(created.detail, null)
  assert.equal(created.draft, null)
  assert.equal(created.previewUrl, null)
  assert.equal(created.previewLoaded, false)
  assert.equal(created.error, null)
  assert.equal(created.note, null)
})

test('已生成批次项可携带详情与草稿用于审核请求', () => {
  const ready = item('ready', {
    detail: detail('order-1'),
    draft: draft('draft-1'),
    previewLoaded: true,
  })

  assert.equal(ready.detail?.version, 3)
  assert.equal(ready.draft?.id, 'draft-1')
  assert.equal(ready.previewLoaded, true)
})
