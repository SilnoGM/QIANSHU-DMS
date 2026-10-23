import { resolveSalesOrderQueryTargets } from './sales-order-list-selection.logic'

describe('resolveSalesOrderQueryTargets', () => {
  it('待采购排除审核中占用', () => {
    expect(resolveSalesOrderQueryTargets('pending', 'PENDING')).toEqual([{
      fulfillmentStatus: 'PENDING',
      orderStatus: 'CONFIRMED',
      purchaseHold: 'EXCLUDE_AWAITING_PURCHASE_REVIEW',
    }])
  })

  it('采购审核中是独立的互斥分桶', () => {
    expect(resolveSalesOrderQueryTargets('pending', 'AWAITING_PURCHASE_REVIEW')).toEqual([{
      fulfillmentStatus: 'PENDING',
      orderStatus: 'CONFIRMED',
      purchaseHold: 'AWAITING_PURCHASE_REVIEW',
    }])
  })

  it('全部待办合并五个履约分桶与两个收款分桶', () => {
    const targets = resolveSalesOrderQueryTargets('pending', 'ALL')
    expect(targets).toHaveLength(7)
    expect(targets.slice(0, 5).map(target => target.fulfillmentStatus)).toEqual([
      'PENDING',
      'PREPARING',
      'LAND_TRANSIT',
      'WAREHOUSE_ARRIVED',
      'SEA_TRANSIT',
    ])
    expect(targets.slice(5)).toEqual([
      { orderStatus: 'CONFIRMED', paymentStatus: 'UNPAID' },
      { orderStatus: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID' },
    ])
  })

  it('全部订单覆盖四个正式状态', () => {
    expect(resolveSalesOrderQueryTargets('all', 'ALL')).toEqual([
      { orderStatus: 'CONFIRMED' },
      { orderStatus: 'PENDING_RECONCILIATION' },
      { orderStatus: 'CANCELLED' },
      { orderStatus: 'COMPLETED' },
    ])
  })

  it('不在当前视图的分类不产生目标', () => {
    expect(resolveSalesOrderQueryTargets('all', 'PENDING')).toEqual([])
    expect(resolveSalesOrderQueryTargets('pending', 'COMPLETED')).toEqual([])
  })
})
