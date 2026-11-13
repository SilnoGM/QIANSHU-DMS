import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import { ApiHeader, ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../../auth/auth-context'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import {
  PurchaseCorrectionContextDto,
  PurchaseCorrectionRequestDto,
  PurchaseCorrectionResultDto,
  PurchaseCorrectionSalesOrderIdDto,
} from './purchase-correction.dto'
import { PurchaseCorrectionService, type PurchaseCorrectionContext } from './purchase-correction.service'

const COMMON_FORBIDDEN_ERRORS = [
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
] as const
const COMMON_MUTATION_FORBIDDEN_ERRORS = [
  'CSRF_REJECTED',
  ...COMMON_FORBIDDEN_ERRORS,
] as const

const CORRECTION_BLOCKER_CODES = [
  'PURCHASE_CORRECTION_CONFIRMATION_MISMATCH',
  'PURCHASE_CORRECTION_LOAD_GROUP_MISMATCH',
  'PURCHASE_CORRECTION_NO_ACTIVE_PURCHASE',
  'PURCHASE_CORRECTION_NOT_ALLOWED',
  'PURCHASE_CORRECTION_OTHER_COVERAGE',
  'PURCHASE_CORRECTION_OWNERSHIP_CHANGED',
  'PURCHASE_CORRECTION_PACKAGING_PAID',
  'PURCHASE_CORRECTION_RECONCILING',
  'PURCHASE_CORRECTION_SIGNED',
  'PURCHASE_CORRECTION_STORAGE_RECORD',
] as const

function correctionContext(request: object): PurchaseCorrectionContext {
  return {
    actorUserId: getRequestAuthContext(request).userId,
    requestId: getRequestId(request),
  }
}

@ApiTags('purchase-order-corrections')
@Controller('purchase-order-corrections')
export class PurchaseCorrectionController {
  constructor(private readonly corrections: PurchaseCorrectionService) {}

  @Get('context/:salesOrderId')
  @RequirePermissions('purchase-orders:correction')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseCorrectionContextDto })
  @ApiApplicationContract({
    operationId: 'purchase_order_correction_context',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
    ],
  })
  context(
    @Param() params: PurchaseCorrectionSalesOrderIdDto,
    @Req() request: object,
  ): Promise<PurchaseCorrectionContextDto> {
    return this.corrections.context(correctionContext(request), params.salesOrderId)
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchase-orders:correction', 'purchase-orders:payment')
  @ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseCorrectionResultDto })
  @ApiApplicationContract({
    operationId: 'purchase_order_correction_apply',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: [...COMMON_MUTATION_FORBIDDEN_ERRORS] },
      { status: 404, codes: ['SALES_ORDER_NOT_FOUND'] },
      { status: 409, codes: [
        'PURCHASE_CORRECTION_IDEMPOTENCY_CONFLICT',
        'PURCHASE_CORRECTION_IN_PROGRESS',
        'PURCHASE_CORRECTION_STATE_CHANGED',
      ] },
      { status: 422, codes: [...CORRECTION_BLOCKER_CODES, 'VALIDATION_FAILED'] },
    ],
  })
  apply(
    @Body() dto: PurchaseCorrectionRequestDto,
    @Headers('idempotency-key') key: unknown,
    @Req() request: object,
  ): Promise<PurchaseCorrectionResultDto> {
    return this.corrections.apply(correctionContext(request), dto, key)
  }
}
