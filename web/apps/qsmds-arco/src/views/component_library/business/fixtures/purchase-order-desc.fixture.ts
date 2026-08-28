import type { QsPurchaseOrderDescViewModel } from '@/components/business/QsPurchaseOrderDesc/types'

import productImageSrc from '@/assets/images/component-library/image-group/product-front.svg?url'

/**
 * 组件库专用的确定性采购订单快照。
 *
 * 数据覆盖正式产品、临时产品、采购双价、付款进度和三类状态，不读取 API、
 * Store 或浏览器身份，也不作为任何生产默认值。
 */
export const PURCHASE_ORDER_DESC_SHOWCASE_MODEL = {
  amounts: {
    balanceDueAmount: '90000.00',
    depositDueAmount: '30000.00',
    lineSubtotalAmount: '120000.00',
    outstandingAmount: '90000.00',
    paidAmount: '30000.00',
    purchaseTotalAmount: '120000.00',
  },
  createdAt: '2026-08-28T08:15:00.000Z',
  currencyCode: 'CNY',
  issuerName: 'SilnoGM',
  lines: [
    {
      actualPurchaseUnitPriceAmount: '55000.00',
      description: '按销售订单要求采购标准组合柜。',
      key: 'purchase-line-catalog',
      lineSubtotalAmount: '110000.00',
      lineType: 'CATALOG',
      mainImage: {
        alt: '千树标准组合柜主图',
        src: productImageSrc,
      },
      productName: '千树标准组合柜',
      productNo: 'PROD/202608-001',
      quantity: '2',
      referencePurchaseUnitPriceAmount: '58000.00',
    },
    {
      actualPurchaseUnitPriceAmount: '10000.00',
      description: '供应商现场包装服务。',
      key: 'purchase-line-custom',
      lineSubtotalAmount: '10000.00',
      lineType: 'CUSTOM',
      mainImage: null,
      productName: '订单专用包装服务',
      productNo: null,
      quantity: '1',
      referencePurchaseUnitPriceAmount: '10000.00',
    },
  ],
  orderDate: '2026-08-28',
  orderNo: 'PO/20260828-00001',
  purchaseTypeLabel: '销售关联采购',
  remark: '供应商发货前请复核外包装。',
  shippingMarkText: 'QS-SO-20260827-00008\n客户：孙伟',
  source: {
    customerName: '孙伟',
    salesOrderNo: 'SO/20260827-00008',
  },
  statuses: [
    { key: 'ORDER', label: '订单状态', tone: 'success', value: '已确认' },
    { key: 'FULFILLMENT', label: '履约状态', tone: 'warning', value: '备货中' },
    { key: 'PAYMENT', label: '付款状态', tone: 'warning', value: '部分付款' },
  ],
  supplierLabel: '千树测试供应商',
  updatedAt: '2026-08-28T10:30:00.000Z',
} as const satisfies QsPurchaseOrderDescViewModel
