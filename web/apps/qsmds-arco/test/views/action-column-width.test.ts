import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 操作列宽度是纯函数，使用现有 Node.js runner。
import test from 'node:test'
import { resolveActionColumnWidth } from '../../src/components/business/QsGenericTable/action-column-width'

test('操作列宽度按按钮类型和字数计算并保留 8px 缓冲', () => {
  assert.equal(resolveActionColumnWidth([{ kind: 'icon' }]), 64)
  assert.equal(resolveActionColumnWidth([{ chars: 2, kind: 'text' }]), 84)
  assert.equal(resolveActionColumnWidth([{ chars: 2, kind: 'text-with-icon' }]), 104)
  assert.equal(resolveActionColumnWidth([{ chars: 4, kind: 'text-with-icon' }]), 132)
  assert.equal(resolveActionColumnWidth([{ chars: 6, kind: 'text-with-icon' }]), 160)
  assert.equal(resolveActionColumnWidth([{ chars: 2, kind: 'text-with-icon' }, { kind: 'icon' }]), 140)
  assert.equal(resolveActionColumnWidth([{ chars: 4, kind: 'text-with-icon' }, { kind: 'icon' }]), 168)
  assert.equal(resolveActionColumnWidth([
    { chars: 2, kind: 'text-with-icon' },
    { chars: 4, kind: 'text-with-icon' },
    { kind: 'icon' },
  ]), 244)
  assert.equal(resolveActionColumnWidth([
    { chars: 4, kind: 'text-with-icon' },
    { chars: 4, kind: 'text-with-icon' },
    { kind: 'icon' },
  ]), 272)
})

test('产品列表保留上移下移时按四个图标/文本按钮加菜单计算', () => {
  assert.equal(resolveActionColumnWidth([
    { kind: 'icon' },
    { kind: 'icon' },
    { chars: 2, kind: 'text-with-icon' },
    { chars: 2, kind: 'text-with-icon' },
    { kind: 'icon' },
  ]), 288)
})

test('无图标文本按钮按两个行内加更多计算', () => {
  assert.equal(resolveActionColumnWidth([
    { chars: 2, kind: 'text' },
    { chars: 2, kind: 'text' },
    { kind: 'icon' },
  ]), 176)
  assert.equal(resolveActionColumnWidth([
    { chars: 2, kind: 'text' },
    { chars: 2, kind: 'text' },
  ]), 140)
  assert.equal(resolveActionColumnWidth([
    { chars: 2, kind: 'text' },
    { chars: 4, kind: 'text' },
  ]), 168)
})
