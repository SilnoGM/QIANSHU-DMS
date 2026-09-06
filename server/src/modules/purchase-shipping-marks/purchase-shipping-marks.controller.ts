import { Body, Controller, Get, HttpStatus, Param, Put, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import {
  SaveShippingMarkBindingDto, ShippingMarkBindingDto, ShippingMarkBindingPageDto,
  ShippingMarkBindingQueryDto, ShippingMarkOptionsPageDto, ShippingMarkOptionsQueryDto, ShippingMarkSupplierParamDto,
} from './shipping-mark-binding.dto'
import { PurchaseShippingMarksService } from './purchase-shipping-marks.service'

const READ_ERRORS = [
  { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
  { status: 422, codes: ['VALIDATION_FAILED'] },
] as const

/** 配置权限与编号维护权限分开；此 Controller 不暴露任何发号、预览或采购写接口。 */
@ApiTags('purchase-shipping-mark-bindings')
@Controller('purchase-shipping-mark-bindings')
export class PurchaseShippingMarksController {
  constructor(private readonly service: PurchaseShippingMarksService) {}

  @Get()
  @RequirePermissions('purchase-shipping-marks:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShippingMarkBindingPageDto })
  @ApiApplicationContract({ operationId: 'shipping_mark_bindings_list', session: 'required', authorization: true, badRequest: true, validation: true, privateNoStore: true, errors: READ_ERRORS })
  list(@Query() query: ShippingMarkBindingQueryDto) { return this.service.list(query) }

  @Get('rule-options')
  @RequirePermissions('purchase-shipping-marks:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShippingMarkOptionsPageDto })
  @ApiApplicationContract({ operationId: 'shipping_mark_bindings_options', session: 'required', authorization: true, badRequest: true, validation: true, privateNoStore: true, errors: READ_ERRORS })
  options(@Query() query: ShippingMarkOptionsQueryDto) { return this.service.options(query) }

  @Put(':supplierValue')
  @RequirePermissions('purchase-shipping-marks:read', 'purchase-shipping-marks:update')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShippingMarkBindingDto })
  @ApiApplicationContract({
    operationId: 'shipping_mark_bindings_save', session: 'required', authorization: true, csrf: true, badRequest: true, conflict: true, validation: true, privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      { status: 409, codes: ['SHIPPING_MARK_BINDING_CHANGED', 'SHIPPING_MARK_RULE_UNAVAILABLE', 'SHIPPING_MARK_SUPPLIER_UNAVAILABLE'] },
    ],
  })
  save(@Param() param: ShippingMarkSupplierParamDto, @Body() body: SaveShippingMarkBindingDto, @Req() request: object) {
    return this.service.save({ actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) }, param.supplierValue, body)
  }
}
