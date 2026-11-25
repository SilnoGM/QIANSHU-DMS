import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 纯函数策略使用 Node.js 内置 runner。
import test from 'node:test'

import {
  filterTargetOptions,
  targetOptionLabel,
  toggleTargetValue,
} from '../../src/views/system/notifications/events/target-options'

const OPTIONS = [
  { label: '张三', value: 'user-1', description: 'zhangsan' },
  { label: '李四', value: 'user-2', description: 'lisi' },
  { label: '采购主管', value: 'purchasing_manager', description: '采购角色' },
]

test('筛选目标选项同时匹配名称、值和说明', () => {
  assert.deepEqual(filterTargetOptions(OPTIONS, '张').map(option => option.value), ['user-1'])
  assert.deepEqual(filterTargetOptions(OPTIONS, 'USER-2').map(option => option.value), ['user-2'])
  assert.deepEqual(filterTargetOptions(OPTIONS, '采购').map(option => option.value), ['purchasing_manager'])
  assert.deepEqual(filterTargetOptions(OPTIONS, '   ').map(option => option.value), ['user-1', 'user-2', 'purchasing_manager'])
  assert.deepEqual(filterTargetOptions(OPTIONS, '不存在'), [])
})

test('切换目标选项保持原有顺序并避免重复', () => {
  assert.deepEqual(toggleTargetValue([], 'user-1'), ['user-1'])
  assert.deepEqual(toggleTargetValue(['user-1'], 'user-2'), ['user-1', 'user-2'])
  assert.deepEqual(toggleTargetValue(['user-1', 'user-2'], 'user-1'), ['user-2'])
  assert.deepEqual(toggleTargetValue(['user-1'], 'user-1'), [])
})

test('历史值不在选项中时回退显示原始值', () => {
  assert.equal(targetOptionLabel(OPTIONS, 'user-1'), '张三')
  assert.equal(targetOptionLabel(OPTIONS, 'deleted-user'), 'deleted-user')
})
