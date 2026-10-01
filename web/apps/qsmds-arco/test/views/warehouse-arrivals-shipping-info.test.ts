import type { PurchaseShipmentListItemDto, SalesOrderDetailDto } from '../../src/api/generated/types.gen'
import type { ShipmentShippingInfo } from '../../src/views/operations/warehouse-arrivals/shipping-info.logic'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 出货信息字段映射与复制文本口径使用 Node.js runner。
import test from 'node:test'
import {
  buildShipmentShippingInfo,
  buildShipmentShippingInfoText,
  canCopyShipmentShippingInfo,
  copyShipmentShippingInfo,
  formatShippingInfoAddress,
  formatShippingInfoBalance,
  joinShippingInfoProductNames,
  shippingInfoFields,
} from '../../src/views/operations/warehouse-arrivals/shipping-info.logic'

const shipment = {
  shippingMarkText: 'TEST/20260930-0001',
  lineSummary: { lineCount: 2, totalQuantity: 6, previews: [{ productName: '42MM 轴承座' }, { productName: '60MM 法兰' }] },
  salesSource: { id: 'so-1', orderNo: 'SO/20260930-00001', customerName: '测试' },
} as unknown as PurchaseShipmentListItemDto

const salesOrder = {
  currencyCode: 'TWD',
  customer: { name: '测试客户', phone: '0988545213', fullAddress: '台湾新北市板桥区中正路100号3楼' },
  amounts: { balanceDueAmount: '90000.0000', outstandingAmount: '30000.0000' },
} as unknown as SalesOrderDetailDto

/** 复制模板必须与弹窗展示同源，因此直接读真实中文文案，缺失的键会以原键名出现在断言差异里。 */
async function createTranslate() {
  const locale = JSON.parse(await readFile(new URL('../../src/locales/lang/warehouse-arrivals/zh-cn.json', import.meta.url), 'utf8')) as Record<string, unknown>
  return (key: string): string => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], locale) as string
}

test('产品名称按出货口径以加号连接，忽略空白项', () => {
  assert.equal(joinShippingInfoProductNames([' A ', 'B', '', '   ']), 'A+B')
  assert.equal(joinShippingInfoProductNames([]), null)
})

test('代收尾款取约定尾款，两位小数并保留销售订单币种', () => {
  assert.equal(formatShippingInfoBalance('90000.0000', 'TWD'), '90000.00 TWD')
  assert.equal(formatShippingInfoBalance('1234.5656', 'MYR'), '1234.57 MYR')
  assert.equal(formatShippingInfoBalance(null, 'TWD'), null)
  assert.equal(formatShippingInfoBalance('not-a-number', 'TWD'), null)
})

test('出货信息按固定分组取货件与销售订单资料，不使用未付尾款', async () => {
  const translate = await createTranslate()
  const info = buildShipmentShippingInfo(shipment, salesOrder, translate('warehouseArrivals.shippingInfoFreightBearer'))
  assert.deepEqual(info, {
    shippingMark: 'TEST/20260930-0001',
    productNames: '42MM 轴承座+60MM 法兰',
    customerName: '测试客户',
    customerPhone: '0988545213',
    customerAddress: '台湾新北市板桥区中正路100号3楼',
    balanceText: '90000.00 TWD',
    freightBearer: '我方承担',
    remark: null,
  })
})

test('没有销售来源或销售订单未载入时不臆造客户与代收资料', () => {
  const withoutSource = buildShipmentShippingInfo({ ...shipment, salesSource: null } as unknown as PurchaseShipmentListItemDto, null, '我方承担')
  assert.equal(withoutSource.customerName, null)
  assert.equal(withoutSource.customerPhone, null)
  assert.equal(withoutSource.customerAddress, null)
  assert.equal(withoutSource.balanceText, null)
  assert.equal(withoutSource.shippingMark, 'TEST/20260930-0001')
  assert.equal(withoutSource.productNames, '42MM 轴承座+60MM 法兰')
})

test('复制文本逐行标签值，保留分组空行与结束时行', async () => {
  const translate = await createTranslate()
  const info = buildShipmentShippingInfo(shipment, salesOrder, translate('warehouseArrivals.shippingInfoFreightBearer'))
  assert.equal(buildShipmentShippingInfoText(info, translate), [
    '【出货信息】',
    '货件唛头：TEST/20260930-0001',
    '产品名称：42MM 轴承座+60MM 法兰',
    '',
    '客户姓名：测试客户',
    '客户电话：0988545213',
    '收货地址：新北市板桥区中正路100号3楼',
    '',
    '代收尾款：90000.00 TWD',
    '运费承担：我方承担',
    '',
    '备注：',
  ].join('\n'))
})

test('复制收货地址依次去掉国家与省级前缀「中国台湾」「台湾」，地址正文里的同名文字不动', () => {
  assert.equal(formatShippingInfoAddress('中国台湾台湾新竹縣啊啊啊啊'), '新竹縣啊啊啊啊')
  assert.equal(formatShippingInfoAddress('中國台灣臺灣新竹縣啊啊啊啊'), '新竹縣啊啊啊啊')
  assert.equal(formatShippingInfoAddress('中国台湾新竹縣啊啊啊啊'), '新竹縣啊啊啊啊')
  assert.equal(formatShippingInfoAddress('台湾臺北市大安區復興南路1號'), '臺北市大安區復興南路1號')
  assert.equal(formatShippingInfoAddress('中国台湾'), null)
  assert.equal(formatShippingInfoAddress('台湾'), null)
  assert.equal(formatShippingInfoAddress('中国北京市北京市测试路1号'), '中国北京市北京市测试路1号')
  assert.equal(formatShippingInfoAddress('新竹縣中国台湾路1号'), '新竹縣中国台湾路1号')
  // 只按「国家 → 省」各去一次，不循环剥离，避免把地址正文开头的同名文字一起吃
  assert.equal(formatShippingInfoAddress('台湾台湾新竹縣'), '台湾新竹縣')
  assert.equal(formatShippingInfoAddress(null), null)
  assert.equal(formatShippingInfoAddress('   '), null)
})

test('复制文本按去掉前缀后的地址输出，界面展示值仍保留完整地址', async () => {
  const translate = await createTranslate()
  const taiwanOrder = { ...salesOrder, customer: { ...salesOrder.customer, fullAddress: '中国台湾台湾新竹縣啊啊啊啊' } } as unknown as SalesOrderDetailDto
  const info = buildShipmentShippingInfo(shipment, taiwanOrder, translate('warehouseArrivals.shippingInfoFreightBearer'))
  assert.equal(info.customerAddress, '中国台湾台湾新竹縣啊啊啊啊')
  assert.match(buildShipmentShippingInfoText(info, translate), /\n收货地址：新竹縣啊啊啊啊\n/u)
  assert.doesNotMatch(buildShipmentShippingInfoText(info, translate), /中国台湾|中国/u)
})

test('复制文本缺值留空而不写占位符，多行备注保持换行', async () => {
  const translate = await createTranslate()
  const empty: ShipmentShippingInfo = {
    shippingMark: null,
    productNames: null,
    customerName: null,
    customerPhone: null,
    customerAddress: null,
    balanceText: null,
    freightBearer: translate('warehouseArrivals.shippingInfoFreightBearer'),
    remark: null,
  }
  const text = buildShipmentShippingInfoText(empty, translate)
  assert.match(text, /货件唛头：\n/u)
  assert.match(text, /备注：$/u)
  assert.doesNotMatch(text, /—|未记录|不涉及/u)
  assert.match(buildShipmentShippingInfoText({ ...empty, remark: '第一行\n第二行' }, translate), /备注：第一行\n第二行$/u)
})

test('弹窗字段按固定分组与顺序展示，取销售订单的客户与代收资料', async () => {
  const translate = await createTranslate()
  const info = buildShipmentShippingInfo(shipment, salesOrder, translate('warehouseArrivals.shippingInfoFreightBearer'))
  const fields = shippingInfoFields(info, translate)
  assert.deepEqual(fields.map(field => [field.label, field.value]), [
    ['货件唛头', 'TEST/20260930-0001'],
    ['产品名称', '42MM 轴承座+60MM 法兰'],
    ['客户姓名', '测试客户'],
    ['客户电话', '0988545213'],
    ['收货地址', '台湾新北市板桥区中正路100号3楼'],
    ['代收尾款', '90000.00 TWD'],
    ['运费承担', '我方承担'],
    ['备注', null],
  ])
  assert.deepEqual(fields.map(field => field.groupStart), [false, false, true, false, false, true, false, true])
})

test('销售订单未载入时客户与代收尾款留空，货件侧字段不受影响', async () => {
  const translate = await createTranslate()
  const fields = shippingInfoFields(buildShipmentShippingInfo(shipment, null, translate('warehouseArrivals.shippingInfoFreightBearer')), translate)
  assert.deepEqual(fields.map(field => field.value), ['TEST/20260930-0001', '42MM 轴承座+60MM 法兰', null, null, null, null, '我方承担', null])
})

test('复制动作把与展示同源的文本写入剪贴板，失败返回 false 而不抛出', async () => {
  const translate = await createTranslate()
  const info = buildShipmentShippingInfo(shipment, salesOrder, translate('warehouseArrivals.shippingInfoFreightBearer'))
  const written: string[] = []
  const accept = { writeText: async (text: string) => {
    written.push(text)
  } }
  const deny = { writeText: async () => {
    throw new Error('clipboard denied')
  } }
  assert.equal(await copyShipmentShippingInfo(info, translate, accept), true)
  assert.equal(written[0], buildShipmentShippingInfoText(info, translate))
  assert.match(written[0]!, /^【出货信息】\n货件唛头：TEST\/20260930-0001/u)
  assert.equal(await copyShipmentShippingInfo(info, translate, deny), false)
  assert.equal(await copyShipmentShippingInfo(info, translate, undefined), false)
})

test('资料未齐（加载中或读取失败）时不允许复制，避免发出半份资料', async () => {
  const translate = await createTranslate()
  const info = buildShipmentShippingInfo(shipment, salesOrder, translate('warehouseArrivals.shippingInfoFreightBearer'))
  assert.equal(canCopyShipmentShippingInfo({ info, loading: false, error: null }), true)
  assert.equal(canCopyShipmentShippingInfo({ info, loading: true, error: null }), false)
  assert.equal(canCopyShipmentShippingInfo({ info, loading: false, error: '销售订单读取失败' }), false)
  assert.equal(canCopyShipmentShippingInfo({ info: null, loading: false, error: null }), false)
})

test('弹窗只提供尾款有误与复制信息两个按钮，复用通用弹窗且不额外读取数据', async () => {
  const source = await readFile(new URL('../../src/views/operations/warehouse-arrivals/shipping-info-modal.vue', import.meta.url), 'utf8')
  const footer = source.split('<template #footer>')[1]!.split('</template>')[0]!
  assert.equal([...footer.matchAll(/<FaButton/gu)].length, 2)
  assert.match(footer, /variant="destructive"[\s\S]*shippingInfoBalanceWrong/u)
  assert.match(footer, /:loading="copying"[\s\S]*shippingInfoCopy/u)
  assert.doesNotMatch(footer, /关闭|outline/u)
  assert.match(source, /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u)
  // 弹窗只消费父级已读到的资料：不直接调接口、不读全局身份状态。
  assert.doesNotMatch(source, /api\/modules|useApp\w*Store|useAppAuth/u)
  // 尾款有误本期只轻提示：动作函数里不能出现业务写入或数据读取。
  const report = source.slice(source.indexOf('function reportBalanceWrong'), source.indexOf('</script>'))
  assert.match(report, /toast\.info\(t\('warehouseArrivals\.shippingInfoBalanceWrongUnavailable'\)\)/u)
  assert.doesNotMatch(report, /await|emit\(/u)
})
