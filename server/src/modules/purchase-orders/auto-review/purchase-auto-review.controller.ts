import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Put,
  Req,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../../openapi/contract-metadata'
import { ApiContractResponse } from '../../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../../auth/auth-context'
import { RequirePermissions } from '../../auth/decorators/auth.decorators'
import {
  PurchaseAutoReviewSettingDto,
  PurchaseAutoReviewSettingUpdateRequestDto,
} from './purchase-auto-review.dto'
import {
  PurchaseAutoReviewService,
  type PurchaseAutoReviewContext,
} from './purchase-auto-review.service'

function contract(
  operationId: string,
  mutation = false,
  errors: ApiContractErrorOptions[] = [],
) {
  return ApiApplicationContract({
    operationId,
    session: 'required',
    authorization: true,
    csrf: mutation,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      {
        status: 403,
        codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])],
      },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      ...errors,
    ],
  })
}

function context(request: object): PurchaseAutoReviewContext {
  return {
    actorUserId: getRequestAuthContext(request).userId,
    requestId: getRequestId(request),
  }
}

/**
 * 采购审核自动托管设置。读取对审核人开放，便于工作台展示当前状态与心跳；
 * 写入需要独立的系统级权限，因为开启后会跳过人工复核。
 */
@ApiTags('purchase-orders')
@Controller('purchase-orders')
export class PurchaseAutoReviewController {
  constructor(private readonly autoReview: PurchaseAutoReviewService) {}

  @Get('auto-review-setting')
  @RequirePermissions('purchase-orders:review')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseAutoReviewSettingDto })
  @contract('purchase_orders_auto_review_setting_read')
  read(): Promise<PurchaseAutoReviewSettingDto> {
    return this.autoReview.read()
  }

  @Put('auto-review-setting')
  @RequirePermissions('purchase-orders:auto-review')
  @ApiContractResponse({ status: HttpStatus.OK, type: PurchaseAutoReviewSettingDto })
  @contract('purchase_orders_auto_review_setting_update', true, [
    { status: 409, codes: ['PURCHASE_AUTO_REVIEW_STATE_CHANGED'] },
  ])
  update(
    @Body() input: PurchaseAutoReviewSettingUpdateRequestDto,
    @Req() request: object,
  ): Promise<PurchaseAutoReviewSettingDto> {
    return this.autoReview.update(context(request), input)
  }
}
