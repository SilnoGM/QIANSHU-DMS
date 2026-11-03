import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { EmptyRequestDto } from '../auth/dto/empty-request.dto'
import {
  AssignableUserDto,
  AssignableUsersQueryDto,
  AssignProxyNodeRequestDto,
  ProxyNodeAssignmentResultDto,
  ProxyNodeExpirySummaryDto,
  ProxyNodeListDto,
  ProxyNodeReleaseResultDto,
  SyncProxyNodesResultDto,
} from './proxy-node.dto'
import { ProxyNodeCommandService } from './proxy-node-command.service'
import { ProxyNodeQueryService } from './proxy-node-query.service'

const PROXY_NODE_ID_PIPE = new ParseUUIDPipe()

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
        codes: [
          'FORBIDDEN',
          'PASSWORD_CHANGE_REQUIRED',
          ...(mutation ? ['CSRF_REJECTED'] : []),
        ],
      },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      ...errors,
    ],
  })
}

@ApiTags('proxy-nodes')
@Controller('proxy-nodes')
export class ProxyNodeController {
  constructor(
    private readonly queries: ProxyNodeQueryService,
    private readonly commands: ProxyNodeCommandService,
  ) {}

  @Get('mine')
  @RequirePermissions('proxy-nodes:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: ProxyNodeListDto })
  @contract('proxy_nodes_list_mine', false, [
    { status: 503, codes: ['PROXY_NODE_SECRET_UNAVAILABLE'] },
  ])
  mine(@Req() request: object): Promise<ProxyNodeListDto> {
    return this.queries.listMine(getRequestAuthContext(request).userId)
  }

  @Get('mine/expiry-summary')
  @RequirePermissions('proxy-nodes:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: ProxyNodeExpirySummaryDto })
  @contract('proxy_nodes_expiry_summary_mine')
  mineExpirySummary(@Req() request: object): Promise<ProxyNodeExpirySummaryDto> {
    return this.queries.expirySummaryMine(getRequestAuthContext(request).userId)
  }

  @Get()
  @RequirePermissions('proxy-nodes:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: ProxyNodeListDto })
  @contract('proxy_nodes_list', false, [
    { status: 503, codes: ['PROXY_NODE_SECRET_UNAVAILABLE'] },
  ])
  list(): Promise<ProxyNodeListDto> {
    return this.queries.listAll()
  }

  @Get('expiry-summary')
  @RequirePermissions('proxy-nodes:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: ProxyNodeExpirySummaryDto })
  @contract('proxy_nodes_expiry_summary')
  expirySummary(): Promise<ProxyNodeExpirySummaryDto> {
    return this.queries.expirySummaryAll()
  }

  @Get('assignable-users')
  @RequirePermissions('proxy-nodes:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: [AssignableUserDto] })
  @contract('proxy_nodes_list_assignable_users')
  assignableUsers(
    @Query() query: AssignableUsersQueryDto,
  ): Promise<AssignableUserDto[]> {
    return this.queries.assignableUsers(query.keyword)
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('proxy-nodes:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: SyncProxyNodesResultDto })
  @contract('proxy_nodes_sync', true, [
    { status: 409, codes: ['PROXY_SYNC_IN_PROGRESS'] },
    {
      status: 503,
      codes: [
        'PROXY_NODE_SECRET_UNAVAILABLE',
        'PROXY_PROVIDER_INVALID_RESPONSE',
        'PROXY_PROVIDER_NOT_CONFIGURED',
        'PROXY_PROVIDER_RATE_LIMITED',
        'PROXY_PROVIDER_UNAUTHORIZED',
        'PROXY_PROVIDER_UNAVAILABLE',
      ],
    },
  ])
  sync(@Req() request: object): Promise<SyncProxyNodesResultDto> {
    return this.commands.sync({
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    })
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('proxy-nodes:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: ProxyNodeAssignmentResultDto })
  @contract('proxy_nodes_assign', true, [
    { status: 404, codes: ['PROXY_NODE_NOT_FOUND'] },
    {
      status: 409,
      codes: [
        'PROXY_NODE_ALREADY_ASSIGNED',
        'PROXY_NODE_EXPIRED',
        'PROXY_NODE_STATE_CHANGED',
        'PROXY_NODE_UNAVAILABLE',
      ],
    },
    { status: 422, codes: ['PROXY_NODE_ASSIGNEE_INVALID'] },
  ])
  assign(
    @Param('id', PROXY_NODE_ID_PIPE) id: string,
    @Body() input: AssignProxyNodeRequestDto,
    @Req() request: object,
  ): Promise<ProxyNodeAssignmentResultDto> {
    return this.commands.assign(id, input, {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    })
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('proxy-nodes:manage')
  @ApiContractResponse({ status: HttpStatus.OK, type: ProxyNodeReleaseResultDto })
  @contract('proxy_nodes_release', true, [
    { status: 404, codes: ['PROXY_NODE_NOT_FOUND'] },
    {
      status: 409,
      codes: ['PROXY_NODE_NOT_ASSIGNED', 'PROXY_NODE_STATE_CHANGED'],
    },
  ])
  release(
    @Param('id', PROXY_NODE_ID_PIPE) id: string,
    @Body() _input: EmptyRequestDto,
    @Req() request: object,
  ): Promise<ProxyNodeReleaseResultDto> {
    return this.commands.release(id, {
      actorUserId: getRequestAuthContext(request).userId,
      requestId: getRequestId(request),
    })
  }
}
