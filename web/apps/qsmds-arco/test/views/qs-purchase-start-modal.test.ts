import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// eslint-disable-next-line test/no-import-node-test -- 业务组件源码契约使用 Node.js 内置 runner。
import test from 'node:test'

const SOURCE = new URL(
  '../../src/components/business/QsPurchaseStartModal/index.vue',
  import.meta.url,
)
const TYPES = new URL(
  '../../src/components/business/QsPurchaseStartModal/types.ts',
  import.meta.url,
)

test('采购开始弹窗复用公共弹窗与供应商字典并绑定登录草稿', async () => {
  const [source, types] = await Promise.all([
    readFile(SOURCE, 'utf8'),
    readFile(TYPES, 'utf8'),
  ])
  assert.match(source, /defineOptions\(\{ name: 'QsPurchaseStartModal' \}\)/u)
  assert.match(source, /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u)
  assert.match(source, /import QsDictionarySelect from '@\/components\/business\/QsDictionarySelect\/index\.vue'/u)
  assert.match(source, /dictionary-code="service_provider\.supplier"/u)
  assert.match(types, /export type PurchaseStartProductMode = 'CATALOG' \| 'CUSTOM'/u)
  assert.match(types, /signal: AbortSignal/u)
  assert.match(source, /savePurchaseRecipientDraft/u)
  assert.match(source, /account.userId/u)
  assert.match(source, /recipientError.value === null/u)
})

test('采购开始弹窗提供双面板、条件供应商步骤与可访问选择语义', async () => {
  const source = await readFile(SOURCE, 'utf8')
  assert.match(source, /产品库产品采购/u)
  assert.match(source, /自定义产品采购/u)
  assert.match(source, /下拉选择供应商/u)
  assert.match(source, /填写供应商名称/u)
  assert.match(source, /role="radiogroup"/u)
  assert.match(source, /v-for="mode in/u)
  assert.match(source, /grid-cols-1 sm:grid-cols-2/u)
  assert.match(source, /peer-focus-visible:ring-2/u)
  assert.match(source, /QsPaymentRecipientEditor/u)
  assert.match(source, /:minimum="1"/u)
  assert.match(source, /min-h-11/u)
  assert.match(source, /class="min-h-11 w-full"/u)
  assert.match(source, /开始采购/u)
  assert.match(source, /:disabled="!canConfirm"/u)
  assert.match(source, /i-lucide:boxes/u)
  assert.match(source, /i-lucide:package-plus/u)
  assert.doesNotMatch(source, /(?:[🚀⭐👍🔥💡🎉✨]|\u{2764}\u{FE0F})/u)
})

test('采购开始弹窗关闭、切换、身份变化与卸载均清理草稿或中止旧校验', async () => {
  const source = await readFile(SOURCE, 'utf8')
  assert.match(source, /function resetDraft/u)
  assert.match(source, /resetPurchaseStartSupplierDraft/u)
  assert.match(source, /const validationController = shallowRef<AbortController \| null>\(null\)/u)
  assert.match(source, /validationController\.value\?\.abort\(\)/u)
  assert.match(source, /onBeforeUnmount\(abortValidation\)/u)
  assert.match(source, /watch\(\(\) => props\.presetSalesOrder\?\.id/u)
  assert.match(source, /emit\('validationError'/u)
  assert.match(source, /emit\('confirm'/u)
  assert.match(source, /:submitting="submissionPending"/u)
})
