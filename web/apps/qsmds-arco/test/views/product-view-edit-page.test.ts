import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 产品查看编辑 View 契约使用 Node.js 内置 runner。
import test from 'node:test'

const ROOT = new URL(
  '../../src/views/admin/product-management/',
  import.meta.url,
)

test('详情 Drawer 使用真实详情、完整组件语义、恢复错误和权限化编辑入口', async () => {
  const source = await readFile(
    new URL('list/product-detail-drawer.vue', ROOT),
    'utf8',
  )

  assert.match(source, /<QsGenericDrawer/u)
  assert.match(source, /size="xl"/u)
  assert.match(source, /<ImageGroup/u)
  assert.match(source, /<AmountDisplay/u)
  assert.match(source, /<DateTimeDisplay/u)
  assert.match(source, /supplierStateLabel/u)
  assert.match(source, /requestId:/u)
  assert.match(source, /重新加载/u)
  assert.match(source, /<template #footer>[\s\S]*?<FaButton[\s\S]*?v-if="product !== null && canEdit"/u)
  assert.doesNotMatch(source, /<template v-if="[^"]*canEdit[^"]*" #footer>/u)
  assert.match(source, /编辑产品/u)
  assert.doesNotMatch(source, /productsApi/u)
})

test('详情 Drawer 使用单列区块顺序并交由通用 Drawer 负责纵向滚动', async () => {
  const source = await readFile(
    new URL('list/product-detail-drawer.vue', ROOT),
    'utf8',
  )
  const detailStart = source.indexOf(
    '<div v-else data-testid="product-detail-drawer"',
  )
  const detailEnd = source.indexOf('<template #footer>', detailStart)
  assert.ok(detailStart >= 0 && detailEnd > detailStart)
  const detailSource = source.slice(detailStart, detailEnd)

  assert.match(
    detailSource,
    /data-testid="product-detail-drawer" class="gap-4 grid min-w-0"/u,
  )
  assert.doesNotMatch(detailSource, /(?:grid-cols-12|col-span-|<aside)/u)
  assert.doesNotMatch(detailSource, /overflow-y-(?:auto|scroll)/u)

  const sectionOrder = [
    '产品身份',
    '供应商',
    '价格资料',
    '产品属性',
    '媒体资料',
    '审计信息',
  ]
  const positions = sectionOrder.map(label => detailSource.indexOf(label))
  assert.equal(positions.every(position => position >= 0), true)
  assert.deepEqual([...positions].sort((left, right) => left - right), positions)
})

test('列表拥有详情请求竞态并将查看与编辑操作接入真实目标', async () => {
  const source = await readFile(new URL('list/index.vue', ROOT), 'utf8')

  assert.match(source, /productsApi\.getById/u)
  assert.match(source, /detailRequestVersion/u)
  assert.match(source, /detailAbortController/u)
  assert.match(source, /authEpoch/u)
  assert.match(source, /<ProductDetailDrawer/u)
  assert.match(source, /showProductDetail\(row\)/u)
  assert.match(source, /navigateToEdit\(row\.id\)/u)
  assert.doesNotMatch(source, /详情功能将在后续版本开放/u)
  assert.doesNotMatch(source, /编辑功能将在后续版本开放/u)
})

test('编辑页要求 read+update、GET 初始化、差异 PATCH、对账和离开守卫', async () => {
  const source = await readFile(new URL('edit/index.vue', ROOT), 'utf8')

  assert.match(source, /authAll\(\[[\s\S]*?'products:read',[\s\S]*?'products:update',[\s\S]*?'product-categories:create',[\s\S]*?\]\)/u)
  assert.match(source, /productsApi\.getById/u)
  assert.match(source, /productsApi\.update/u)
  assert.match(source, /buildProductUpdateRequest/u)
  assert.match(source, /reconcileProductUpdateResult/u)
  assert.match(source, /phase === 'conflict'/u)
  assert.match(source, /phase === 'unknown'/u)
  assert.match(source, /onBeforeRouteLeave/u)
  assert.match(source, /beforeunload/u)
  assert.match(source, /<ProductForm/u)
  assert.match(source, /<QsGenericModal/u)
  assert.doesNotMatch(source, /setTimeout\([\s\S]{0,120}productsApi\.update/u)
})

test('Task 15 编辑页共享产品版本并让基础表单与媒体状态机保持独立', async () => {
  const source = await readFile(new URL('edit/index.vue', ROOT), 'utf8')
  const formSource = await readFile(
    new URL('form/product-form.vue', ROOT),
    'utf8',
  )

  assert.match(
    source,
    /import ProductMediaPanel from '\.\.\/media\/product-media-panel\.vue'/u,
  )
  assert.match(source, /const \{ auth, authAll \} = useAppAuth\(\)/u)
  assert.match(
    source,
    /const canReadProductMedia = computed\(\(\) => auth\('product-media:read'\)\)/u,
  )
  assert.match(
    source,
    /const canUpdate = computed\(\(\) => auth\('products:update'\)\)/u,
  )
  assert.match(
    source,
    /function handleMediaProductChange\(product: ProductListItemDto\)[\s\S]{0,320}source\.value = product/u,
  )
  assert.match(
    source,
    /const response = await productsApi\.update[\s\S]{0,520}source\.value = response\.data/u,
  )
  assert.match(
    source,
    /<ProductMediaPanel[\s\S]{0,420}:product="source"[\s\S]{0,420}:editable="canUpdate"[\s\S]{0,420}:content-readable="canReadProductMedia"[\s\S]{0,420}:auth-epoch="appAccountStore\.authEpoch"[\s\S]{0,420}@product-change="handleMediaProductChange"/u,
  )
  assert.doesNotMatch(
    source,
    /function handleMediaProductChange[\s\S]{0,320}formModel\.value/u,
  )
  assert.match(
    formSource,
    /<FaCard\s+v-if="!isEdit"\s+title="媒体资料"/u,
  )
  assert.match(formSource, /创建产品后可在编辑页上传和维护图片与视频/u)
})

test('Task 15 详情和视频预览缺少内容权限时失败关闭且不生成内容地址', async () => {
  const detailSource = await readFile(
    new URL('list/product-detail-drawer.vue', ROOT),
    'utf8',
  )
  const videosSource = await readFile(
    new URL('list/product-videos-modal.vue', ROOT),
    'utf8',
  )

  assert.match(detailSource, /contentReadable\?: boolean/u)
  assert.match(detailSource, /contentReadable: false/u)
  assert.match(detailSource, /v-if="!contentReadable"[\s\S]{0,240}无权读取媒体内容/u)
  assert.match(
    detailSource,
    /buildProductMainImageItems\(product, contentReadable\)/u,
  )
  assert.match(
    detailSource,
    /buildProductImageItems\(product, contentReadable\)/u,
  )

  assert.match(videosSource, /contentReadable\?: boolean/u)
  assert.match(videosSource, /contentReadable: false/u)
  assert.match(
    videosSource,
    /if \(!props\.contentReadable\) \{[\s\S]{0,100}return \[\]/u,
  )
  assert.match(videosSource, /v-if="!contentReadable"[\s\S]{0,240}无权读取媒体内容/u)
})
