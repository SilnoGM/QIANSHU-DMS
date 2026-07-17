import { Controller, Get, HttpStatus, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import { AuditQueryService } from './audit-query.service'
import { AuditEventListQueryDto } from './dto/audit-event-list-query.dto'
import { AuditEventPageDto } from './dto/audit-event-page.dto'

@ApiTags('audit')
@Controller('audit-events')
export class AuditController {
  constructor(private readonly auditQuery: AuditQueryService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiContractResponse({ status: HttpStatus.OK, type: AuditEventPageDto })
  @ApiApplicationContract({
    operationId: 'audit_events_list',
    session: 'required',
    authorization: true,
    badRequest: true,
    validation: true,
    privateNoStore: true,
  })
  list(@Query() query: AuditEventListQueryDto): Promise<AuditEventPageDto> {
    return this.auditQuery.list(query)
  }
}
