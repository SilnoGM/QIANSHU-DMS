import {
  Body,
  Controller,
  Get,
  Head,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ImmutableMediaContentCache } from '../../infrastructure/http/private-no-store.interceptor'
import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { ApiProductMediaContentContract } from '../products/media/product-media-content.contract'
import {
  applyProductMediaContentResponse,
  type ProductMediaContentHttpResponse,
} from '../products/media/product-media-content.http'
import {
  ClaimShipmentStorageRequestDto,
  RelocateShipmentStorageRequestDto,
  ReleaseShipmentStorageRequestDto,
  RejectShipmentStorageClaimRequestDto,
  ShipmentStorageClaimRequestDto,
  ShipmentStorageClaimRequestParamsDto,
  ShipmentStorageDetailDto,
  ShipmentStorageIdParamDto,
  ShipmentStorageLineImageParamDto,
  ShipmentStorageListQueryDto,
  ShipmentStoragePageDto,
  ShipmentStorageStatusCountsDto,
} from './shipment-storage.dto'
import { ShipmentStorageImageService } from './shipment-storage-image.service'
import { ShipmentStorageService } from './shipment-storage.service'

@ApiTags('shipment-storage')
@Controller('shipment-storage')
export class ShipmentStorageController {
  constructor(
    private readonly storage: ShipmentStorageService,
    private readonly images: ShipmentStorageImageService,
  ) {}

  @Get()
  @RequirePermissions('shipment-storage:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShipmentStoragePageDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  list(@Query() query: ShipmentStorageListQueryDto): Promise<ShipmentStoragePageDto> {
    return this.storage.list(query)
  }

  @Get('status-counts')
  @RequirePermissions('shipment-storage:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShipmentStorageStatusCountsDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_status_counts',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  statusCounts(@Query() query: ShipmentStorageListQueryDto): Promise<ShipmentStorageStatusCountsDto> {
    return this.storage.statusCounts(query)
  }

  @Get(':storageRecordId')
  @RequirePermissions('shipment-storage:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShipmentStorageDetailDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_detail',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['SHIPMENT_STORAGE_NOT_FOUND'] },
    ],
  })
  detail(@Param() params: ShipmentStorageIdParamDto): Promise<ShipmentStorageDetailDto> {
    return this.storage.getById(params.storageRecordId)
  }

  @Head(':storageRecordId/lines/:lineId/main-image/:productMediaId/content')
  @ImmutableMediaContentCache()
  @RequirePermissions('shipment-storage:read')
  @ApiProductMediaContentContract('HEAD', {
    operationId: 'shipment_storage_head_product_main_image',
    notFoundCode: 'SHIPMENT_STORAGE_PRODUCT_IMAGE_NOT_FOUND',
    description: 'Authorized shipment storage product main image.',
  })
  async headProductMainImage(
    @Param() params: ShipmentStorageLineImageParamDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Headers('range') range: unknown,
    @Query('variant') variant: unknown,
    @Res({ passthrough: true }) response: ProductMediaContentHttpResponse,
  ): Promise<void> {
    const result = await this.images.resolve(
      params.storageRecordId,
      params.lineId,
      params.productMediaId,
      ifNoneMatch,
      range,
      'HEAD',
      variant,
    )
    applyProductMediaContentResponse(response, result)
  }

  @Get(':storageRecordId/lines/:lineId/main-image/:productMediaId/content')
  @ImmutableMediaContentCache()
  @RequirePermissions('shipment-storage:read')
  @ApiProductMediaContentContract('GET', {
    operationId: 'shipment_storage_get_product_main_image',
    notFoundCode: 'SHIPMENT_STORAGE_PRODUCT_IMAGE_NOT_FOUND',
    description: 'Authorized shipment storage product main image.',
  })
  async getProductMainImage(
    @Param() params: ShipmentStorageLineImageParamDto,
    @Headers('if-none-match') ifNoneMatch: unknown,
    @Headers('range') range: unknown,
    @Query('variant') variant: unknown,
    @Res({ passthrough: true }) response: ProductMediaContentHttpResponse,
  ): Promise<StreamableFile | undefined> {
    const result = await this.images.resolve(
      params.storageRecordId,
      params.lineId,
      params.productMediaId,
      ifNoneMatch,
      range,
      'GET',
      variant,
    )
    applyProductMediaContentResponse(response, result)
    return result.stream === undefined
      ? undefined
      : new StreamableFile(result.stream)
  }

  @Post('releases')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('shipment-storage:release')
  @ApiContractResponse({ status: HttpStatus.CREATED, type: [ShipmentStorageDetailDto] })
  @ApiApplicationContract({
    operationId: 'shipment_storage_release',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 409, codes: ['SHIPMENT_STORAGE_ALREADY_ACTIVE', 'SHIPMENT_STORAGE_IDEMPOTENCY_CONFLICT'] },
      { status: 422, codes: ['SHIPMENT_STORAGE_NOT_ALLOWED', 'SHIPMENT_STORAGE_DELIVERED', 'SHIPMENT_STORAGE_NOT_SHIPPED', 'SHIPMENT_STORAGE_NOT_RECEIVED', 'SHIPMENT_STORAGE_LOCATION_INVALID', 'SHIPMENT_STORAGE_DESTINATION_MISSING', 'SHIPMENT_STORAGE_PURCHASE_UNPAID', 'SHIPMENT_STORAGE_PACKAGING_UNPAID', 'SHIPMENT_STORAGE_SHARE_RATE_MISSING', 'VALIDATION_FAILED'] },
    ],
  })
  release(
    @Body() dto: ReleaseShipmentStorageRequestDto,
    @Req() request: object,
  ): Promise<readonly ShipmentStorageDetailDto[]> {
    return this.storage.release(
      { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) },
      dto,
    )
  }

  @Get(':storageRecordId/claim-requests/:requestId')
  @RequirePermissions('shipment-storage:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShipmentStorageClaimRequestDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_claim_request_detail',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['SHIPMENT_STORAGE_CLAIM_REQUEST_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  getClaimRequest(
    @Param() params: ShipmentStorageClaimRequestParamsDto,
  ): Promise<ShipmentStorageClaimRequestDto> {
    return this.storage.getClaimRequest(params.storageRecordId, params.requestId)
  }

  @Post(':storageRecordId/claim-requests')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('shipment-storage:claim-request')
  @ApiContractResponse({ status: HttpStatus.CREATED, type: ShipmentStorageClaimRequestDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_claim_request_create',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['SHIPMENT_STORAGE_NOT_FOUND', 'SALES_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['SHIPMENT_STORAGE_STATE_CHANGED', 'SHIPMENT_STORAGE_CLAIM_REQUEST_EXISTS'] },
      { status: 422, codes: ['SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', 'SHIPMENT_STORAGE_CLAIM_EXCEEDS_COVERAGE', 'SHIPMENT_STORAGE_SHARE_RATE_MISSING', 'VALIDATION_FAILED'] },
    ],
  })
  createClaimRequest(
    @Param() params: ShipmentStorageIdParamDto,
    @Body() dto: ClaimShipmentStorageRequestDto,
    @Req() request: object,
  ): Promise<ShipmentStorageClaimRequestDto> {
    return this.storage.createClaimRequest(
      { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) },
      params.storageRecordId,
      dto,
    )
  }

  @Post(':storageRecordId/claim-requests/:requestId/withdraw')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('shipment-storage:claim-request')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShipmentStorageClaimRequestDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_claim_request_withdraw',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', 'SHIPMENT_STORAGE_CLAIM_REQUEST_FORBIDDEN'] },
      { status: 404, codes: ['SHIPMENT_STORAGE_CLAIM_REQUEST_NOT_FOUND'] },
      { status: 409, codes: ['SHIPMENT_STORAGE_CLAIM_REQUEST_STATE_CHANGED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  withdrawClaimRequest(
    @Param() params: ShipmentStorageClaimRequestParamsDto,
    @Req() request: object,
  ): Promise<ShipmentStorageClaimRequestDto> {
    return this.storage.withdrawClaimRequest(
      { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) },
      params.storageRecordId,
      params.requestId,
    )
  }

  @Post(':storageRecordId/claim-requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('shipment-storage:claim')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShipmentStorageDetailDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_claim_request_approve',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['SHIPMENT_STORAGE_CLAIM_REQUEST_NOT_FOUND'] },
      { status: 409, codes: ['SHIPMENT_STORAGE_CLAIM_REQUEST_STATE_CHANGED', 'SHIPMENT_STORAGE_STATE_CHANGED'] },
      { status: 422, codes: ['SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', 'SHIPMENT_STORAGE_CLAIM_EXCEEDS_COVERAGE', 'SHIPMENT_STORAGE_SHARE_RATE_MISSING', 'VALIDATION_FAILED'] },
    ],
  })
  approveClaimRequest(
    @Param() params: ShipmentStorageClaimRequestParamsDto,
    @Req() request: object,
  ): Promise<ShipmentStorageDetailDto> {
    return this.storage.approveClaimRequest(
      { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) },
      params.storageRecordId,
      params.requestId,
    )
  }

  @Post(':storageRecordId/claim-requests/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('shipment-storage:claim')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShipmentStorageClaimRequestDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_claim_request_reject',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['SHIPMENT_STORAGE_CLAIM_REQUEST_NOT_FOUND'] },
      { status: 409, codes: ['SHIPMENT_STORAGE_CLAIM_REQUEST_STATE_CHANGED'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  })
  rejectClaimRequest(
    @Param() params: ShipmentStorageClaimRequestParamsDto,
    @Body() dto: RejectShipmentStorageClaimRequestDto,
    @Req() request: object,
  ): Promise<ShipmentStorageClaimRequestDto> {
    return this.storage.rejectClaimRequest(
      { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) },
      params.storageRecordId,
      params.requestId,
      dto,
    )
  }

  @Post(':storageRecordId/claim')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('shipment-storage:claim')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShipmentStorageDetailDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_claim',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['SHIPMENT_STORAGE_NOT_FOUND', 'SALES_ORDER_NOT_FOUND'] },
      { status: 409, codes: ['SHIPMENT_STORAGE_STATE_CHANGED', 'SHIPMENT_STORAGE_CLAIM_REQUEST_PENDING'] },
      { status: 422, codes: ['SHIPMENT_STORAGE_CLAIM_NOT_ALLOWED', 'VALIDATION_FAILED'] },
    ],
  })
  claim(
    @Param() params: ShipmentStorageIdParamDto,
    @Body() dto: ClaimShipmentStorageRequestDto,
    @Req() request: object,
  ): Promise<ShipmentStorageDetailDto> {
    return this.storage.claim(
      { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) },
      params.storageRecordId,
      dto,
    )
  }

  @Post(':storageRecordId/location')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('shipment-storage:relocate')
  @ApiContractResponse({ status: HttpStatus.OK, type: ShipmentStorageDetailDto })
  @ApiApplicationContract({
    operationId: 'shipment_storage_relocate',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
      { status: 404, codes: ['SHIPMENT_STORAGE_NOT_FOUND'] },
      { status: 409, codes: ['SHIPMENT_STORAGE_STATE_CHANGED', 'SHIPMENT_STORAGE_IDEMPOTENCY_CONFLICT'] },
      { status: 422, codes: ['SHIPMENT_STORAGE_LOCATION_INVALID', 'VALIDATION_FAILED'] },
    ],
  })
  relocate(
    @Param() params: ShipmentStorageIdParamDto,
    @Body() dto: RelocateShipmentStorageRequestDto,
    @Req() request: object,
  ): Promise<ShipmentStorageDetailDto> {
    return this.storage.relocate(
      { actorUserId: getRequestAuthContext(request).userId, requestId: getRequestId(request) },
      params.storageRecordId,
      dto,
    )
  }
}
