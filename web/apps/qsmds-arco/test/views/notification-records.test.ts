import type { NotificationDeliveryDto, NotificationRecordDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 通知记录查询与摘要使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildRecordListQuery,
  buildRecordRouteQuery,
  parseRecordRouteQuery,
} from '../../src/views/system/notifications/records-query'
import {
  canCancelRecord,
  recordDeliverySummary,
  sortRecordDeliveries,
} from '../../src/views/system/notifications/records.logic'
import {
  deliveryStatusLabel,
  notificationStatusLabel,
} from '../../src/views/system/notifications/records.presentation'

function record(overrides: Partial<NotificationRecordDto> = {}): NotificationRecordDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    eventType: 'PURCHASE_REVIEW_PENDING',
    eventLabel: '采购审核',
    domain: 'PURCHASE',
    sourceType: 'PURCHASE_ORDER',
    sourceId: 'CG-20261109-0001',
    priority: 'NORMAL',
    status: 'PENDING',
    templateKey: 'purchase.review.pending',
    expiresAt: null,
    publishedAt: '2026-11-09T02:00:00.000Z',
    completedAt: null,
    requestedByName: '张三',
    channels: ['IN_APP', 'ASSISTANT'],
    inAppItemCount: 3,
    inAppUnreadCount: 2,
    deliveryCounts: { ACCEPTED: 4, FAILED: 1, PENDING: 2 },
    ...overrides,
  }
}

function delivery(
  id: string,
  status: NotificationDeliveryDto['status'],
): NotificationDeliveryDto {
  return {
    id,
    recipientName: id,
    targetName: null,
    status,
    attemptCount: 1,
    templateKey: 'purchase.review.pending',
    failureCode: status === 'FAILED' ? 'ACCOUNT_OFFLINE' : null,
    failureMessage: null,
    acceptedAt: null,
  }
}

test('记录筛选从 URL 读取合法值并丢弃非法枚举', () => {
  const parsed = parseRecordRouteQuery({
    page: '2',
    pageSize: '50',
    status: 'FAILED',
    domain: 'FINANCE',
    channel: 'ASSISTANT',
    priority: 'HIGH',
    eventType: 'FUND_ACCOUNT_REVERSED',
    keyword: '  张三  ',
    from: '2026-11-01',
    to: '2026-11-09',
  })

  assert.deepEqual(parsed, {
    page: 2,
    pageSize: 50,
    status: 'FAILED',
    domain: 'FINANCE',
    channel: 'ASSISTANT',
    priority: 'HIGH',
    eventType: 'FUND_ACCOUNT_REVERSED',
    keyword: '张三',
    from: '2026-11-01',
    to: '2026-11-09',
  })

  assert.deepEqual(parseRecordRouteQuery({
    page: '0',
    pageSize: '200',
    status: 'UNKNOWN',
    domain: 'OTHER',
    channel: 'EMAIL',
    priority: 'LOW',
    from: '2026-11-09',
    to: '2026-11-01',
  }), {
    page: 1,
    pageSize: 20,
    status: null,
    domain: null,
    channel: null,
    priority: null,
    eventType: null,
    keyword: '',
    from: null,
    to: null,
  })
})

test('列表请求把上海自然日转换为带时区的 ISO 边界', () => {
  assert.deepEqual(buildRecordListQuery({
    page: 1,
    pageSize: 20,
    status: 'PARTIAL',
    domain: 'PURCHASE',
    channel: 'IN_APP',
    priority: 'HIGH',
    eventType: 'PURCHASE_REVIEW_PENDING',
    keyword: '张三',
    from: '2026-11-01',
    to: '2026-11-09',
  }), {
    page: 1,
    pageSize: 20,
    status: 'PARTIAL',
    domain: 'PURCHASE',
    channel: 'IN_APP',
    priority: 'HIGH',
    eventType: 'PURCHASE_REVIEW_PENDING',
    keyword: '张三',
    publishedFrom: '2026-11-01T00:00:00+08:00',
    publishedTo: '2026-11-09T23:59:59.999+08:00',
  })
})

test('URL 构建只保留非默认筛选', () => {
  assert.deepEqual(buildRecordRouteQuery({
    page: 1,
    pageSize: 20,
    status: null,
    domain: null,
    channel: null,
    priority: null,
    eventType: null,
    keyword: '',
    from: null,
    to: null,
  }), {})

  assert.deepEqual(buildRecordRouteQuery({
    page: 3,
    pageSize: 100,
    status: 'FAILED',
    domain: 'FINANCE',
    channel: null,
    priority: null,
    eventType: 'FUND_ACCOUNT_REVERSED',
    keyword: 'CG-1',
    from: '2026-11-01',
    to: '2026-11-09',
  }), {
    page: '3',
    pageSize: '100',
    status: 'FAILED',
    domain: 'FINANCE',
    eventType: 'FUND_ACCOUNT_REVERSED',
    keyword: 'CG-1',
    from: '2026-11-01',
    to: '2026-11-09',
  })
})

test('投递摘要同时表达站内未读和小助理失败', () => {
  assert.deepEqual(recordDeliverySummary(record()), [
    { channel: 'IN_APP', label: '站内 3 人', tone: 'warning', detail: '未读 2' },
    { channel: 'ASSISTANT', label: '小助理 7 人', tone: 'danger', detail: '失败 1' },
  ])
})

test('只有待发且仍有待发送交付时才允许取消', () => {
  assert.equal(canCancelRecord(record(), true), true)
  assert.equal(canCancelRecord(record({ status: 'COMPLETED' }), true), false)
  assert.equal(canCancelRecord(record({ deliveryCounts: { ACCEPTED: 1 } }), true), false)
  assert.equal(canCancelRecord(record(), false), false)
})

test('详情交付把失败和待处理排在前面', () => {
  const result = sortRecordDeliveries([
    delivery('accepted', 'ACCEPTED'),
    delivery('pending', 'PENDING'),
    delivery('failed', 'FAILED'),
    delivery('skipped', 'SKIPPED'),
  ])

  assert.deepEqual(result.map(item => item.id), ['failed', 'pending', 'skipped', 'accepted'])
})

test('通知与交付状态覆盖 SENDING 和 ACCEPTED', () => {
  assert.equal(notificationStatusLabel('PARTIAL'), '部分')
  assert.equal(deliveryStatusLabel('SENDING'), '发送中')
  assert.equal(deliveryStatusLabel('ACCEPTED'), '已接受')
})
