import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与柜次领域其它纯逻辑测试保持一致。
import test from 'node:test'
import { resolveContainerBindingStats } from '../../src/views/workbenches/containers/binding-stats.logic'

test('装柜明细全部绑定显示全部绑定并以绿色呈现', () => {
  assert.deepEqual(resolveContainerBindingStats(10, 10), {
    state: 'ALL',
    bound: 10,
    total: 10,
    labelKey: 'containerPage.bindingAll',
    toneClass: 'text-emerald-600 dark:text-emerald-400',
  })
})

test('部分绑定以琥珀色呈现，未绑定任意一行都不能算全部绑定', () => {
  for (const [bound, total] of [[7, 10], [1, 2], [9, 10]] as const) {
    const stats = resolveContainerBindingStats(bound, total)
    assert.equal(stats.state, 'PARTIAL')
    assert.equal(stats.bound, bound)
    assert.equal(stats.total, total)
    assert.equal(stats.labelKey, 'containerPage.bindingPartial')
    assert.equal(stats.toneClass, 'text-amber-600 dark:text-amber-400')
  }
})

test('全部未绑定以红色呈现', () => {
  const stats = resolveContainerBindingStats(0, 10)
  assert.equal(stats.state, 'NONE')
  assert.equal(stats.labelKey, 'containerPage.bindingNone')
  assert.equal(stats.toneClass, 'text-destructive')
})

test('空柜没有可绑定行，单独显示无明细而不是全未绑定', () => {
  const stats = resolveContainerBindingStats(0, 0)
  assert.equal(stats.state, 'EMPTY')
  assert.equal(stats.bound, 0)
  assert.equal(stats.total, 0)
  assert.equal(stats.labelKey, 'containerPage.bindingEmpty')
  assert.equal(stats.toneClass, 'text-muted-foreground')
})

test('异常行数收敛到可展示范围，不出现已绑定超过总行数', () => {
  const stats = resolveContainerBindingStats(5, 3)
  assert.equal(stats.bound, 3)
  assert.equal(stats.total, 3)
  assert.equal(stats.state, 'ALL')
  assert.equal(resolveContainerBindingStats(-1, 3).bound, 0)
  assert.equal(resolveContainerBindingStats(2, -3).total, 0)
})
