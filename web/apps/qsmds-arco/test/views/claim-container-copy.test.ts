import type { ShipmentStorageClaimContainerChangeDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 复制文案格式使用 Node.js 内置 runner 验证。
import test from 'node:test'

import { buildClaimContainerCopyText } from '../../src/views/workbenches/purchase-storage/claim-container-copy'

function change(overrides: Partial<ShipmentStorageClaimContainerChangeDto> = {}): ShipmentStorageClaimContainerChangeDto {
  return {
    loadingItemId: 'item-1',
    containerBatchId: 'batch-1',
    containerBatchName: '测试柜',
    lineNumber: 2,
    oceanShippingMarkText: 'J-030549-01',
    expectedVersion: 1,
    beforeRecipientName: '旧收件人',
    beforeRecipientPhone: '0911000000',
    beforeRecipientAddress: '旧地址',
    beforeCodAmountTwd: '40000.00',
    afterRecipientName: '新收件人',
    afterRecipientPhone: '0922000000',
    afterRecipientAddress: '新地址',
    afterCodAmountTwd: null,
    recipientChanged: true,
    codChanged: true,
    ...overrides,
  }
}

test('收件人修改与取消代收按柜次页格式分两段合并', () => {
  const text = buildClaimContainerCopyText([change()])

  assert.equal(text, [
    '‼️【收件人信息修改】',
    '柜次：测试柜',
    '唛头：J-030549-01',
    '',
    '客户姓名改为：新收件人',
    '客户电话改为：0922000000',
    '收件地址改为：新地址',
    '',
    '‼️【代收款取消】',
    '柜次：测试柜',
    '唛头：J-030549-01',
    '',
    '原代收：NT$ 40000，取消代收',
  ].join('\n'))
})

test('多明细按装柜行顺序拼接，未变化的字段和段落不输出', () => {
  const text = buildClaimContainerCopyText([
    change({
      loadingItemId: 'item-2',
      lineNumber: 3,
      oceanShippingMarkText: 'J-030549-02',
      beforeRecipientName: '新收件人',
      beforeRecipientPhone: '0922000000',
      beforeRecipientAddress: '新地址',
      beforeCodAmountTwd: null,
      afterCodAmountTwd: '500.00',
      codChanged: true,
      recipientChanged: false,
    }),
    change({
      loadingItemId: 'item-1',
      lineNumber: 2,
      beforeRecipientName: '旧收件人',
      afterRecipientName: '旧收件人',
      afterRecipientPhone: '0911000000',
      afterRecipientAddress: '旧地址',
      beforeCodAmountTwd: null,
      afterCodAmountTwd: null,
      codChanged: false,
    }),
  ])

  assert.equal(text, [
    '‼️【代收款修改】',
    '柜次：测试柜',
    '唛头：J-030549-02',
    '',
    '原代收：无代收',
    '新代收改为：NT$ 500',
  ].join('\n'))
})

test('没有实际变化时不生成文案', () => {
  assert.equal(buildClaimContainerCopyText([change({
    beforeRecipientName: '新收件人',
    beforeRecipientPhone: '0922000000',
    beforeRecipientAddress: '新地址',
    beforeCodAmountTwd: '40000.00',
    afterCodAmountTwd: '40000.00',
    recipientChanged: false,
    codChanged: false,
  })]), '')
})
