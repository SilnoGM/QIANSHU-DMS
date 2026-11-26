import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { getRequestId } from '../../infrastructure/http/request-id.middleware'
import { ApiApplicationContract } from '../../openapi/api-contract.decorator'
import type { ApiContractErrorOptions } from '../../openapi/contract-metadata'
import { ApiContractResponse } from '../../openapi/contract-response.decorator'
import { getRequestAuthContext } from '../auth/auth-context'
import { RequirePermissions } from '../auth/decorators/auth.decorators'
import {
  WecomAppCreateDto,
  WecomAppDto,
  WecomAppMemberParamDto,
  WecomAppSecretUpdateDto,
  WecomAppTestResultDto,
  WecomAppUpdateDto,
  WecomBindingCreateDto,
  WecomBindingDto,
  WecomBindingVerifyDto,
  WecomChannelDto,
  WecomChannelUpdateDto,
  WecomEventRoutesDto,
  WecomEventRoutesUpdateDto,
  WecomMembershipCreateDto,
  WecomMembershipDto,
  WecomTargetCreateDto,
  WecomTargetDto,
  WecomTargetUpdateDto,
  WecomTestResultDto,
  WecomUuidParamDto,
} from './wecom-admin.dto'
import { WecomAdminService, type WecomAdminContext } from './wecom-admin.service'

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

function context(request: object): WecomAdminContext {
  return {
    actorUserId: getRequestAuthContext(request).userId,
    requestId: getRequestId(request),
  }
}

const secretErrors: ApiContractErrorOptions[] = [
  { status: 503, codes: ['WECOM_SECRET_KEY_MISSING'] },
]

@ApiTags('notifications')
@Controller('notifications/wecom')
export class WecomAdminController {
  constructor(private readonly wecom: WecomAdminService) {}

  @Get('channel')
  @RequirePermissions('wecom-channel:read')
  @ApiContractResponse({ status: 200, type: WecomChannelDto })
  @contract('notifications_wecom_channel_get')
  getChannel() {
    return this.wecom.getChannel()
  }

  @Put('channel')
  @RequirePermissions('wecom-channel:update')
  @ApiContractResponse({ status: 200, type: WecomChannelDto })
  @contract('notifications_wecom_channel_update', true, [
    { status: 409, codes: ['WECOM_CHANNEL_STATE_CHANGED'] },
    { status: 422, codes: ['WECOM_CHANNEL_QUIET_HOURS_INVALID'] },
    { status: 503, codes: ['WECOM_CHANNEL_NOT_CONFIGURED'] },
  ])
  updateChannel(@Body() input: WecomChannelUpdateDto, @Req() request: object) {
    return this.wecom.updateChannel(context(request), input)
  }

  @Get('apps')
  @RequirePermissions('wecom-app:read')
  @ApiContractResponse({ status: 200, type: [WecomAppDto] })
  @contract('notifications_wecom_apps_list')
  listApps() {
    return this.wecom.listApps()
  }

  @Post('apps')
  @HttpCode(201)
  @RequirePermissions('wecom-app:manage')
  @ApiContractResponse({ status: 201, type: WecomAppDto })
  @contract('notifications_wecom_apps_create', true, [
    { status: 409, codes: ['WECOM_APP_EXISTS'] },
    { status: 503, codes: ['WECOM_SECRET_KEY_MISSING'] },
  ])
  createApp(@Body() input: WecomAppCreateDto, @Req() request: object) {
    return this.wecom.createApp(context(request), input)
  }

  @Patch('apps/:id')
  @RequirePermissions('wecom-app:manage')
  @ApiContractResponse({ status: 200, type: WecomAppDto })
  @contract('notifications_wecom_apps_update', true, [
    { status: 404, codes: ['WECOM_APP_NOT_FOUND'] },
    { status: 409, codes: ['WECOM_APP_STATE_CHANGED', 'WECOM_APP_EXISTS'] },
  ])
  updateApp(@Param() params: WecomUuidParamDto, @Body() input: WecomAppUpdateDto, @Req() request: object) {
    return this.wecom.updateApp(context(request), params.id, input)
  }

  @Put('apps/:id/secret')
  @RequirePermissions('wecom-app-secret:update')
  @ApiContractResponse({ status: 200, type: WecomAppDto })
  @contract('notifications_wecom_apps_secret_update', true, [
    { status: 404, codes: ['WECOM_APP_NOT_FOUND'] },
    ...secretErrors,
  ])
  updateAppSecret(
    @Param() params: WecomUuidParamDto,
    @Body() input: WecomAppSecretUpdateDto,
    @Req() request: object,
  ) {
    return this.wecom.updateAppSecret(context(request), params.id, input)
  }

  @Post('apps/:id/test')
  @HttpCode(200)
  @RequirePermissions('wecom-app:manage')
  @ApiContractResponse({ status: 200, type: WecomAppTestResultDto })
  @contract('notifications_wecom_apps_test', true, [
    { status: 404, codes: ['WECOM_APP_NOT_FOUND'] },
    { status: 422, codes: ['WECOM_APP_NOT_CONFIGURED', 'WECOM_APP_TEST_FAILED'] },
    ...secretErrors,
  ])
  testApp(@Param() params: WecomUuidParamDto, @Req() request: object) {
    return this.wecom.testApp(context(request), params.id)
  }

  @Get('apps/:id/events')
  @RequirePermissions('wecom-app:read')
  @ApiContractResponse({ status: 200, type: WecomEventRoutesDto })
  @contract('notifications_wecom_apps_events_get', false, [{ status: 404, codes: ['WECOM_APP_NOT_FOUND'] }])
  getAppEvents(@Param() params: WecomUuidParamDto) {
    return this.wecom.getAppEvents(params.id)
  }

  @Put('apps/:id/events')
  @RequirePermissions('wecom-app:manage')
  @ApiContractResponse({ status: 200, type: WecomEventRoutesDto })
  @contract('notifications_wecom_apps_events_update', true, [
    { status: 404, codes: ['WECOM_APP_NOT_FOUND'] },
    { status: 409, codes: ['WECOM_EVENT_ROUTE_CONFLICT'] },
    { status: 422, codes: ['WECOM_EVENT_TYPE_INVALID'] },
  ])
  setAppEvents(
    @Param() params: WecomUuidParamDto,
    @Body() input: WecomEventRoutesUpdateDto,
    @Req() request: object,
  ) {
    return this.wecom.setAppEvents(context(request), params.id, input)
  }

  @Get('apps/:id/members')
  @RequirePermissions('wecom-membership:read')
  @ApiContractResponse({ status: 200, type: [WecomMembershipDto] })
  @contract('notifications_wecom_apps_members_list', false, [{ status: 404, codes: ['WECOM_APP_NOT_FOUND'] }])
  listAppMembers(@Param() params: WecomUuidParamDto) {
    return this.wecom.listAppMembers(params.id)
  }

  @Post('apps/:id/members')
  @HttpCode(201)
  @RequirePermissions('wecom-membership:manage')
  @ApiContractResponse({ status: 201, type: WecomMembershipDto })
  @contract('notifications_wecom_apps_members_create', true, [
    { status: 404, codes: ['WECOM_APP_NOT_FOUND'] },
    { status: 422, codes: ['WECOM_BINDING_NOT_FOUND'] },
  ])
  addAppMember(
    @Param() params: WecomUuidParamDto,
    @Body() input: WecomMembershipCreateDto,
    @Req() request: object,
  ) {
    return this.wecom.addAppMember(context(request), params.id, input.userId)
  }

  @Delete('apps/:id/members/:userId')
  @HttpCode(204)
  @RequirePermissions('wecom-membership:manage')
  @contract('notifications_wecom_apps_members_delete', true, [
    { status: 404, codes: ['WECOM_APP_NOT_FOUND', 'WECOM_MEMBERSHIP_NOT_FOUND'] },
  ])
  async removeAppMember(
    @Param() params: WecomAppMemberParamDto,
    @Req() request: object,
  ): Promise<void> {
    await this.wecom.removeAppMember(context(request), params.id, params.userId)
  }

  @Get('bindings')
  @RequirePermissions('wecom-membership:read')
  @ApiContractResponse({ status: 200, type: [WecomBindingDto] })
  @contract('notifications_wecom_bindings_list')
  listBindings() {
    return this.wecom.listBindings()
  }

  @Post('bindings')
  @HttpCode(201)
  @RequirePermissions('wecom-membership:manage')
  @ApiContractResponse({ status: 201, type: WecomBindingDto })
  @contract('notifications_wecom_bindings_create', true, [
    { status: 409, codes: ['WECOM_BINDING_EXISTS'] },
    { status: 422, codes: ['WECOM_BINDING_USER_INVALID'] },
  ])
  createBinding(@Body() input: WecomBindingCreateDto, @Req() request: object) {
    return this.wecom.createBinding(context(request), input)
  }

  @Post('bindings/:id/verify')
  @HttpCode(200)
  @RequirePermissions('wecom-membership:manage')
  @ApiContractResponse({ status: 200, type: WecomTestResultDto })
  @contract('notifications_wecom_bindings_verify', true, [
    { status: 404, codes: ['WECOM_BINDING_NOT_FOUND'] },
    { status: 422, codes: ['WECOM_APP_NOT_CONFIGURED', 'WECOM_APP_TEST_FAILED', 'WECOM_TEST_CONTENT_TOO_LONG', 'WECOM_TEST_SEND_FAILED'] },
    ...secretErrors,
  ])
  verifyBinding(
    @Param() params: WecomUuidParamDto,
    @Body() input: WecomBindingVerifyDto,
    @Req() request: object,
  ) {
    return this.wecom.verifyBinding(context(request), params.id, input)
  }

  @Delete('bindings/:id')
  @HttpCode(204)
  @RequirePermissions('wecom-membership:manage')
  @contract('notifications_wecom_bindings_delete', true, [
    { status: 404, codes: ['WECOM_BINDING_NOT_FOUND'] },
    { status: 409, codes: ['WECOM_BINDING_IN_USE'] },
  ])
  async deleteBinding(@Param() params: WecomUuidParamDto, @Req() request: object): Promise<void> {
    await this.wecom.deleteBinding(context(request), params.id)
  }

  @Get('targets')
  @RequirePermissions('wecom-target:read')
  @ApiContractResponse({ status: 200, type: [WecomTargetDto] })
  @contract('notifications_wecom_targets_list')
  listTargets() {
    return this.wecom.listTargets()
  }

  @Post('targets')
  @HttpCode(201)
  @RequirePermissions('wecom-target:manage')
  @ApiContractResponse({ status: 201, type: WecomTargetDto })
  @contract('notifications_wecom_targets_create', true, [
    { status: 409, codes: ['WECOM_TARGET_EXISTS'] },
    ...secretErrors,
  ])
  createTarget(@Body() input: WecomTargetCreateDto, @Req() request: object) {
    return this.wecom.createTarget(context(request), input)
  }

  @Patch('targets/:id')
  @RequirePermissions('wecom-target:manage')
  @ApiContractResponse({ status: 200, type: WecomTargetDto })
  @contract('notifications_wecom_targets_update', true, [
    { status: 404, codes: ['WECOM_TARGET_NOT_FOUND'] },
    { status: 409, codes: ['WECOM_TARGET_STATE_CHANGED'] },
    ...secretErrors,
  ])
  updateTarget(
    @Param() params: WecomUuidParamDto,
    @Body() input: WecomTargetUpdateDto,
    @Req() request: object,
  ) {
    return this.wecom.updateTarget(context(request), params.id, input)
  }

  @Delete('targets/:id')
  @HttpCode(204)
  @RequirePermissions('wecom-target:manage')
  @contract('notifications_wecom_targets_delete', true, [
    { status: 404, codes: ['WECOM_TARGET_NOT_FOUND'] },
    { status: 409, codes: ['WECOM_TARGET_IN_USE'] },
  ])
  async deleteTarget(@Param() params: WecomUuidParamDto, @Req() request: object): Promise<void> {
    await this.wecom.deleteTarget(context(request), params.id)
  }

  @Post('targets/:id/test')
  @HttpCode(200)
  @RequirePermissions('wecom-target:manage')
  @ApiContractResponse({ status: 200, type: WecomTestResultDto })
  @contract('notifications_wecom_targets_test', true, [
    { status: 404, codes: ['WECOM_TARGET_NOT_FOUND'] },
    { status: 422, codes: ['WECOM_TARGET_TEST_FAILED'] },
    ...secretErrors,
  ])
  testTarget(@Param() params: WecomUuidParamDto, @Req() request: object) {
    return this.wecom.testTarget(context(request), params.id)
  }
}
