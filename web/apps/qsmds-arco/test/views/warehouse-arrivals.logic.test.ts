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

test('目的地仓库与未记录筛选互斥，URL保存关键词仓库和分页而不接受其他业务筛选', () => {
  const query = parseWarehouseArrivalQuery({ view: 'SHIPPED', page: '3', pageSize: '50', keyword: '  SF123  ', destinationWarehouseValue: 'WH-01', orderDateFrom: '2026-09-01' })
  assert.deepEqual(query, { view: 'SHIPPED', page: 3, pageSize: 50, sort: 'SHIPPED_DESC', keyword: 'SF123', destinationWarehouseValue: 'WH-01' })
  assert.deepEqual(parseWarehouseArrivalQuery(buildWarehouseArrivalRouteQuery(query)), query)
  assert.equal(buildWarehouseArrivalRouteQuery(query).sort, undefined)
  assert.deepEqual(parseWarehouseArrivalQuery({ destinationWarehouseMissing: 'true', destinationWarehouseValue: 'WH-01' }), { view: 'WAREHOUSE_RECEIVED', page: 1, pageSize: 20, sort: 'WAREHOUSE_RECEIVED_DESC', destinationWarehouseMissing: true })
  assert.equal(parseWarehouseArrivalQuery({ destinationWarehouseMissing: 'false' }).destinationWarehouseMissing, undefined)
  assert.deepEqual(shipmentCountsQuery(query), { keyword: 'SF123', destinationWarehouseValue: 'WH-01' })
})

test('仓库筛选保留未记录、停用和未知历史值，选项编码不与稳定字典值冲突', () => {
  const options = buildWarehouseFilterOptions({ items: [
    { value: 'WH-01', label: '长沙仓', effectiveEnabled: true },
    { value: 'WH-OLD', label: '旧仓', effectiveEnabled: false },
  ] }, 'UNKNOWN', translate)
  assert.deepEqual(options.map(option => option.label), ['warehouseArrivals.allWarehouses', 'purchaseShipments.warehouseMissing', '长沙仓', '旧仓（purchaseShipments.disabled）', 'UNKNOWN（purchaseShipments.warehouseUnknown）'])
  assert.deepEqual(warehouseFilterToQuery(options[0]!.value), {})
  assert.deepEqual(warehouseFilterToQuery(options[1]!.value), { destinationWarehouseMissing: true })
  assert.deepEqual(warehouseFilterToQuery(options[2]!.value), { destinationWarehouseValue: 'WH-01' })
  assert.equal(warehouseFilterFromQuery({}), options[0]!.value)
  assert.deepEqual(warehouseFilterToQuery(warehouseFilterFromQuery({ destinationWarehouseValue: '__missing__' })), { destinationWarehouseValue: '__missing__' })
  assert.deepEqual(warehouseFilterToQuery(undefined), {})
  assert.equal(buildWarehouseFilterOptions(null, 'UNKNOWN', translate)[2]?.label, 'UNKNOWN')
})

test('两个视图只提供指定行操作，列时间遵循当前到仓语义', () => {
  assert.deepEqual(warehouseArrivalActions('SHIPPED', 'SHIPPED'), ['view'])
  assert.deepEqual(warehouseArrivalActions('WAREHOUSE_RECEIVED', 'WAREHOUSE_RECEIVED'), ['view', 'woodenFrame'])
  assert.deepEqual(warehouseArrivalActions('SHIPPED', 'WAREHOUSE_RECEIVED'), ['view'])
  const pending = createWarehouseArrivalColumns('SHIPPED', translate)
  const arrived = createWarehouseArrivalColumns('WAREHOUSE_RECEIVED', translate)
  assert.deepEqual(pending.map(column => column.id), ['shipmentNo', 'mark', 'destinationWarehouse', 'products', 'source', 'trackingNo', 'shippedAt'])
  assert.equal(arrived.find(column => column.id === 'shippedAt')?.defaultVisible, false)
  assert.equal(arrived.some(column => column.id === 'warehouseReceivedAt'), true)
  assert.equal(arrived.some(column => column.id === 'warehouseReceivedBy'), true)
})
