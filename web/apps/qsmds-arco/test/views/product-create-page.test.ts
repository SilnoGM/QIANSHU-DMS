import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 产品创建 View 契约使用 Node.js 内置 runner。
import test from 'node:test'

const VIEW_ROOT = new URL(
  '../../src/views/admin/product-management/create/',
  import.meta.url,
)

test('属性编辑器覆盖 50 项、稳定 key、有序操作与可访问错误', async () => {
  const source = await readFile(
    new URL('product-attributes-editor.vue', VIEW_ROOT),
    'utf8',
  )

  assert.match(source, /MAX_PRODUCT_ATTRIBUTES/)
  assert.match(source, /:key="attribute\.key"/)
  assert.match(source, /appendProductAttribute/)
  assert.match(source, /moveProductAttribute/)
  assert.match(source, /removeProductAttribute/)
  assert.match(source, /产品属性（\{\{ modelValue\.length \}\}\/\{\{ MAX_PRODUCT_ATTRIBUTES \}\}）/)
  assert.match(source, /`上移第 \$\{index \+ 1\} 项属性`/)
  assert.match(source, /`下移第 \$\{index \+ 1\} 项属性`/)
  assert.match(source, /`删除第 \$\{index \+ 1\} 项属性`/)
  assert.match(source, /:disabled="disabled \|\| index === 0"/)
  assert.match(source, /:disabled="disabled \|\| index === modelValue\.length - 1"/)
  assert.match(source, /:aria-invalid="Boolean\(fieldError\(index, 'title'\)\)"/)
  assert.match(source, /:aria-describedby="attributeDescriptionId\(index, 'title'\)"/)
  assert.match(source, /role="alert"/)
  assert.match(source, /min-h-11/)
  assert.match(source, /focusField/)
  assert.match(source, /scrollIntoView/)
  assert.doesNotMatch(source, /draggable|sortable|drag-handle/i)
  assert.doesNotMatch(source, /gradient|#[\dA-F]{3,8}/i)
})

test('产品表单组合基础资料、状态供应商、三组金额、属性和媒体延期说明', async () => {
  const source = await readFile(
    new URL('product-create-form.vue', VIEW_ROOT),
    'utf8',
  )

  assert.match(source, /<FaForm/)
  assert.match(source, /aria-busy/)
  assert.match(source, /<FaCard[\s\S]*title="基础资料"/)
  assert.match(source, /label="产品名称"/)
  assert.match(source, /DRAFT/)
  assert.match(source, /ACTIVE/)
  assert.match(source, /INACTIVE/)
  assert.match(source, /dictionary-code="service_provider\.supplier"/)
  assert.match(source, /:required="modelValue\.status === 'ACTIVE'"/)
  assert.equal((source.match(/<MoneyInput/g) ?? []).length, 3)
  assert.match(source, /name="twdSalePriceAmount"/)
  assert.match(source, /name="myrSalePriceAmount"/)
  assert.match(source, /name="purchaseCostAmount"/)
  assert.doesNotMatch(source, /name="(?:twdSalePrice|myrSalePrice|purchaseCost)\.amount"/)
  assert.match(source, /:currencies="twdCurrencies"/)
  assert.match(source, /:currencies="myrCurrencies"/)
  assert.match(source, /:currencies="purchaseCurrencies"/)
  assert.match(source, /ProductAttributesEditor/)
  assert.match(source, /patch: \[value: Partial<ProductCreateFormModel>\]/)
  assert.match(source, /emit\('patch', patch\)/)
  assert.doesNotMatch(source, /\.\.\.props\.modelValue,\s*\.\.\.patch/u)
  assert.match(source, /图片与视频将在后续版本接入/)
  assert.doesNotMatch(source, /type="file"|上传图片|上传视频|媒体 URL/i)
})

test('表单显式呈现 Catalog 和字段失败，并可滚动聚焦首个真实控件', async () => {
  const source = await readFile(
    new URL('product-create-form.vue', VIEW_ROOT),
    'utf8',
  )

  assert.match(source, /ProductCreateCatalogState/)
  assert.match(source, /正在加载货币资料/)
  assert.match(source, /货币资料加载失败/)
  assert.match(source, /暂无可用货币/)
  assert.match(source, /正在加载供应商资料/)
  assert.match(source, /供应商资料加载失败/)
  assert.match(source, /暂无可用供应商/)
  assert.match(source, /role="status"/)
  assert.match(source, /role="alert"/)
  assert.match(source, /applyFieldErrors/)
  assert.match(source, /path === 'twdSalePrice\.amount'[\s\S]*return 'twdSalePriceAmount'/)
  assert.match(source, /path === 'myrSalePrice\.amount'[\s\S]*return 'myrSalePriceAmount'/)
  assert.match(source, /path === 'purchaseCost\.amount'[\s\S]*return 'purchaseCostAmount'/)
  assert.match(source, /formRef\.value\?\.scrollToField/)
  assert.match(source, /attributesRef\.value\?\.focusField/)
  assert.match(source, /await nextTick\(\)/)
  assert.match(source, /:loading="submitting"/)
  assert.match(source, /:disabled="submitLocked"/)
})

test('表单使用桌面 8\/4 信息结构、移动单列和语义 Token，不引入装饰性风格', async () => {
  const source = await readFile(
    new URL('product-create-form.vue', VIEW_ROOT),
    'utf8',
  )

  assert.match(source, /grid-cols-1/)
  assert.match(source, /lg:grid-cols-12/)
  assert.match(source, /lg:col-span-8/)
  assert.match(source, /lg:col-span-4/)
  assert.match(source, /lg:sticky/)
  assert.match(source, /lg:top-4/)
  assert.match(source, /border-border/)
  assert.match(source, /bg-muted/)
  assert.match(source, /text-muted-foreground/)
  assert.match(source, /font-mono/)
  assert.match(source, /min-h-11/)
  assert.doesNotMatch(source, /overflow-x-auto/)
  assert.doesNotMatch(source, /gradient|#[\dA-F]{3,8}|emoji/i)
})

test('创建页编排页头、Catalog、表单、真实 API 与成功分流', async () => {
  const source = await readFile(new URL('index.vue', VIEW_ROOT), 'utf8')

  assert.match(source, /<FaPageHeader/)
  assert.match(source, /data-testid="product-create-page"/)
  assert.match(source, /title="新增产品"/)
  assert.match(source, /<FaPageMain/)
  assert.match(source, /<ProductCreateForm/)
  assert.match(source, /useCurrencyCatalog\(\)/)
  assert.match(source, /useDictionaryCatalog\(SUPPLIER_DICTIONARY_CODE\)/)
  assert.match(source, /productsApi\.create/)
  assert.match(source, /@patch="handleModelPatch"/)
  assert.match(source, /formModel\.value = \{[\s\S]*\.\.\.formModel\.value,[\s\S]*\.\.\.patch/u)
  assert.match(source, /auth\('products:create'\)/)
  assert.match(source, /auth\('products:read'\)/)
  assert.match(source, /name: 'adminProductList'/)
  assert.match(source, /产品 \$\{product\.productNo\} 创建成功/)
  assert.match(source, /继续新增/)
  assert.match(source, /产品编号：/)
  assert.match(source, /@media \(width <= 639px\)[\s\S]*\.product-create-page :deep\(button\)[\s\S]*min-height: 2\.75rem/u)
})

test('创建页以冻结幂等请求管理确定失败、未知结果与身份竞态', async () => {
  const source = await readFile(new URL('index.vue', VIEW_ROOT), 'utf8')

  assert.match(source, /beginProductCreateSubmission/)
  assert.match(source, /resolveProductCreateFailure/)
  assert.match(source, /resolveProductCreateSuccess/)
  assert.match(source, /replayUnknownProductCreate/)
  assert.match(source, /abandonUnknownProductCreate/)
  assert.match(source, /canApplyProductCreateResponse/)
  assert.match(source, /getProductCreateApiFailure/)
  assert.match(source, /isProductCreateAbortError/)
  assert.match(source, /requestVersion/)
  assert.match(source, /authEpoch/)
  assert.match(source, /AbortController/)
  assert.match(source, /submission\.snapshot/)
  assert.match(source, /submission\.idempotencyKey/)
  assert.match(source, /使用相同请求重新确认/)
  assert.match(source, /放弃本次确认/)
  assert.doesNotMatch(source, /setTimeout\([\s\S]{0,120}productsApi\.create/)
})

test('创建页实施 Catalog 提交门禁、字段错误摘要与提交锁', async () => {
  const source = await readFile(new URL('index.vue', VIEW_ROOT), 'utf8')

  assert.match(source, /currencyCatalogState\.value !== 'ready'/)
  assert.match(source, /supplierCatalogState\.value !== 'ready'/)
  assert.match(source, /supplierCatalog\.resolve/)
  assert.match(source, /status === 'ACTIVE'/)
  assert.match(source, /purchaseCostCurrency/)
  assert.match(source, /buildCreateProductRequest/)
  assert.match(source, /formRef\.value\?\.applyFieldErrors/)
  assert.match(source, /role="alert"/)
  assert.match(source, /requestId:/)
  assert.match(source, /:submitting="submitState\.phase === 'submitting'"/)
  assert.match(source, /:disabled="submitState\.phase === 'unknown'"/)
})

test('未保存离开、页面取消与 unknown 放弃共用 QsGenericModal', async () => {
  const source = await readFile(new URL('index.vue', VIEW_ROOT), 'utf8')

  assert.match(source, /<QsGenericModal/)
  assert.match(source, /onBeforeRouteLeave/)
  assert.match(source, /hasProductCreateChanges/)
  assert.match(source, /beforeunload/)
  assert.match(source, /event\.preventDefault\(\)/)
  assert.match(source, /pendingNavigationResolver/)
  assert.match(source, /继续编辑/)
  assert.match(source, /确认放弃/)
  assert.doesNotMatch(source, /window\.confirm/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|use.*Store\([^)]*product|route\.query|console\./i)
})
