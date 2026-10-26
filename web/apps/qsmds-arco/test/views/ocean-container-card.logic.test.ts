import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 卡片模式判定使用 Node.js 内置 runner 验证。
import test from 'node:test'
import {
  hasOceanContainerDetails,
  isOceanContainerLineActionable,
  isOceanContainerLineHighlighted,
  isOwnOceanContainer,
  visibleOceanContainerColumns,
} from '../../src/components/business/QsOceanContainerList/logic'

test('柜次归属与明细加载门槛分别匹配个人页和全部柜次页', () => {
  assert.equal(isOwnOceanContainer({ myItemCount: 1 }), true)
  assert.equal(isOwnOceanContainer({ myItemCount: 0 }), false)
  assert.equal(hasOceanContainerDetails({ itemCount: 30, myItemCount: 0 }, 'mine'), false)
  assert.equal(hasOceanContainerDetails({ itemCount: 30, myItemCount: 0 }, 'all'), true)
  assert.equal(hasOceanContainerDetails({ itemCount: 0, myItemCount: 0 }, 'all'), false)
})

test('修改与来源入口只在全部柜次页按 mine 逐行放行', () => {
  assert.equal(isOceanContainerLineActionable({}, false), true)
  assert.equal(isOceanContainerLineActionable({ mine: false }, false), true)
  assert.equal(isOceanContainerLineActionable({ mine: true }, true), true)
  assert.equal(isOceanContainerLineActionable({ mine: false }, true), false)
  assert.equal(isOceanContainerLineActionable({}, true), false)
})

test('明细行底色只在全部柜次页且属于本人时启用', () => {
  assert.equal(isOceanContainerLineHighlighted({ mine: true }, 'all'), true)
  assert.equal(isOceanContainerLineHighlighted({ mine: false }, 'all'), false)
  assert.equal(isOceanContainerLineHighlighted({ mine: true }, 'mine'), false)
})

test('全部柜次页隐藏来源列，个人页保留来源入口', () => {
  assert.deepEqual(visibleOceanContainerColumns(true), ['recipient', 'mark', 'goods', 'shippingMark', 'cod', 'source', 'actions'])
  assert.deepEqual(visibleOceanContainerColumns(false), ['recipient', 'mark', 'goods', 'shippingMark', 'cod', 'actions'])
})
