import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 验证分组身份、汇总来源与展开状态，防止付款明细串组。
import test from 'node:test'
import { buildTableGroups, getGroupedRowId, getTableGroupId, isTableGroupExpanded, toggleTableGroup } from '../../src/components/business/QsGenericTable/grouping'

interface Row { id: string, label: string, amount?: number, children?: Row[] }
const config = { getRows: (row: Row) => row.children ?? [], getLabel: (row: Row) => row.label }
const rows: Row[] = [
  { id: 'a', label: '订单 A', amount: 100, children: [{ id: 'deposit', label: '定金', amount: 30 }, { id: 'balance', label: '尾款', amount: 70 }] },
  { id: 'b', label: '订单 B', children: [{ id: 'deposit', label: '定金', amount: 20 }] },
]

test('保持调用方组及明细顺序，汇总来源只有子行，不修改原数据', () => {
  const before = JSON.stringify(rows)
  const result = buildTableGroups(rows, config, 'id')
  assert.deepEqual(result.map(group => [group.key, group.rows.map(row => row.id)]), [['a', ['deposit', 'balance']], ['b', ['deposit']]])
  assert.equal(result.flatMap(group => group.rows).reduce((sum, row) => sum + (row.amount ?? 0), 0), 120)
  assert.equal(JSON.stringify(rows), before)
  assert.equal(result[0]!.row, rows[0])
})

test('分组必须使用有效且唯一的稳定键，子行允许跨组同名但不能组内重复', () => {
  assert.throws(() => buildTableGroups(rows, config, undefined), /rowKey/u)
  assert.throws(() => buildTableGroups([rows[0]!, rows[0]!], config, 'id'), /Duplicate group/u)
  assert.throws(() => buildTableGroups([{ id: 'empty', label: '', children: [{ id: '', label: '' }] }], config, 'id'), /Invalid row key/u)
  assert.throws(() => buildTableGroups([{ id: 'dup', label: '', children: [rows[0]!.children![0]!, rows[0]!.children![0]!] }], config, 'id'), /Duplicate child/u)
  assert.notEqual(getGroupedRowId('a', 'deposit'), getGroupedRowId('b', 'deposit'))
  assert.notEqual(getGroupedRowId('a:b', 'c'), getGroupedRowId('a', 'b:c'))
})

test('折叠只改变指定组，排序后使用稳定 ID 保持展开状态，收起不丢明细', () => {
  const groups = buildTableGroups(rows, config, row => row.id)
  const expanded = toggleTableGroup(true, 'a', groups.map(group => group.key))
  assert.deepEqual(expanded, { a: false, b: true })
  assert.deepEqual(toggleTableGroup(expanded, 'a', ['b', 'a']), { a: true, b: true })
  assert.equal(groups[0]!.rows.length, 2)
})

test('空组仍保留标题和分页数量，不能作为普通明细参与汇总', () => {
  const groups = buildTableGroups([{ id: 'empty', label: '空组' }], config, 'id')
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.label, '空组')
  assert.deepEqual(groups[0]!.rows, [])
})

test('父组与子行 ID 使用独立命名空间，展开状态不读取对象原型', () => {
  const childId = getGroupedRowId('a', 'x')
  assert.notEqual(getTableGroupId(childId), childId)
  for (const key of ['__proto__', 'constructor', 'toString']) {
    assert.equal(isTableGroupExpanded({}, key), false)
    const expanded = toggleTableGroup({}, key, [key])
    assert.equal(isTableGroupExpanded(expanded, key), true)
    assert.equal(isTableGroupExpanded(toggleTableGroup(expanded, key, [key]), key), false)
  }
})
