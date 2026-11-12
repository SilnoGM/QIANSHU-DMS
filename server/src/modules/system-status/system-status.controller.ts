import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { SystemStatusResponseDto } from './dto/system-status-response.dto'
import { SystemStatusService } from './system-status.service'

@ApiTags('system-status')
@Controller('system/status')
export class SystemStatusController {
  constructor(private readonly systemStatus: SystemStatusService) {}

  @Get()
  @RequirePermissions('system-status:read')
  @ApiContractResponse({ status: 200, type: SystemStatusResponseDto })
  @ApiApplicationContract({
    operationId: 'system_status_get',
    session: 'required',
    authorization: true,
    privateNoStore: true,
  })
  get(): Promise<SystemStatusResponseDto> {
    return this.systemStatus.getStatus()
  }
}
