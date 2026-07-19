import type { AxiosInstance } from 'axios'
import type {
  AuditEventPageDto,
  AuditEventsListData,
  CreateRoleRequestDto,
  CreateUserRequestDtoWritable,
  PasswordResetRequestDtoWritable,
  PermissionDto,
  ReplaceRolePermissionsRequestDto,
  ReplaceUserRolesRequestDto,
  RoleDto,
  UpdateRoleRequestDto,
  UpdateUserRequestDto,
  UserDto,
  UserPageDto,
  UsersListData,
} from '../generated/types.gen'

import api from '../index'

type UserListQuery = NonNullable<UsersListData['query']>
type AuditEventListQuery = NonNullable<AuditEventsListData['query']>

function resourcePath(resource: 'roles' | 'users', id: string): string {
  return `${resource}/${encodeURIComponent(id)}`
}

/**
 * 管理 API 只复用 OpenAPI 生成 DTO，不在页面组件中手写 URL 或响应结构。
 * factory 让 Node 单元测试能够验证完整 HTTP 调用而无需启动 Vue 或浏览器。
 */
export function createManagementApi(client: AxiosInstance) {
  return {
    users: {
      list: (query: UserListQuery = {}) =>
        client.get<UserPageDto>('users', {
          errorPresentation: 'local',
          params: query,
        }),
      create: (data: CreateUserRequestDtoWritable) =>
        client.post<UserDto>('users', data, {
          errorPresentation: 'local',
          retry: false,
        }),
      get: (userId: string) =>
        client.get<UserDto>(resourcePath('users', userId)),
      update: (userId: string, data: UpdateUserRequestDto) =>
        client.patch<UserDto>(resourcePath('users', userId), data, {
          errorPresentation: 'local',
        }),
      enable: (userId: string) =>
        client.post<UserDto>(`${resourcePath('users', userId)}/enable`, {}, {
          errorPresentation: 'local',
        }),
      disable: (userId: string) =>
        client.post<UserDto>(`${resourcePath('users', userId)}/disable`, {}, {
          errorPresentation: 'local',
        }),
      replaceRoles: (userId: string, data: ReplaceUserRolesRequestDto) =>
        client.put<UserDto>(`${resourcePath('users', userId)}/roles`, data, {
          errorPresentation: 'local',
        }),
      resetPassword: (
        userId: string,
        data: PasswordResetRequestDtoWritable,
      ) => client.post<UserDto>(
        `${resourcePath('users', userId)}/password-reset`,
        data,
        { errorPresentation: 'local', retry: false },
      ),
    },
    roles: {
      list: () => client.get<RoleDto[]>('roles', {
        errorPresentation: 'local',
      }),
      create: (data: CreateRoleRequestDto) =>
        client.post<RoleDto>('roles', data, {
          errorPresentation: 'local',
        }),
      get: (roleId: string) =>
        client.get<RoleDto>(resourcePath('roles', roleId)),
      update: (roleId: string, data: UpdateRoleRequestDto) =>
        client.patch<RoleDto>(resourcePath('roles', roleId), data, {
          errorPresentation: 'local',
        }),
      replacePermissions: (
        roleId: string,
        data: ReplaceRolePermissionsRequestDto,
      ) => client.put<RoleDto>(
        `${resourcePath('roles', roleId)}/permissions`,
        data,
        { errorPresentation: 'local' },
      ),
    },
    permissions: {
      list: () => client.get<PermissionDto[]>('permissions', {
        errorPresentation: 'local',
      }),
    },
    auditEvents: {
      list: (query: AuditEventListQuery = {}) =>
        client.get<AuditEventPageDto>('audit-events', {
          errorPresentation: 'local',
          params: query,
        }),
    },
  }
}

export default createManagementApi(api)
