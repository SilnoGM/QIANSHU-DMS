import type { SalesOrderEditContextDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 销售订单编辑逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildSalesOrderCustomerUpdatePayload,
  buildSalesOrderSalesInfoUpdatePayload,
  createSalesOrderCustomerDraft,
  createSalesOrderSalesInfoDraft,
  salesOrderCustomerDraftChanged,
  salesOrderProductEditUnavailableReason,
  salesOrderSalesInfoDraftChanged,
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

test('客户草稿回填三级地区与社交名称', () => {
  const draft = createSalesOrderCustomerDraft(contextOf({
    customer: { ...contextOf().customer, fbName: '小明', lineName: 'ming' },
  }))
  assert.equal(draft.region.countryRegionId, 'region-country')
  assert.equal(draft.region.cityId, 'region-city')
  assert.equal(draft.fbName, '小明')
  assert.equal(draft.lineName, 'ming')
  assert.equal(draft.reason, '')
})

test('客户保存提交完整字段、版本号与归一化后的原因', () => {
  const context = contextOf()
  const draft = {
    ...createSalesOrderCustomerDraft(context),
    phone: '  0933000111 ',
    fbName: '   ',
    reason: '  客户更正电话 ',
  }
  const built = buildSalesOrderCustomerUpdatePayload(context, draft)
  assert.equal(built.valid, true)
  if (!built.valid) {
    return
  }
  assert.equal(built.request.expectedVersion, 7)
  assert.equal(built.request.reason, '客户更正电话')
  assert.equal(built.request.customer.phone, '0933000111')
  assert.equal(built.request.customer.fbName, null)
})

test('客户姓名超过 24 字与缺少地区返回字段错误', () => {
  const context = contextOf()
  const longName = buildSalesOrderCustomerUpdatePayload(context, {
    ...createSalesOrderCustomerDraft(context),
    name: '客'.repeat(25),
    reason: '改名',
  })
  assert.equal(longName.valid, false)
  if (!longName.valid) {
    assert.ok(longName.fieldErrors['customer.name'])
  }

  const noRegion = buildSalesOrderCustomerUpdatePayload(context, {
    ...createSalesOrderCustomerDraft(context),
    region: { countryRegionId: null, provinceStateId: null, cityId: null },
    reason: '改名',
  })
  assert.equal(noRegion.valid, false)
  if (!noRegion.valid) {
    assert.ok(noRegion.fieldErrors['customer.cityId'])
  }
})

test('修改原因必填', () => {
  const context = contextOf()
  const built = buildSalesOrderCustomerUpdatePayload(context, {
    ...createSalesOrderCustomerDraft(context),
    reason: '   ',
  })
  assert.equal(built.valid, false)
  if (!built.valid) {
    assert.equal(built.fieldErrors.reason, '请填写本次修改原因')
  }
})

test('出单信息把空备注提交为 null，并拒绝未来日期格式', () => {
  const context = contextOf()
  const cleared = buildSalesOrderSalesInfoUpdatePayload(context, {
    ...createSalesOrderSalesInfoDraft(context),
    remark: '   ',
    reason: '清空备注',
  })
  assert.equal(cleared.valid, true)
  if (cleared.valid) {
    assert.equal(cleared.request.remark, null)
  }

  const invalidDate = buildSalesOrderSalesInfoUpdatePayload(context, {
    ...createSalesOrderSalesInfoDraft(context),
    orderDate: '2026/11/01',
    reason: '改日期',
  })
  assert.equal(invalidDate.valid, false)
  if (!invalidDate.valid) {
    assert.ok(invalidDate.fieldErrors.orderDate)
  }
})

test('草稿变化检测只比较业务字段，不把原因计入', () => {
  const context = contextOf()
  const customer = createSalesOrderCustomerDraft(context)
  assert.equal(salesOrderCustomerDraftChanged(context, customer), false)
  assert.equal(
    salesOrderCustomerDraftChanged(context, { ...customer, reason: '只写了原因' }),
    false,
  )
  assert.equal(
    salesOrderCustomerDraftChanged(context, { ...customer, phone: '0999' }),
    true,
  )

  const salesInfo = createSalesOrderSalesInfoDraft(context)
  assert.equal(salesOrderSalesInfoDraftChanged(context, salesInfo), false)
  assert.equal(
    salesOrderSalesInfoDraftChanged(context, { ...salesInfo, remark: '新备注' }),
    true,
  )
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
