import {
  advertisingRechargeStatusLabel,
  formatNotificationDate,
  formatNotificationDateTime,
  machineViewingMachineTypeLabel,
  machineViewingPeriodLabel,
  machineViewingSiteLabel,
  machineViewingStatusLabel,
  purchaseOrderFulfillmentStatusLabel,
  purchaseOrderPaymentStatusLabel,
  purchaseOrderStatusLabel,
  salesOrderFulfillmentStatusLabel,
  salesOrderPaymentStatusLabel,
  salesOrderPaymentTypeLabel,
  salesOrderStatusLabel,
} from './notification-display-labels'

describe('notification display labels', () => {
  it('renders sales receipt payment types as Chinese labels', () => {
    expect(salesOrderPaymentTypeLabel('DEPOSIT')).toBe('定金')
    expect(salesOrderPaymentTypeLabel('PROGRESS')).toBe('过程款')
    expect(salesOrderPaymentTypeLabel('INVOICE_TAX')).toBe('开票税金')
    expect(salesOrderPaymentTypeLabel('BALANCE')).toBe('尾款')
    expect(salesOrderPaymentTypeLabel('OTHER')).toBe('其他')
    expect(salesOrderPaymentTypeLabel('COD_BALANCE')).toBe('代收尾款')
    expect(salesOrderPaymentTypeLabel('UNKNOWN_VALUE')).toBe('—')
    expect(salesOrderPaymentTypeLabel(null)).toBe('—')
  })

  it('renders machine viewing enums as Chinese labels', () => {
    expect(machineViewingSiteLabel('NEW_TAIPEI_LINKOU')).toBe('新北林口')
    expect(machineViewingSiteLabel('TAICHUNG_LONGJING')).toBe('台中龙井')
    expect(machineViewingMachineTypeLabel('MINI_TILLER')).toBe('微耕机')
    expect(machineViewingMachineTypeLabel('SHREDDER')).toBe('撕碎机')
    expect(machineViewingMachineTypeLabel('INCINERATOR')).toBe('焚烧炉')
    expect(machineViewingPeriodLabel('AM')).toBe('上午')
    expect(machineViewingPeriodLabel('PM')).toBe('下午')
    expect(machineViewingStatusLabel('PENDING_APPOINTMENT')).toBe('待预约')
  })

  it('renders order and payment statuses as Chinese labels', () => {
    expect(salesOrderStatusLabel('PENDING_RECONCILIATION')).toBe('待对账')
    expect(salesOrderPaymentStatusLabel('PARTIALLY_PAID')).toBe('部分付款')
    expect(salesOrderFulfillmentStatusLabel('SEA_TRANSIT')).toBe('海运中')
    expect(purchaseOrderStatusLabel('PENDING_REVIEW')).toBe('待审核')
    expect(purchaseOrderPaymentStatusLabel('PAID')).toBe('已付清')
    expect(purchaseOrderFulfillmentStatusLabel('PARTIALLY_SHIPPED')).toBe('部分发货')
    expect(advertisingRechargeStatusLabel('PENDING')).toBe('待付款')
    expect(advertisingRechargeStatusLabel('VOIDED')).toBe('已作废')
    expect(advertisingRechargeStatusLabel(undefined)).toBe('—')
  })

  it('formats notification times in Asia/Shanghai wall clock', () => {
    expect(formatNotificationDateTime(new Date('2026-11-12T06:59:22.000Z'))).toBe('2026-11-12 14:59')
    expect(formatNotificationDate(new Date('2026-11-11T16:30:00.000Z'))).toBe('2026-11-12')
    expect(formatNotificationDateTime(null)).toBe('—')
    expect(formatNotificationDate(new Date(Number.NaN))).toBe('—')
  })
})
