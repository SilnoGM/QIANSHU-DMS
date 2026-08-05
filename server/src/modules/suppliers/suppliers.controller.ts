import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import {
  ApiBody,
  ApiExtraModels,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import {
  SupplierCommandService,
  type SupplierCommandContext,
} from './supplier-command.service'
import { SupplierLifecycleService } from './supplier-lifecycle.service'
import { SupplierQueryService } from './supplier-query.service'
import {
  ChangeSupplierStatusRequestDto,
  CreateSupplierRequestDto,
  UpdateSupplierRequestDto,
  UPDATE_SUPPLIER_REQUEST_BODY_SCHEMA,
} from './dto/supplier-command.dto'
import {
  SupplierIdParamDto,
  SupplierListQueryDto,
} from './dto/supplier-management.dto'
import { SupplierDto, SupplierPageDto } from './dto/supplier-response.dto'

const READ_FORBIDDEN = {
  status: 403,
  codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
} as const
const WRITE_FORBIDDEN = {
  status: 403,
  codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
} as const
const NOT_FOUND = {
  status: 404,
  codes: ['SUPPLIER_NOT_FOUND'],
} as const
const STATE_CHANGED = {
  status: 409,
  codes: ['SUPPLIER_STATE_CHANGED'],
} as const
const VALIDATION_FAILED = {
  status: 422,
  codes: ['VALIDATION_FAILED'],
} as const
const REGION_ERRORS = {
  status: 422,
  codes: [
    'SUPPLIER_REGION_INVALID',
    'SUPPLIER_REGION_UNAVAILABLE',
    'VALIDATION_FAILED',
  ],
} as const

/** Supplier HTTP 边界只负责编排 DTO、权限、契约和可信请求上下文。 */
@ApiTags('suppliers')
@ApiExtraModels(UpdateSupplierRequestDto)
@Controller('suppliers')
export class SuppliersController {
  constructor(
    private readonly queryService: SupplierQueryService,
    private readonly commandService: SupplierCommandService,
    private readonly lifecycleService: SupplierLifecycleService,
  ) {}

  @Get()
  @RequirePermissions('suppliers:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: SupplierPageDto })
  @ApiApplicationContract({
    operationId: 'suppliers_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [READ_FORBIDDEN, VALIDATION_FAILED],
  })
  list(@Query() dto: SupplierListQueryDto): Promise<SupplierPageDto> {
    return this.queryService.list(dto)
  }

  @Post()
  @RequirePermissions('suppliers:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: {
      type: 'string',
      format: 'uuid',
      pattern:
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    },
  })
  @ApiContractResponse({ status: HttpStatus.CREATED, type: SupplierDto })
  @ApiApplicationContract({
    operationId: 'suppliers_create',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      WRITE_FORBIDDEN,
      {
        status: 409,
        codes: [
          'SUPPLIER_IDEMPOTENCY_CONFLICT',
          'SUPPLIER_REGISTRATION_ALREADY_EXISTS',
        ],
      },
      REGION_ERRORS,
      { status: 503, codes: ['SUPPLIER_NUMBERING_UNAVAILABLE'] },
    ],
  })
  create(
    @Body() dto: CreateSupplierRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: object,
  ): Promise<SupplierDto> {
    return this.commandService.create(
      this.commandContext(request),
      idempotencyKey,
      dto,
    )
  }

  @Get(':supplierId')
  @RequirePermissions('suppliers:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: SupplierDto })
  @ApiApplicationContract({
    operationId: 'suppliers_get_by_id',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [READ_FORBIDDEN, NOT_FOUND, VALIDATION_FAILED],
  })
  getById(@Param() params: SupplierIdParamDto): Promise<SupplierDto> {
    return this.queryService.getById(params.supplierId)
  }

  @Patch(':supplierId')
  @RequirePermissions('suppliers:update')
  @ApiBody({ schema: UPDATE_SUPPLIER_REQUEST_BODY_SCHEMA })
  @ApiContractResponse({ status: HttpStatus.OK, type: SupplierDto })
  @ApiApplicationContract({
    operationId: 'suppliers_update',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      WRITE_FORBIDDEN,
      NOT_FOUND,
      {
        status: 409,
        codes: [
          'SUPPLIER_REGISTRATION_ALREADY_EXISTS',
          'SUPPLIER_STATE_CHANGED',
        ],
      },
      {
        status: 422,
        codes: [
          'SUPPLIER_ENABLE_REQUIREMENTS_NOT_MET',
          'SUPPLIER_REGION_INVALID',
          'SUPPLIER_REGION_UNAVAILABLE',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  update(
    @Param() params: SupplierIdParamDto,
    @Body() dto: UpdateSupplierRequestDto,
    @Req() request: object,
  ): Promise<SupplierDto> {
    return this.lifecycleService.update(
      this.commandContext(request),
      params.supplierId,
      dto,
    )
  }

  @Post(':supplierId/enable')
  @RequirePermissions('suppliers:enable')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: SupplierDto })
  @ApiApplicationContract({
    operationId: 'suppliers_enable',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [
      WRITE_FORBIDDEN,
      NOT_FOUND,
      STATE_CHANGED,
      {
        status: 422,
        codes: ['SUPPLIER_ENABLE_REQUIREMENTS_NOT_MET', 'VALIDATION_FAILED'],
      },
    ],
  })
  enable(
    @Param() params: SupplierIdParamDto,
    @Body() dto: ChangeSupplierStatusRequestDto,
    @Req() request: object,
  ): Promise<SupplierDto> {
    return this.lifecycleService.enable(
      this.commandContext(request),
      params.supplierId,
      dto,
    )
  }

  @Post(':supplierId/disable')
  @RequirePermissions('suppliers:disable')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: SupplierDto })
  @ApiApplicationContract({
    operationId: 'suppliers_disable',
    session: 'required',
    authorization: true,
    csrf: true,
    badRequest: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
    privateNoStore: true,
    errors: [WRITE_FORBIDDEN, NOT_FOUND, STATE_CHANGED, VALIDATION_FAILED],
  })
  disable(
    @Param() params: SupplierIdParamDto,
    @Body() dto: ChangeSupplierStatusRequestDto,
    @Req() request: object,
  ): Promise<SupplierDto> {
    return this.lifecycleService.disable(
      this.commandContext(request),
      params.supplierId,
      dto,
    )
  }

  private commandContext(request: object): SupplierCommandContext {
    return {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }
  }
}
