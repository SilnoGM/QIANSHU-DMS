import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证收件信息的业务复制格式与空值、换行保留。
import test from 'node:test'
import { buildOceanContainerRecipientText } from '../../src/views/operations/ocean-containers/recipient-copy.logic'

test('按固定顺序复制当前装柜明细的收件人与备注', () => {
  assert.equal(buildOceanContainerRecipientText({
    recipientName: '陳先生',
    recipientPhone: '0900-123-456',
    recipientAddress: '屏東縣竹田鄉鳳新路477之1號',
    remark: '派送前聯絡，自備堆高機卸貨',
  }), '客户姓名：陳先生\n客户电话：0900-123-456\n收件地址：屏東縣竹田鄉鳳新路477之1號\n备注：派送前聯絡，自備堆高機卸貨')
})

test('缺失信息保留标签和空值，不把占位符复制为实际信息', () => {
  assert.equal(buildOceanContainerRecipientText({
    recipientName: null,
    recipientPhone: '',
    recipientAddress: null,
    remark: '   ',
  }), '客户姓名：\n客户电话：\n收件地址：\n备注：')
})

test('清除首尾空白，保留地址、备注内部的换行及中英文括号', () => {
  assert.equal(buildOceanContainerRecipientText({
    recipientName: ' 王小姐 ',
    recipientPhone: ' 0900-123-456 ',
    recipientAddress: ' 第一行\n第二行 ',
    remark: '\n需試機（1小時）\n卸貨(自備堆高機)\n',
  }), '客户姓名：王小姐\n客户电话：0900-123-456\n收件地址：第一行\n第二行\n备注：需試機（1小時）\n卸貨(自備堆高機)')
})
