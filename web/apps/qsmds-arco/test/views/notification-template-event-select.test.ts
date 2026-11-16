import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 页面逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  NO_TEMPLATE_EVENT_VALUE,
  templateEventFromSelection,
  templateEventSelection,
  templateEventSelectOptions,
} from '../../src/views/system/notifications/template-event-selection.logic'

test('模板事件下拉不使用空字符串选项', () => {
  const options = templateEventSelectOptions([
    { eventType: 'PURCHASE_REVIEW_PENDING', label: '采购审核' },
    { eventType: 'SALES_RECEIPT_REVIEW_PENDING', label: '收款审核' },
  ])

  assert.equal(options[0]?.label, '不指定事件')
  assert.equal(options[0]?.value, NO_TEMPLATE_EVENT_VALUE)
  for (const option of options) {
    assert.notEqual(option.value, '', 'SelectItem 不接受空字符串 value')
  }
  assert.deepEqual(options.slice(1).map(option => option.value), [
    'PURCHASE_REVIEW_PENDING',
    'SALES_RECEIPT_REVIEW_PENDING',
  ])
})

test('事件选择在哨兵值与空事件之间往返', () => {
  assert.equal(templateEventSelection(''), NO_TEMPLATE_EVENT_VALUE)
  assert.equal(templateEventSelection('PURCHASE_REVIEW_PENDING'), 'PURCHASE_REVIEW_PENDING')
  assert.equal(templateEventFromSelection(NO_TEMPLATE_EVENT_VALUE), '')
  assert.equal(templateEventFromSelection('PURCHASE_REVIEW_PENDING'), 'PURCHASE_REVIEW_PENDING')
  assert.equal(templateEventFromSelection(null), '')
  assert.equal(templateEventFromSelection(undefined), '')
})
