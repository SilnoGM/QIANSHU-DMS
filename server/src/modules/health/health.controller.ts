import { Controller, Get } from '@nestjs/common'
import {
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger'
import { HealthCheck, HealthCheckService } from '@nestjs/terminus'

import { ApiContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { Public } from '../auth/decorators/auth.decorators'
import { DatabaseHealthIndicator } from './database-health.indicator'
import {
  HealthFailureResponseDto,
  HealthSuccessResponseDto,
} from './dto/health-response.dto'

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  @Get()
  @Public()
  // 禁用会覆盖专用 DTO 的 inline Swagger schema，同时显式保留 Terminus 的 no-cache 运行时 Header。
  @HealthCheck({ noCache: true, swaggerDocumentation: false })
  @ApiOperation({ operationId: 'health_get' })
  @ApiContract({
    kind: 'health',
    authentication: false,
    authorization: false,
    resourceLocator: false,
    conflict: false,
    validation: false,
  })
  @ApiContractResponse({ status: 200, type: HealthSuccessResponseDto })
  @ApiContractResponse({ status: 503, type: HealthFailureResponseDto })
  check() {
    return this.health.check([
      () => this.database.isHealthy('database'),
    ])
  }
}
