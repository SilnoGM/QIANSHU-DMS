import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 模板变量工具使用 Node.js 内置 runner。
import test from 'node:test'

import {
  extractTemplatePlaceholders,
  insertTextAtSelection,
} from '../../src/views/system/notifications/template-variable.logic'

test('从正文、标题和链接提取变量并按首次出现去重', () => {
  assert.deepEqual(
    extractTemplatePlaceholders(
      '采购单 {{orderNo}} 客户 {{customerName}}',
      '{{orderNo}} 待审核',
      '/orders/{{orderId}}',
      null,
    ),
    ['orderNo', 'customerName', 'orderId'],
  )
  assert.deepEqual(extractTemplatePlaceholders('单花括号 {orderNo} 不提取'), [])
})

test('在光标位置插入变量，空选区时追加到末尾', () => {
  assert.deepEqual(insertTextAtSelection('采购单 待审核', '{{orderNo}}', 4, 4), {
    cursor: 15,
    value: '采购单 {{orderNo}}待审核',
  })
  assert.deepEqual(insertTextAtSelection('abc', '{{x}}', null, null), {
    cursor: 8,
    value: 'abc{{x}}',
  })
  assert.deepEqual(insertTextAtSelection('abc', '{{x}}', 99, 100), {
    cursor: 8,
    value: 'abc{{x}}',
  })
})
