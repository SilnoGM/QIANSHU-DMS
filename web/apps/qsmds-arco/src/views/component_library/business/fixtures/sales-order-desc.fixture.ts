import type { QsSalesOrderDescViewModel } from '@/components/business/QsSalesOrderDesc/types'
import productImageSrc from '@/assets/images/component-library/image-group/product-front.svg?url'
import deliveryReceiptSrc from '@/assets/images/component-library/image-group/product-label.svg?url'
import depositVoucherSrc from '@/assets/images/component-library/image-group/product-package.svg?url'

/**
 * 组件库专用的确定性销售订单快照。
 *
 * 数据刻意同时覆盖正式产品、订单临时产品、三段金额与两类图片凭证；它不代表
 * 生产默认值，也不会读取 API、Store 或浏览器身份。正式页面必须在自己的边界
 * 将表单模型或详情 DTO 映射为 QsSalesOrderDescViewModel。
 */
export const SALES_ORDER_DESC_SHOWCASE_MODEL = {
  amounts: {
    agreedTotalAmount: '180000.00',
    balanceDueAmount: '150000.00',
    depositDueAmount: '30000.00',
    lineSubtotalAmount: '180000.00',
  },
  currencyCode: 'TWD',
  customer: {
    fullAddress: '中国台湾台湾高雄市苓雅区中正一路100号3楼',
    name: '林晓芳',
    phone: '+886 912 345 678',
    regionNames: ['中国台湾', '台湾', '高雄市'],
  },
  documents: [
    {
      documentType: 'ORDER_ISSUANCE_VOUCHER',
      key: 'document-issuance-voucher',
      mediaType: 'IMAGE',
      originalFilename: 'issuance-voucher.jpg',
      previewSrc: depositVoucherSrc,
      thumbnailSrc: depositVoucherSrc,
      title: '林晓芳-出单凭证-20260821142415001',
    },
    {
      documentType: 'DELIVERY_RECEIPT',
      key: 'document-delivery-receipt',
      mediaType: 'IMAGE',
      originalFilename: 'delivery-receipt.jpg',
      previewSrc: deliveryReceiptSrc,
      thumbnailSrc: deliveryReceiptSrc,
      title: '林晓芳-签收单-20260821142415002',
    },
  ],
  issuerName: 'SilnoGM',
  lines: [
    {
      actualUnitPriceAmount: '120000.00',
      description: '模块化收纳组合，包含柜体、层板与标准五金。',
      key: 'line-catalog-product',
      lineSubtotalAmount: '120000.00',
      lineType: 'CATALOG',
      mainImage: {
        alt: '千树标准组合柜主图',
        src: productImageSrc,
      },
      productName: '千树标准组合柜',
      productNo: 'PRD-202608-001',
      quantity: '1',
    },
    {
      actualUnitPriceAmount: '30000.00',
      description: '包含上门安装、调试及现场交付说明。',
      key: 'line-custom-product',
      lineSubtotalAmount: '60000.00',
      lineType: 'CUSTOM',
      mainImage: null,
      productName: '订单专用安装服务',
      productNo: null,
      quantity: '2',
    },
  ],
  orderDate: '2026-08-21',
  orderNo: null,
} as const satisfies QsSalesOrderDescViewModel
