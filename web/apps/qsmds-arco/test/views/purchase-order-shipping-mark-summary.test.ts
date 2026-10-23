import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 校验采购核对与确认界面的展示边界，交互由浏览器测试覆盖。
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('采购核对与提交确认共享结构化唛头摘要，不再渲染拼接配置长文', () => {
  const source = read('../../src/views/operations/purchase-orders/create.vue')
  assert.equal((source.match(/<PurchaseOrderShippingMarkSummary\b/gu) ?? []).length, 3)
  assert.equal((source.match(/<template #shipping-mark>/gu) ?? []).length, 2)
  const confirmation = source.slice(source.indexOf('title="确认提交采购订单？"'))
  assert.doesNotMatch(confirmation, /\{\{ shippingMarkSummary \}\}/u)
  assert.ok(confirmation.indexOf('</dl>') < confirmation.indexOf('data-testid="purchase-order-confirm-shipping-mark"'))
  assert.match(confirmation, /<PurchaseOrderShippingMarkSummary[\s\S]*?:resolution="shippingMarkResolution"/u)
})

test('详情通过可选展示插槽接入，历史唛头纯文本与中立 ViewModel 保持不变', () => {
  const source = read('../../src/components/business/QsPurchaseOrderDesc/index.vue')
  assert.match(source, /'shipping-mark'\?: \(\) => unknown/u)
  assert.match(source, /<slot name="shipping-mark">[\s\S]*?displayText\(model.shippingMarkText\)[\s\S]*?<\/slot>/u)
  assert.doesNotMatch(source, /PurchaseOrderShippingMarkResolutionDto|shipping-mark.logic/u)
})

test('唛头摘要只内联关键内容，配置浮层支持键盘、触控与不可用原因', () => {
  const source = read('../../src/views/operations/purchase-orders/purchase-order-shipping-mark-summary.vue')
  const popup = source.slice(source.indexOf('<template #panel>'), source.indexOf('</QsHoverPopover>'))
  const inline = source.replace(popup, '')
  assert.match(source, /useMediaQuery\('\(hover: hover\) and \(pointer: fine\)'\)/u)
  assert.match(source, /:hover="supportsHover"/u)
  assert.match(source, /class="p-3! z-2001!"/u)
  assert.match(source, /aria-label="查看唛头规则详情"/u)
  assert.match(source, /size-11 sm:size-7/u)
  assert.match(source, /event.key === 'Escape'/u)
  assert.match(source, /event.stopPropagation\(\)/u)
  assert.match(popup, /role="dialog" aria-label="唛头规则详情"/u)
  assert.match(popup, /PURCHASE_SHIPPING_MARK_DISPATCH_HINT/u)
  assert.doesNotMatch(inline.slice(inline.indexOf('<template>')), /<dl|PURCHASE_SHIPPING_MARK_DISPATCH_HINT/u)
  assert.match(source, /formatNumberingRuleStructure\(props.resolution.activeConfig\)/u)
  assert.match(source, /role="alert"/u)
  assert.match(source, /props.error \|\| props.resolution\?\.message/u)
  assert.doesNotMatch(source, /purchaseOrdersApi|formatPurchaseOrderShippingMarkSummary|\.split\(/u)
})
