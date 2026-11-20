import type { SalesOrderEditContextDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 销售订单编辑逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildSalesOrderInfoUpdatePayload,
  createSalesOrderInfoDraft,
  salesOrderInfoDraftChanged,
  salesOrderProductEditUnavailableReason,
} from '../../src/views/operations/sales-orders/sales-order-edit.logic'

function contextOf(overrides: Partial<SalesOrderEditContextDto> = {}): SalesOrderEditContextDto {
  return {
    salesOrderId: '11111111-1111-4111-8111-111111111111',
    orderNo: 'SO/20261120-00001',
    version: 7,
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PARTIALLY_PAID',
    customer: {
      name: '王小明',
      phone: '0912345678',
      fbName: null,
      lineName: null,
      countryRegion: { id: 'region-country', code: 'TW', name: '中国台湾' },
      provinceState: { id: 'region-province', code: 'TW-KHH', name: '高雄市' },
      city: { id: 'region-city', code: 'TW-KHH-01', name: '苓雅区' },
      addressDetail: '中正一路100号3楼',
      fullAddress: '中国台湾高雄市苓雅区中正一路100号3楼',
    },
    salesInfo: { orderDate: '2026-11-01', remark: '客户自提' },
    ...overrides,
  }
}

test('订单信息草稿同时回填客户、三级地区与出单信息', () => {
  const draft = createSalesOrderInfoDraft(contextOf({
    customer: { ...contextOf().customer, fbName: '小明', lineName: 'ming' },
  }))
  assert.equal(draft.region.countryRegionId, 'region-country')
  assert.equal(draft.region.cityId, 'region-city')
  assert.equal(draft.fbName, '小明')
  assert.equal(draft.lineName, 'ming')
  assert.equal(draft.orderDate, '2026-11-01')
  assert.equal(draft.remark, '客户自提')
  assert.equal(draft.reason, '')
})

test('一次保存同时提交客户与出单信息，并归一化原因与空白社交名称', () => {
  const context = contextOf()
  const draft = {
    ...createSalesOrderInfoDraft(context),
    phone: '  0933000111 ',
    fbName: '   ',
    orderDate: '2026-11-20',
    reason: '  客户更正电话 ',
  }
  const built = buildSalesOrderInfoUpdatePayload(context, draft)
  assert.equal(built.valid, true)
  if (!built.valid) {
    return
  }
  assert.equal(built.request.expectedVersion, 7)
  assert.equal(built.request.reason, '客户更正电话')
  assert.equal(built.request.customer.phone, '0933000111')
  assert.equal(built.request.customer.fbName, null)
  assert.equal(built.request.orderDate, '2026-11-20')
})

test('清空备注提交 null，非法日期与超长姓名整体拦下', () => {
  const context = contextOf()
  const cleared = buildSalesOrderInfoUpdatePayload(context, {
    ...createSalesOrderInfoDraft(context),
    remark: '   ',
    reason: '清空备注',
  })
  assert.equal(cleared.valid, true)
  if (cleared.valid) {
    assert.equal(cleared.request.remark, null)
  }

  const invalid = buildSalesOrderInfoUpdatePayload(context, {
    ...createSalesOrderInfoDraft(context),
    name: '客'.repeat(25),
    orderDate: '2026/11/20',
    region: { countryRegionId: null, provinceStateId: null, cityId: null },
    reason: '改名',
  })
  assert.equal(invalid.valid, false)
  if (!invalid.valid) {
    assert.ok(invalid.fieldErrors['customer.name'])
    assert.ok(invalid.fieldErrors.orderDate)
    assert.ok(invalid.fieldErrors['customer.cityId'])
  }
})

test('修改原因必填', () => {
  const context = contextOf()
  const built = buildSalesOrderInfoUpdatePayload(context, {
    ...createSalesOrderInfoDraft(context),
    reason: '   ',
  })
  assert.equal(built.valid, false)
  if (!built.valid) {
    assert.equal(built.fieldErrors.reason, '请填写本次修改原因')
  }
})

test('变更检测覆盖客户与出单信息两类字段，不把原因计入', () => {
  const context = contextOf()
  const draft = createSalesOrderInfoDraft(context)
  assert.equal(salesOrderInfoDraftChanged(context, draft), false)
  assert.equal(
    salesOrderInfoDraftChanged(context, { ...draft, reason: '只写了原因' }),
    false,
  )
  assert.equal(salesOrderInfoDraftChanged(context, { ...draft, phone: '0999' }), true)
  assert.equal(salesOrderInfoDraftChanged(context, { ...draft, orderDate: '2026-11-20' }), true)
  assert.equal(salesOrderInfoDraftChanged(context, { ...draft, remark: '新备注' }), true)
})

test('产品资格沿用已确认加海运前口径', () => {
  assert.equal(salesOrderProductEditUnavailableReason({
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'WAREHOUSE_ARRIVED',
  }), null)
  assert.equal(salesOrderProductEditUnavailableReason({
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'SEA_TRANSIT',
  }), '订单已进入海运或已签收，不能修改产品')
  assert.equal(salesOrderProductEditUnavailableReason({
    orderStatus: 'COMPLETED',
    fulfillmentStatus: 'SIGNED',
  }), '只有已确认订单可以修改产品')
})
