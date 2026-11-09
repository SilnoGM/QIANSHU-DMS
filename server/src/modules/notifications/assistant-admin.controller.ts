import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import {
  AssistantAccountCreateDto,
  AssistantAccountDto,
  AssistantAccountQrDto,
  AssistantAccountUpdateDto,
  AssistantBindingCheckDto,
  AssistantBindingCreateDto,
  AssistantBindingDto,
  AssistantBindingPageDto,
  AssistantBindingQueryDto,
  AssistantBindingReassignDto,
  AssistantBindingVerifyDto,
  AssistantChannelDto,
  AssistantChannelUpdateDto,
  AssistantContactDto,
  AssistantContactQueryDto,
  AssistantIdParamDto,
  AssistantTargetDto,
  AssistantTargetUpdateDto,
  AssistantTestSendDto,
} from './assistant-admin.dto'
import { AssistantAdminService, type AssistantAdminContext } from './assistant-admin.service'

function contract(operationId: string, mutation = false, errors: ApiContractErrorOptions[] = []) {
  return ApiApplicationContract({
    operationId,
    session: 'required',
    authorization: true,
    csrf: mutation,
    badRequest: true,
    validation: true,
    privateNoStore: true,
    errors: [
      { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED', ...(mutation ? ['CSRF_REJECTED'] : [])] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
      ...errors,
    ],
  })
}

function context(request: object): AssistantAdminContext {
  return {
    actorUserId: getRequestAuthContext(request).userId,
    requestId: getRequestId(request),
  }
}

const upstreamErrors: ApiContractErrorOptions[] = [
  { status: 503, codes: ['ASSISTANT_NOT_CONFIGURED', 'ASSISTANT_OUTBOUND_BLOCKED', 'ASSISTANT_UPSTREAM_UNAVAILABLE'] },
  { status: 422, codes: ['ASSISTANT_ACCOUNT_OFFLINE'] },
  { status: 429, codes: ['ASSISTANT_RATE_LIMITED'] },
]

@ApiTags('assistant')
@Controller('assistant')
export class AssistantAdminController {
  constructor(private readonly assistant: AssistantAdminService) {}

  @Get('channel')
  @RequirePermissions('assistant-channel:read')
  @ApiContractResponse({ status: 200, type: AssistantChannelDto })
  @contract('assistant_channel_get')
  getChannel() {
    return this.assistant.getChannel()
  }

  @Put('channel')
  @RequirePermissions('assistant-channel:update')
  @ApiContractResponse({ status: 200, type: AssistantChannelDto })
  @contract('assistant_channel_update', true, [{ status: 409, codes: ['ASSISTANT_CHANNEL_STATE_CHANGED'] }])
  updateChannel(@Body() input: AssistantChannelUpdateDto, @Req() request: object) {
    return this.assistant.updateChannel(context(request), input)
  }

  @Post('channel/test')
  @HttpCode(200)
  @RequirePermissions('assistant-channel:update')
  @ApiContractResponse({ status: 200, type: AssistantTestSendDto })
  @contract('assistant_channel_test', true, [
    { status: 422, codes: ['ASSISTANT_ACCOUNT_UNAVAILABLE', 'ASSISTANT_ACCOUNT_NOT_IMPORTED', 'ASSISTANT_ACCOUNT_OFFLINE'] },
    ...upstreamErrors,
  ])
  testChannel() {
    return this.assistant.testChannel()
  }

  @Get('accounts')
  @RequirePermissions('assistant-account:read')
  @ApiContractResponse({ status: 200, type: [AssistantAccountDto] })
  @contract('assistant_accounts_list')
  listAccounts() {
    return this.assistant.listAccounts()
  }

  @Post('accounts')
  @HttpCode(201)
  @RequirePermissions('assistant-account:operate')
  @ApiContractResponse({ status: 201, type: AssistantAccountDto })
  @contract('assistant_accounts_create', true, [
    { status: 409, codes: ['ASSISTANT_ACCOUNT_APP_ID_EXISTS'] },
    { status: 422, codes: ['ASSISTANT_ACCOUNT_OFFLINE', 'ASSISTANT_ACCOUNT_APP_ID_INVALID'] },
    ...upstreamErrors,
  ])
  createAccount(@Body() input: AssistantAccountCreateDto, @Req() request: object) {
    return this.assistant.createAccount(context(request), input)
  }

  @Patch('accounts/:id')
  @RequirePermissions('assistant-account:operate')
  @ApiContractResponse({ status: 200, type: AssistantAccountDto })
  @contract('assistant_accounts_update', true, [
    { status: 404, codes: ['ASSISTANT_ACCOUNT_NOT_FOUND'] },
    { status: 409, codes: ['ASSISTANT_ACCOUNT_STATE_CHANGED', 'ASSISTANT_ACCOUNT_APP_ID_EXISTS'] },
    { status: 422, codes: ['ASSISTANT_ACCOUNT_OFFLINE', 'ASSISTANT_ACCOUNT_NOT_IMPORTED', 'ASSISTANT_ACCOUNT_APP_ID_INVALID'] },
    ...upstreamErrors,
  ])
  updateAccount(@Param() params: AssistantIdParamDto, @Body() input: AssistantAccountUpdateDto, @Req() request: object) {
    return this.assistant.updateAccount(context(request), params.id, input)
  }

  @Post('accounts/:id/check')
  @HttpCode(200)
  @RequirePermissions('assistant-account:operate')
  @ApiContractResponse({ status: 200, type: AssistantAccountDto })
  @contract('assistant_accounts_check_status', true, [
    { status: 404, codes: ['ASSISTANT_ACCOUNT_NOT_FOUND'] },
    { status: 422, codes: ['ASSISTANT_ACCOUNT_NOT_IMPORTED'] },
    ...upstreamErrors,
  ])
  checkAccountStatus(@Param() params: AssistantIdParamDto) {
    return this.assistant.checkAccountStatus(params.id)
  }

  @Get('accounts/:id/qrcode')
  @RequirePermissions('assistant-account:read')
  @ApiContractResponse({ status: 200, type: AssistantAccountQrDto })
  @contract('assistant_accounts_qrcode', false, [
    { status: 404, codes: ['ASSISTANT_ACCOUNT_NOT_FOUND'] },
    { status: 422, codes: ['ASSISTANT_ACCOUNT_NOT_IMPORTED'] },
    ...upstreamErrors,
  ])
  accountQrCode(@Param() params: AssistantIdParamDto) {
    return this.assistant.accountQrCode(params.id)
  }

  @Get('contacts')
  @RequirePermissions('assistant-binding:read')
  @ApiContractResponse({ status: 200, type: [AssistantContactDto] })
  @contract('assistant_contacts_list', false, [{ status: 422, codes: ['ASSISTANT_ACCOUNT_UNAVAILABLE'] }, ...upstreamErrors])
  listContacts(@Query() query: AssistantContactQueryDto) {
    return this.assistant.listContacts(query.query)
  }

  @Get('bindings')
  @RequirePermissions('assistant-binding:read')
  @ApiContractResponse({ status: 200, type: AssistantBindingPageDto })
  @contract('assistant_bindings_list')
  listBindings(@Query() query: AssistantBindingQueryDto) {
    return this.assistant.listBindings(query)
  }

  @Post('bindings')
  @HttpCode(201)
  @RequirePermissions('assistant-binding:manage')
  @ApiContractResponse({ status: 201, type: AssistantBindingDto })
  @contract('assistant_bindings_create', true, [{ status: 409, codes: ['ASSISTANT_BINDING_EXISTS'] }, { status: 422, codes: ['ASSISTANT_BINDING_USER_INVALID', 'ASSISTANT_ACCOUNT_UNAVAILABLE'] }])
  createBinding(@Body() input: AssistantBindingCreateDto, @Req() request: object) {
    return this.assistant.createBinding(context(request), input)
  }

  @Patch('bindings/:id/reassign')
  @RequirePermissions('assistant-binding:manage')
  @ApiContractResponse({ status: 200, type: AssistantBindingDto })
  @contract('assistant_bindings_reassign', true, [
    { status: 404, codes: ['ASSISTANT_BINDING_NOT_FOUND'] },
    { status: 409, codes: ['ASSISTANT_BINDING_USER_CONFLICT'] },
    { status: 422, codes: ['ASSISTANT_BINDING_USER_INVALID'] },
  ])
  reassignBinding(@Param() params: AssistantIdParamDto, @Body() input: AssistantBindingReassignDto, @Req() request: object) {
    return this.assistant.reassignBinding(context(request), params.id, input)
  }

  @Post('bindings/:id/verify')
  @HttpCode(200)
  @RequirePermissions('assistant-binding:manage')
  @ApiContractResponse({ status: 200, type: AssistantBindingDto })
  @contract('assistant_bindings_verify', true, [
    { status: 404, codes: ['ASSISTANT_BINDING_NOT_FOUND'] },
    { status: 422, codes: ['ASSISTANT_BINDING_CONTENT_INVALID'] },
    { status: 429, codes: ['ASSISTANT_BINDING_TEST_COOLDOWN'] },
    ...upstreamErrors,
  ])
  verifyBinding(@Param() params: AssistantIdParamDto, @Body() input: AssistantBindingVerifyDto, @Req() request: object) {
    return this.assistant.verifyBinding(context(request), params.id, input)
  }

  @Delete('bindings/:id')
  @HttpCode(204)
  @RequirePermissions('assistant-binding:manage')
  @ApiContractResponse({ status: 204 })
  @contract('assistant_bindings_delete', true, [{ status: 404, codes: ['ASSISTANT_BINDING_NOT_FOUND'] }])
  async revokeBinding(@Param() params: AssistantIdParamDto, @Req() request: object): Promise<void> {
    await this.assistant.revokeBinding(context(request), params.id)
  }

  @Post('bindings/check')
  @HttpCode(200)
  @RequirePermissions('assistant-binding:manage')
  @ApiContractResponse({ status: 200, type: AssistantBindingCheckDto })
  @contract('assistant_bindings_check', true)
  checkBindings(@Req() request: object) {
    return this.assistant.checkBindings(context(request))
  }

  @Get('targets')
  @RequirePermissions('assistant-target:read')
  @ApiContractResponse({ status: 200, type: [AssistantTargetDto] })
  @contract('assistant_targets_list')
  listTargets() {
    return this.assistant.listTargets()
  }

  @Post('targets/sync')
  @HttpCode(200)
  @RequirePermissions('assistant-target:manage')
  @ApiContractResponse({ status: 200, type: [AssistantTargetDto] })
  @contract('assistant_targets_sync', true, [{ status: 422, codes: ['ASSISTANT_ACCOUNT_UNAVAILABLE'] }, ...upstreamErrors])
  syncTargets() {
    return this.assistant.syncTargets()
  }

  @Patch('targets/:id')
  @RequirePermissions('assistant-target:manage')
  @ApiContractResponse({ status: 200, type: AssistantTargetDto })
  @contract('assistant_targets_update', true, [
    { status: 404, codes: ['ASSISTANT_TARGET_NOT_FOUND'] },
    { status: 409, codes: ['ASSISTANT_TARGET_KEY_EXISTS'] },
  ])
  updateTarget(@Param() params: AssistantIdParamDto, @Body() input: AssistantTargetUpdateDto) {
    return this.assistant.updateTarget(params.id, input)
  }
}
