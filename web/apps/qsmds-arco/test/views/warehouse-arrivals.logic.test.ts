import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 到仓页面查询、展示与只读操作边界使用 Node.js runner。
import test from 'node:test'
import {
  buildWarehouseArrivalRouteQuery,
  buildWarehouseFilterOptions,
  createWarehouseArrivalColumns,
  parseWarehouseArrivalQuery,
  WAREHOUSE_ARRIVAL_VIEWS,
  warehouseArrivalActions,
  warehouseFilterFromQuery,
  warehouseFilterToQuery,
} from '../../src/views/operations/warehouse-arrivals/logic'
import { shipmentCountsQuery } from '../../src/views/workbenches/shipments/logic'

const translate = (key: string) => key

test('到仓货件仅有待到仓和已到仓，默认已到仓并按对应业务时间倒序', () => {
  assert.deepEqual(WAREHOUSE_ARRIVAL_VIEWS, ['SHIPPED', 'WAREHOUSE_RECEIVED'])
  assert.deepEqual(parseWarehouseArrivalQuery({}), { view: 'WAREHOUSE_RECEIVED', page: 1, pageSize: 20, sort: 'WAREHOUSE_RECEIVED_DESC' })
  assert.equal(parseWarehouseArrivalQuery({ view: 'SHIPPED', sort: 'CREATED_DESC' }).sort, 'SHIPPED_DESC')
  assert.equal(parseWarehouseArrivalQuery({ view: 'ALL' }).view, 'WAREHOUSE_RECEIVED')
  assert.equal(parseWarehouseArrivalQuery({ view: ['SHIPPED'], page: '-1', pageSize: '999' }).page, 1)
})

test('URL保存关键词仓库和分页，不再接受未记录筛选', () => {
  const query = parseWarehouseArrivalQuery({ view: 'SHIPPED', page: '3', pageSize: '50', keyword: '  SF123  ', destinationWarehouseValue: 'WH-01', orderDateFrom: '2026-09-01' })
  assert.deepEqual(query, { view: 'SHIPPED', page: 3, pageSize: 50, sort: 'SHIPPED_DESC', keyword: 'SF123', destinationWarehouseValue: 'WH-01' })
  assert.deepEqual(parseWarehouseArrivalQuery(buildWarehouseArrivalRouteQuery(query)), query)
  assert.equal(buildWarehouseArrivalRouteQuery(query).sort, undefined)
  assert.deepEqual(parseWarehouseArrivalQuery({ destinationWarehouseMissing: 'true', destinationWarehouseValue: 'WH-01' }), { view: 'WAREHOUSE_RECEIVED', page: 1, pageSize: 20, sort: 'WAREHOUSE_RECEIVED_DESC', destinationWarehouseValue: 'WH-01' })
  assert.equal(parseWarehouseArrivalQuery({ destinationWarehouseMissing: 'true' }).destinationWarehouseMissing, undefined)
  assert.equal(parseWarehouseArrivalQuery({ destinationWarehouseMissing: 'false' }).destinationWarehouseMissing, undefined)
  assert.deepEqual(shipmentCountsQuery(query), { keyword: 'SF123', destinationWarehouseValue: 'WH-01' })
})

test('仓库筛选移除未记录，其他按字典稳定值查询，保留停用和未知历史值', () => {
  const options = buildWarehouseFilterOptions({ items: [
    { value: 'WH-01', label: '长沙仓', effectiveEnabled: true },
    { value: 'WH-OLD', label: '旧仓', effectiveEnabled: false },
    { value: 'QITA', label: '其他', effectiveEnabled: true },
  ] }, 'UNKNOWN', translate)
  assert.deepEqual(options.map(option => option.label), ['warehouseArrivals.allWarehouses', '长沙仓', '旧仓（purchaseShipments.disabled）', '其他', 'UNKNOWN（purchaseShipments.warehouseUnknown）'])
  assert.deepEqual(warehouseFilterToQuery(options[0]!.value), {})
  assert.deepEqual(warehouseFilterToQuery(options[1]!.value), { destinationWarehouseValue: 'WH-01' })
  assert.deepEqual(warehouseFilterToQuery(options[3]!.value), { destinationWarehouseValue: 'QITA' })
  assert.equal(warehouseFilterFromQuery({}), options[0]!.value)
  assert.deepEqual(warehouseFilterToQuery('__missing__'), {})
  assert.deepEqual(warehouseFilterToQuery(undefined), {})
  assert.equal(buildWarehouseFilterOptions(null, 'UNKNOWN', translate)[1]?.label, 'UNKNOWN')
})

test('两个视图只提供指定行操作，列时间遵循当前到仓语义', () => {
  const warehouse = 'SLH.SZ.BA.SJJD.HSNP.B5'
  assert.deepEqual(warehouseArrivalActions('SHIPPED', 'SHIPPED', warehouse), ['view'])
  assert.deepEqual(warehouseArrivalActions('WAREHOUSE_RECEIVED', 'WAREHOUSE_RECEIVED', warehouse), ['view', 'shippingInfo', 'woodenFrame'])
  assert.deepEqual(warehouseArrivalActions('SHIPPED', 'WAREHOUSE_RECEIVED', warehouse), ['view'])
  assert.deepEqual(warehouseArrivalActions('WAREHOUSE_RECEIVED', 'SHIPPED', warehouse), ['view'])
  assert.deepEqual(warehouseArrivalActions('WAREHOUSE_RECEIVED', 'WAREHOUSE_RECEIVED', 'YJ.594540.DGHM.ZTBHCG.B.DXM'), ['view', 'shippingInfo', 'seaExpress'])
  assert.deepEqual(warehouseArrivalActions('SHIPPED', 'SHIPPED', 'YJ.594540.DGHM.ZTBHCG.B.DXM'), ['view'])
  for (const otherWarehouse of ['SLH.DW.FHSNL.4HGYQ.B', 'QITA', 'UNKNOWN', null]) {
    assert.deepEqual(warehouseArrivalActions('WAREHOUSE_RECEIVED', 'WAREHOUSE_RECEIVED', otherWarehouse), ['view', 'shippingInfo'])
  }
  const pending = createWarehouseArrivalColumns('SHIPPED', translate)
  const arrived = createWarehouseArrivalColumns('WAREHOUSE_RECEIVED', translate)
  assert.deepEqual(pending.map(column => column.id), ['shipmentNo', 'mark', 'destinationWarehouse', 'products', 'source', 'trackingNo', 'shippedAt'])
  assert.equal(arrived.find(column => column.id === 'shippedAt')?.defaultVisible, false)
  assert.equal(arrived.some(column => column.id === 'warehouseReceivedAt'), true)
  assert.equal(arrived.some(column => column.id === 'warehouseReceivedBy'), true)
})
