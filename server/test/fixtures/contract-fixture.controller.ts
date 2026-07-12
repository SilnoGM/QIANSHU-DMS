import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common'

import { ApiError } from '../../src/infrastructure/http/api-error.dto'
import { ApiException } from '../../src/infrastructure/http/api.exception'
import { ApiApplicationContract } from '../../src/openapi/api-contract.decorator'
import { ApiContractResponse } from '../../src/openapi/contract-response.decorator'
import {
  ContractFixtureDto,
  ContractFixtureJobDto,
  ContractFixturePageDto,
  ContractFixtureRecordDto,
} from './contract-fixture.dto'

export const CONTRACT_SENSITIVE_CANARY = 'contract-sensitive-canary'
const UNKNOWN_ERROR_STATUS: number = HttpStatus.INTERNAL_SERVER_ERROR

const explicitErrorContracts = new Map<
  number,
  readonly [code: string, message: string]
>([
  [400, ['BAD_REQUEST', '请求格式错误']],
  [401, ['UNAUTHORIZED', '未登录或登录已失效']],
  [403, ['FORBIDDEN', '没有权限执行此操作']],
  [404, ['NOT_FOUND', '请求的资源不存在']],
  [409, ['CONFLICT', '请求与当前资源状态冲突']],
  [422, ['VALIDATION_FAILED', '请求参数校验失败']],
])

@Controller('contract')
export class ContractFixtureController {
  @Get('dto')
  @ApiApplicationContract({ operationId: 'contract_fixture_get_dto' })
  @ApiContractResponse({ status: 200, type: ContractFixtureRecordDto })
  getDto(): ContractFixtureRecordDto {
    return { id: 'fixture-1', name: '测试记录' }
  }

  @Get('pagination')
  @ApiApplicationContract({ operationId: 'contract_fixture_get_page' })
  @ApiContractResponse({ status: 200, type: ContractFixturePageDto })
  getPagination(): ContractFixturePageDto {
    return {
      items: [{ id: 'fixture-1', name: '测试记录' }],
      page: 1,
      pageSize: 20,
      total: 1,
    }
  }

  @Post('resources')
  @Header('Location', '/api/contract/resources/fixture-2')
  @ApiApplicationContract({ operationId: 'contract_fixture_create' })
  @ApiContractResponse({
    status: 201,
    type: ContractFixtureRecordDto,
    headers: {
      Location: {
        description: '新建资源地址',
        schema: { type: 'string' },
      },
    },
  })
  createResource(): ContractFixtureRecordDto {
    return { id: 'fixture-2', name: '新建记录' }
  }

  @Post('jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiApplicationContract({ operationId: 'contract_fixture_accept' })
  @ApiContractResponse({ status: 202, type: ContractFixtureJobDto })
  acceptJob(): ContractFixtureJobDto {
    return { jobId: 'job-1', status: 'accepted' }
  }

  @Delete('resources/fixture-1')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiApplicationContract({ operationId: 'contract_fixture_delete' })
  @ApiContractResponse({ status: 204 })
  removeResource(): void {}

  @Get('document.pdf')
  @ApiApplicationContract({ operationId: 'contract_fixture_download' })
  @ApiContractResponse({
    status: 200,
    content: {
      'application/pdf': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  getDocument(): StreamableFile {
    const content = Buffer.from('%PDF-1.4\ncontract-fixture\n%%EOF\n')
    return new StreamableFile(content, {
      type: 'application/pdf',
      length: content.byteLength,
    })
  }

  @Post('echo')
  @ApiApplicationContract({
    operationId: 'contract_fixture_echo',
    badRequest: true,
    validation: true,
  })
  @ApiContractResponse({ status: 201, type: ContractFixtureDto })
  echo(@Body() body: ContractFixtureDto): ContractFixtureDto {
    return body
  }

  @Get('errors/:status')
  @ApiApplicationContract({
    operationId: 'contract_fixture_get_error',
    badRequest: true,
    authentication: true,
    authorization: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
  })
  throwError(@Param('status') rawStatus: string): never {
    const status = Number(rawStatus)

    if (status === UNKNOWN_ERROR_STATUS) {
      throw new Error(CONTRACT_SENSITIVE_CANARY)
    }

    const contract = explicitErrorContracts.get(status)

    if (!contract) {
      throw new ApiException(418, 'REQUEST_REJECTED', '请求无法处理')
    }

    throw new ApiException(status, contract[0], contract[1])
  }

  @Get('health-like')
  @ApiApplicationContract({
    operationId: 'contract_fixture_get_health_like_failure',
  })
  @ApiContractResponse({ status: 503, type: ApiError })
  throwHealthLikeFailure(): never {
    throw new ServiceUnavailableException({
      status: 'error',
      info: {},
      error: { database: { status: 'down' } },
      details: { database: { status: 'down' } },
    })
  }
}
