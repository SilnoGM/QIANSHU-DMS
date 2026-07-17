import { Controller, Get, Module, Post } from '@nestjs/common'
import { ApiBody, ApiOkResponse, type OpenAPIObject } from '@nestjs/swagger'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import { CreateUserRequestDto } from './create-user-request.dto'
import { PasswordResetRequestDto } from './password-reset-request.dto'
import { ReplaceUserRolesRequestDto } from './replace-user-roles-request.dto'
import { UpdateUserRequestDto } from './update-user-request.dto'
import { UserListQueryDto } from './user-list-query.dto'
import { UserDto, UserPageDto } from './user-response.dto'

async function validatePlain<T extends object>(
  dtoType: new () => T,
  input: object,
) {
  const instance = plainToInstance(dtoType, input)
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  })

  return { errors, instance }
}

function errorProperties(errors: Awaited<ReturnType<typeof validate>>): string[] {
  return errors.map((error) => error.property).sort()
}

@Controller('users-dto-contract')
class UsersDtoContractController {
  @Get()
  @ApiOkResponse({ type: UserPageDto })
  list(): UserPageDto {
    throw new Error('OpenAPI scan only')
  }

  @Post()
  @ApiBody({ type: CreateUserRequestDto })
  @ApiOkResponse({ type: UserDto })
  create(): UserDto {
    throw new Error('OpenAPI scan only')
  }
}

@Module({ controllers: [UsersDtoContractController] })
class UsersDtoContractModule {}

function requireSchema(
  document: OpenAPIObject,
  name: string,
): Record<string, unknown> {
  const schema = document.components?.schemas?.[name]
  if (!schema || '$ref' in schema) {
    throw new Error(`Missing inline schema ${name}`)
  }

  return schema as Record<string, unknown>
}

describe('User request DTO validation', () => {
  it('分页默认 1/20、最大 100，并把 query string 转成整数', async () => {
    const defaults = await validatePlain(UserListQueryDto, {})
    const converted = await validatePlain(UserListQueryDto, {
      page: '2',
      pageSize: '100',
      username: ' Alice ',
    })
    const invalid = await validatePlain(UserListQueryDto, {
      page: '0',
      pageSize: '101',
    })

    expect(defaults.errors).toEqual([])
    expect(defaults.instance).toMatchObject({ page: 1, pageSize: 20 })
    expect(converted.errors).toEqual([])
    expect(converted.instance).toMatchObject({
      page: 2,
      pageSize: 100,
      username: ' Alice ',
    })
    expect(errorProperties(invalid.errors)).toEqual(['page', 'pageSize'])
  })

  it('创建请求严格要求四个字段，并按 Unicode code point 限制输入', async () => {
    const valid = await validatePlain(CreateUserRequestDto, {
      username: '😀'.repeat(128),
      displayName: '操作员',
      password: 'a'.repeat(15),
      mustChangePassword: true,
    })
    const invalid = await validatePlain(CreateUserRequestDto, {
      username: '😀'.repeat(129),
      displayName: '',
      password: 'a'.repeat(14),
      mustChangePassword: 'true',
    })

    expect(valid.errors).toEqual([])
    expect(errorProperties(invalid.errors)).toEqual([
      'displayName',
      'mustChangePassword',
      'password',
      'username',
    ])
  })

  it('更新只接受 displayName，角色 ID 必须是 UUID，重置密码不允许缺字段', async () => {
    const update = await validatePlain(UpdateUserRequestDto, {
      displayName: '新名称',
    })
    const roles = await validatePlain(ReplaceUserRolesRequestDto, {
      roleIds: [
        '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
        'not-a-uuid',
      ],
    })
    const duplicateRoles = await validatePlain(ReplaceUserRolesRequestDto, {
      roleIds: [
        '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
        '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      ],
    })
    const reset = await validatePlain(PasswordResetRequestDto, {
      newPassword: 'a'.repeat(15),
    })
    const extra = await validatePlain(UpdateUserRequestDto, {
      displayName: '新名称',
      username: 'cannot-change',
    })

    expect(update.errors).toEqual([])
    expect(errorProperties(roles.errors)).toEqual(['roleIds'])
    // Service 会按稳定 UUID 顺序去重；重复输入不能造成部分写入或 unique 冲突。
    expect(duplicateRoles.errors).toEqual([])
    expect(errorProperties(reset.errors)).toEqual(['mustChangePassword'])
    expect(errorProperties(extra.errors)).toEqual(['username'])
  })
})

describe('User DTO OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(UsersDtoContractModule)
  })

  it('响应仅暴露设计字段，不包含密码、authVersion 或禁用内部字段', () => {
    expect(requireSchema(document, UserDto.name)).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        username: { type: 'string', maxLength: 128 },
        displayName: { type: 'string', maxLength: 128 },
        status: { type: 'string', enum: ['ACTIVE', 'DISABLED'] },
        mustChangePassword: { type: 'boolean' },
        roleIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          uniqueItems: true,
        },
        lastLoginAt: {
          type: 'string',
          format: 'date-time',
          nullable: true,
        },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      required: [
        'id',
        'username',
        'displayName',
        'status',
        'mustChangePassword',
        'roleIds',
        'lastLoginAt',
        'createdAt',
        'updatedAt',
      ],
    })
  })

  it('分页响应固定包含 items、page、pageSize、total', () => {
    expect(requireSchema(document, UserPageDto.name)).toEqual({
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: { $ref: `#/components/schemas/${UserDto.name}` },
        },
        page: { type: 'integer', minimum: 1 },
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        total: { type: 'integer', minimum: 0 },
      },
      required: ['items', 'page', 'pageSize', 'total'],
    })
  })
})
