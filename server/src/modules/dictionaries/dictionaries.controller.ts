import {
  Body,
  Controller,
  Get,
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
  ApiTags,
} from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import {
  DictionaryCommandService,
  type DictionaryCommandContext,
} from './dictionary-command.service'
import { DictionaryQueryService } from './dictionary-query.service'
import {
  ChangeDictionaryStatusRequestDto,
  CreateDictionaryItemRequestDto,
  CreateDictionaryTypeRequestDto,
  UpdateDictionaryItemRequestDto,
  UpdateDictionaryTypeRequestDto,
  UPDATE_DICTIONARY_ITEM_REQUEST_BODY_SCHEMA,
  UPDATE_DICTIONARY_TYPE_REQUEST_BODY_SCHEMA,
} from './dto/dictionary-command.dto'
import {
  DictionaryItemIdParamDto,
  DictionaryItemListQueryDto,
  DictionaryTypeIdParamDto,
  DictionaryTypeListQueryDto,
} from './dto/dictionary-management.dto'
import {
  DictionaryItemDto,
  DictionaryItemPageDto,
  DictionaryTypeDto,
  DictionaryTypePageDto,
} from './dto/dictionary-response.dto'

const READ_FORBIDDEN = {
  status: 403,
  codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
} as const
const WRITE_FORBIDDEN = {
  status: 403,
  codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
} as const
const TYPE_NOT_FOUND = {
  status: 404,
  codes: ['DICTIONARY_TYPE_NOT_FOUND'],
} as const
const ITEM_NOT_FOUND = {
  status: 404,
  codes: ['DICTIONARY_ITEM_NOT_FOUND'],
} as const
const VALIDATION_FAILED = {
  status: 422,
  codes: ['VALIDATION_FAILED'],
} as const
const TYPE_STATE_CHANGED = {
  status: 409,
  codes: ['DICTIONARY_TYPE_STATE_CHANGED'],
} as const
const ITEM_STATE_CHANGED = {
  status: 409,
  codes: ['DICTIONARY_ITEM_STATE_CHANGED'],
} as const

/**
 * 系统字典管理 HTTP 边界。
 *
 * 每个 handler 独立声明细粒度权限，避免读取权限被写操作继承。Controller 只负责
 * DTO、公开契约和可信请求上下文编排，所有规范化、并发与生命周期规则均留在 Service。
 */
@ApiTags('dictionary-types')
@ApiExtraModels(
  UpdateDictionaryTypeRequestDto,
  UpdateDictionaryItemRequestDto,
)
@Controller('dictionary-types')
export class DictionariesController {
  constructor(
    private readonly query: DictionaryQueryService,
    private readonly command: DictionaryCommandService,
  ) {}

  @Get()
  @RequirePermissions('dictionaries:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: DictionaryTypePageDto,
  })
  @ApiApplicationContract({
    operationId: 'dictionary_types_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [READ_FORBIDDEN, VALIDATION_FAILED],
  })
  listTypes(
    @Query() dto: DictionaryTypeListQueryDto,
  ): Promise<DictionaryTypePageDto> {
    return this.query.listTypes(dto)
  }

  @Post()
  @RequirePermissions('dictionaries:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: DictionaryTypeDto,
  })
  @ApiApplicationContract({
    operationId: 'dictionary_types_create',
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
          'DICTIONARY_TYPE_CODE_ALREADY_EXISTS',
          'DICTIONARY_TYPE_STATE_CHANGED',
        ],
      },
      VALIDATION_FAILED,
    ],
  })
  createType(
    @Body() dto: CreateDictionaryTypeRequestDto,
    @Req() request: object,
  ): Promise<DictionaryTypeDto> {
    return this.command.createType(this.commandContext(request), dto)
  }

  @Get(':typeId')
  @RequirePermissions('dictionaries:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: DictionaryTypeDto })
  @ApiApplicationContract({
    operationId: 'dictionary_types_get_by_id',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [READ_FORBIDDEN, TYPE_NOT_FOUND, VALIDATION_FAILED],
  })
  getTypeById(
    @Param() params: DictionaryTypeIdParamDto,
  ): Promise<DictionaryTypeDto> {
    return this.query.getTypeById(params.typeId)
  }

  @Patch(':typeId')
  @RequirePermissions('dictionaries:update')
  @ApiBody({ schema: UPDATE_DICTIONARY_TYPE_REQUEST_BODY_SCHEMA })
  @ApiContractResponse({ status: HttpStatus.OK, type: DictionaryTypeDto })
  @ApiApplicationContract({
    operationId: 'dictionary_types_update',
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
      TYPE_NOT_FOUND,
      TYPE_STATE_CHANGED,
      VALIDATION_FAILED,
    ],
  })
  updateType(
    @Param() params: DictionaryTypeIdParamDto,
    @Body() dto: UpdateDictionaryTypeRequestDto,
    @Req() request: object,
  ): Promise<DictionaryTypeDto> {
    return this.command.updateType(
      this.commandContext(request),
      params.typeId,
      dto,
    )
  }

  @Post(':typeId/enable')
  @RequirePermissions('dictionaries:enable')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: DictionaryTypeDto })
  @ApiApplicationContract({
    operationId: 'dictionary_types_enable',
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
      TYPE_NOT_FOUND,
      TYPE_STATE_CHANGED,
      {
        status: 422,
        codes: [
          'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  enableType(
    @Param() params: DictionaryTypeIdParamDto,
    @Body() dto: ChangeDictionaryStatusRequestDto,
    @Req() request: object,
  ): Promise<DictionaryTypeDto> {
    return this.command.enableType(
      this.commandContext(request),
      params.typeId,
      dto,
    )
  }

  @Post(':typeId/disable')
  @RequirePermissions('dictionaries:disable')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: DictionaryTypeDto })
  @ApiApplicationContract({
    operationId: 'dictionary_types_disable',
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
      TYPE_NOT_FOUND,
      TYPE_STATE_CHANGED,
      VALIDATION_FAILED,
    ],
  })
  disableType(
    @Param() params: DictionaryTypeIdParamDto,
    @Body() dto: ChangeDictionaryStatusRequestDto,
    @Req() request: object,
  ): Promise<DictionaryTypeDto> {
    return this.command.disableType(
      this.commandContext(request),
      params.typeId,
      dto,
    )
  }

  @Get(':typeId/items')
  @RequirePermissions('dictionaries:read')
  @ApiContractResponse({
    status: HttpStatus.OK,
    type: DictionaryItemPageDto,
  })
  @ApiApplicationContract({
    operationId: 'dictionary_items_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [READ_FORBIDDEN, TYPE_NOT_FOUND, VALIDATION_FAILED],
  })
  listItems(
    @Param() params: DictionaryTypeIdParamDto,
    @Query() dto: DictionaryItemListQueryDto,
  ): Promise<DictionaryItemPageDto> {
    return this.query.listItems(params.typeId, dto)
  }

  @Post(':typeId/items')
  @RequirePermissions('dictionaries:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiContractResponse({
    status: HttpStatus.CREATED,
    type: DictionaryItemDto,
  })
  @ApiApplicationContract({
    operationId: 'dictionary_items_create',
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
      TYPE_NOT_FOUND,
      {
        status: 409,
        codes: [
          'DICTIONARY_ITEM_VALUE_ALREADY_EXISTS',
          'DICTIONARY_TYPE_STATE_CHANGED',
        ],
      },
      VALIDATION_FAILED,
    ],
  })
  createItem(
    @Param() params: DictionaryTypeIdParamDto,
    @Body() dto: CreateDictionaryItemRequestDto,
    @Req() request: object,
  ): Promise<DictionaryItemDto> {
    return this.command.createItem(
      this.commandContext(request),
      params.typeId,
      dto,
    )
  }

  @Get(':typeId/items/:itemId')
  @RequirePermissions('dictionaries:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: DictionaryItemDto })
  @ApiApplicationContract({
    operationId: 'dictionary_items_get_by_id',
    session: 'required',
    authorization: true,
    badRequest: true,
    resourceLocator: true,
    validation: true,
    privateNoStore: true,
    errors: [READ_FORBIDDEN, ITEM_NOT_FOUND, VALIDATION_FAILED],
  })
  getItemById(
    @Param() params: DictionaryItemIdParamDto,
  ): Promise<DictionaryItemDto> {
    return this.query.getItemById(params.typeId, params.itemId)
  }

  @Patch(':typeId/items/:itemId')
  @RequirePermissions('dictionaries:update')
  @ApiBody({ schema: UPDATE_DICTIONARY_ITEM_REQUEST_BODY_SCHEMA })
  @ApiContractResponse({ status: HttpStatus.OK, type: DictionaryItemDto })
  @ApiApplicationContract({
    operationId: 'dictionary_items_update',
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
      ITEM_NOT_FOUND,
      ITEM_STATE_CHANGED,
      VALIDATION_FAILED,
    ],
  })
  updateItem(
    @Param() params: DictionaryItemIdParamDto,
    @Body() dto: UpdateDictionaryItemRequestDto,
    @Req() request: object,
  ): Promise<DictionaryItemDto> {
    return this.command.updateItem(
      this.commandContext(request),
      params.typeId,
      params.itemId,
      dto,
    )
  }

  @Post(':typeId/items/:itemId/enable')
  @RequirePermissions('dictionaries:enable')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: DictionaryItemDto })
  @ApiApplicationContract({
    operationId: 'dictionary_items_enable',
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
      ITEM_NOT_FOUND,
      ITEM_STATE_CHANGED,
      VALIDATION_FAILED,
    ],
  })
  enableItem(
    @Param() params: DictionaryItemIdParamDto,
    @Body() dto: ChangeDictionaryStatusRequestDto,
    @Req() request: object,
  ): Promise<DictionaryItemDto> {
    return this.command.enableItem(
      this.commandContext(request),
      params.typeId,
      params.itemId,
      dto,
    )
  }

  @Post(':typeId/items/:itemId/disable')
  @RequirePermissions('dictionaries:disable')
  @HttpCode(HttpStatus.OK)
  @ApiContractResponse({ status: HttpStatus.OK, type: DictionaryItemDto })
  @ApiApplicationContract({
    operationId: 'dictionary_items_disable',
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
      ITEM_NOT_FOUND,
      ITEM_STATE_CHANGED,
      {
        status: 422,
        codes: [
          'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED',
          'VALIDATION_FAILED',
        ],
      },
    ],
  })
  disableItem(
    @Param() params: DictionaryItemIdParamDto,
    @Body() dto: ChangeDictionaryStatusRequestDto,
    @Req() request: object,
  ): Promise<DictionaryItemDto> {
    return this.command.disableItem(
      this.commandContext(request),
      params.typeId,
      params.itemId,
      dto,
    )
  }

  private commandContext(request: object): DictionaryCommandContext {
    return {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    }
  }
}
