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

import { ApiException } from '../../src/infrastructure/http/api.exception'
import { ContractFixtureDto } from './contract-fixture.dto'

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
  getDto() {
    return { id: 'fixture-1', name: '测试记录' }
  }

  @Get('pagination')
  getPagination() {
    return {
      items: [{ id: 'fixture-1', name: '测试记录' }],
      page: 1,
      pageSize: 20,
      total: 1,
    }
  }

  @Post('resources')
  @Header('Location', '/api/contract/resources/fixture-2')
  createResource() {
    return { id: 'fixture-2', name: '新建记录' }
  }

  @Post('jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  acceptJob() {
    return { jobId: 'job-1', status: 'accepted' }
  }

  @Delete('resources/fixture-1')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeResource(): void {}

  @Get('document.pdf')
  getDocument(): StreamableFile {
    const content = Buffer.from('%PDF-1.4\ncontract-fixture\n%%EOF\n')
    return new StreamableFile(content, {
      type: 'application/pdf',
      length: content.byteLength,
    })
  }

  @Post('echo')
  echo(@Body() body: ContractFixtureDto): ContractFixtureDto {
    return body
  }

  @Get('errors/:status')
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
  throwHealthLikeFailure(): never {
    throw new ServiceUnavailableException({
      status: 'error',
      info: {},
      error: { database: { status: 'down' } },
      details: { database: { status: 'down' } },
    })
  }
}
