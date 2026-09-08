import { HttpStatus } from '@nestjs/common'

import { ApiException } from '../../../infrastructure/http/api.exception'
import {
  SalesOrderDocumentMultipartParser,
  type SalesOrderDocumentMultipartRequest,
  type SalesOrderDocumentUploadInput,
} from '../../sales-orders/documents/sales-order-document-multipart.parser'

export type PurchaseOrderDocumentMultipartRequest =
  SalesOrderDocumentMultipartRequest
export type PurchaseOrderDocumentUploadInput = SalesOrderDocumentUploadInput

/**
 * 采购与销售凭证共用经过边界验证的流式 multipart 解析规则；此适配层只负责
 * 将领域错误码与公开文案转换为采购语义，避免复制一份安全敏感的流处理代码。
 */
export class PurchaseOrderDocumentMultipartParser {
  private readonly parser = new SalesOrderDocumentMultipartParser()

  async parse<T>(
    request: PurchaseOrderDocumentMultipartRequest,
    handler: (input: PurchaseOrderDocumentUploadInput) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.parser.parse(request, handler)
    }
    catch (error) {
      if (!(error instanceof ApiException)) throw error
      const errorCode = error.code === 'SALES_ORDER_DOCUMENT_CONTENT_TOO_LARGE'
        ? 'PURCHASE_ORDER_DOCUMENT_CONTENT_TOO_LARGE'
        : error.code === 'SALES_ORDER_DOCUMENT_MULTIPART_INVALID'
          ? 'PURCHASE_ORDER_DOCUMENT_MULTIPART_INVALID'
          : null
      if (errorCode === null) throw error
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        errorCode,
        errorCode.endsWith('CONTENT_TOO_LARGE')
          ? '采购订单付款凭证文件超过大小限制'
          : '采购订单付款凭证上传请求格式无效',
      )
    }
  }
}
