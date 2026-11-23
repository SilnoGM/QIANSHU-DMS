import { Body, Controller, HttpCode, HttpStatus, Post, Res, StreamableFile } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import { PriceQuotationSheetRequestDto } from './price-quotation-sheet.dto'
import { PriceQuotationSheetService } from './price-quotation-sheet.service'

interface ImageHttpResponse {
  setHeader(name: string, value: string): void
  status(code: number): void
}

const FORBIDDEN_CODES = ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] as const

@ApiTags('purchase-orders')
@Controller('purchase-orders')
export class PriceQuotationSheetController {
  constructor(private readonly sheets: PriceQuotationSheetService) {}

  @Post('price-quotation-sheet')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase-orders:create')
  @ApiContractResponse({
    status: HttpStatus.OK,
    description: 'Private generated price quotation sheet PNG for supplier confirmation.',
    content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiApplicationContract({
    operationId: 'purchase_orders_generate_price_quotation_sheet',
    session: 'required', authorization: true, csrf: true, badRequest: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', ...FORBIDDEN_CODES] },
      { status: 409, codes: ['PURCHASE_ORDER_STATE_CHANGED'] },
      { status: 413, codes: ['PAYLOAD_TOO_LARGE'] },
      { status: 422, codes: [
        'VALIDATION_FAILED',
        'PURCHASE_ORDER_DATE_INVALID',
        'PURCHASE_ORDER_PRODUCT_MODE_INVALID',
        'PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID',
        'PURCHASE_ORDER_CUSTOM_SUPPLIER_INVALID',
        'PURCHASE_ORDER_LINE_MODE_MISMATCH',
        'PURCHASE_ORDER_AMOUNT_INVALID',
        'PURCHASE_ORDER_QUANTITY_INVALID',
        'PURCHASE_ORDER_CUSTOM_PRICES_INVALID',
        'PURCHASE_ORDER_SUPPLIER_UNAVAILABLE',
        'PURCHASE_ORDER_PRODUCT_UNAVAILABLE',
        'PURCHASE_ORDER_PRODUCT_SUPPLIER_MISMATCH',
        'PURCHASE_ORDER_PRODUCT_COST_UNAVAILABLE',
        'PURCHASE_ORDER_IMAGE_TOO_LARGE',
      ] },
      { status: 503, codes: ['PURCHASE_ORDER_IMAGE_GENERATION_UNAVAILABLE'] },
    ],
  })
  async generate(
    @Body() dto: PriceQuotationSheetRequestDto,
    @Res({ passthrough: true }) response: ImageHttpResponse,
  ): Promise<StreamableFile> {
    const result = await this.sheets.generate(dto)
    response.setHeader('Content-Type', 'image/png')
    response.setHeader('Content-Disposition', `inline; filename="${result.filename}"`)
    response.setHeader('Content-Length', String(result.buffer.byteLength))
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    return new StreamableFile(result.buffer)
  }
}
