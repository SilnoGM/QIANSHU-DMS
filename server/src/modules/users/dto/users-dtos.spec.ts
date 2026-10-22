import { Controller, Get, Module, Patch, Post } from '@nestjs/common'
import { ApiBody, ApiOkResponse, type OpenAPIObject } from '@nestjs/swagger'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { UserStatus } from '../../../generated/prisma/enums'
import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import {
  CreateUserFundAccountRequestDto,
  CreateUserRequestDto,
} from './create-user-request.dto'
import { PasswordResetRequestDto } from './password-reset-request.dto'
import { ReplaceUserRolesRequestDto } from './replace-user-roles-request.dto'
import { UpdateUserRequestDto } from './update-user-request.dto'
import { UserListQueryDto } from './user-list-query.dto'
import {
  AdminUserProfileDto,
  UserDto,
  UserPageDto,
} from './user-response.dto'

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

  @Patch()
  @ApiBody({ type: UpdateUserRequestDto })
  @ApiOkResponse({ type: UserDto })
  update(): UserDto {
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

  it('用户列表只接受公开契约中的状态枚举', async () => {
    const active = await validatePlain(UserListQueryDto, {
      status: UserStatus.ACTIVE,
    })
    const disabled = await validatePlain(UserListQueryDto, {
      status: UserStatus.DISABLED,
    })
    const invalid = await validatePlain(UserListQueryDto, {
      status: 'PENDING',
    })

    expect(active.errors).toEqual([])
    expect(active.instance.status).toBe(UserStatus.ACTIVE)
    expect(disabled.errors).toEqual([])
    expect(disabled.instance.status).toBe(UserStatus.DISABLED)
    expect(errorProperties(invalid.errors)).toEqual(['status'])
  })

  it('创建请求严格要求四个字段，并按 Unicode code point 限制输入', async () => {
    const valid = await validatePlain(CreateUserRequestDto, {
      username: '😀'.repeat(128),
      displayName: '操作员',
      password: 'a'.repeat(8),
      mustChangePassword: true,
    })
    const invalid = await validatePlain(CreateUserRequestDto, {
      username: '😀'.repeat(129),
      displayName: '',
      password: 'a'.repeat(7),
      mustChangePassword: 'true',
    })

    expect(valid.errors).toEqual([])
    expect(errorProperties(invalid.errors)).toEqual([
      'displayName',
      'mustChangePassword',
      'password',
      'username',
    ])

    const profileInput = await validatePlain(CreateUserRequestDto, {
      username: 'operator',
      displayName: '操作员',
      password: 'a'.repeat(8),
      mustChangePassword: true,
      email: 'must-not-be-created@example.com',
    })
    expect(errorProperties(profileInput.errors)).toEqual(['email'])
  })

  it('资金账户为可选嵌套对象，比例沿用资金域 0–100 两位小数格式', async () => {
    const base = {
      username: 'operator',
      displayName: '操作员',
      password: 'a'.repeat(8),
      mustChangePassword: true,
    }

    const withoutAccount = await validatePlain(CreateUserRequestDto, base)
    expect(withoutAccount.errors).toEqual([])
    expect(withoutAccount.instance.fundAccount).toBeUndefined()

    for (const userShareRate of ['0', '100', '30', '30.5', '30.50', '100.00']) {
      const valid = await validatePlain(CreateUserRequestDto, {
        ...base,
        fundAccount: { userShareRate },
      })
      expect(valid.errors).toEqual([])
    }

    for (const userShareRate of ['', '30.555', '100.01', '-1', 'abc', 30]) {
      const invalid = await validatePlain(CreateUserRequestDto, {
        ...base,
        fundAccount: { userShareRate },
      })
      expect(invalid.errors.map(error => error.property)).toEqual([
        'fundAccount',
      ])
      expect(
        invalid.errors[0]?.children?.map(child => child.property),
      ).toEqual(['userShareRate'])
    }

    const unknownNestedKey = await validatePlain(CreateUserRequestDto, {
      ...base,
      fundAccount: {
        userShareRate: '30',
        reason: 'must-not-be-accepted',
      },
    })
    expect(
      unknownNestedKey.errors.flatMap(error =>
        (error.children ?? []).map(child => child.property),
      ),
    ).toContain('reason')
  })

  it('更新接受任意非空 User/Profile 子集和 nullable 清空值', async () => {
    const displayNameOnly = await validatePlain(UpdateUserRequestDto, {
      displayName: '新名称',
    })
    const profileOnly = await validatePlain(UpdateUserRequestDto, {
      email: 'operator@example.com',
      mobileE164: '+8613800138000',
      avatarUrl: 'https://example.com/avatar.png',
      issuerPrefix: '李华',
      remark: '仅管理员可见',
    })
    const nullableProfile = await validatePlain(UpdateUserRequestDto, {
      email: null,
      mobileE164: null,
      avatarUrl: null,
      issuerPrefix: null,
      remark: null,
    })
    const emptyPatch = await validatePlain(UpdateUserRequestDto, {})
    const emptyValues = await validatePlain(UpdateUserRequestDto, {
      displayName: '',
      email: '',
      mobileE164: '',
      avatarUrl: '',
      issuerPrefix: '',
      remark: '',
    })
    const extra = await validatePlain(UpdateUserRequestDto, {
      displayName: '新名称',
      username: 'cannot-change',
      userId: '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1',
      emailNormalized: 'operator@example.com',
    })

    expect(displayNameOnly.errors).toEqual([])
    expect(profileOnly.errors).toEqual([])
    expect(nullableProfile.errors).toEqual([])
    expect(emptyPatch.errors).not.toHaveLength(0)
    expect(errorProperties(emptyValues.errors)).toEqual([
      'avatarUrl',
      'displayName',
      'email',
      'issuerPrefix',
      'mobileE164',
      'remark',
    ])
    expect(errorProperties(extra.errors)).toEqual([
      'emailNormalized',
      'userId',
      'username',
    ])
  })

  it('角色 ID 必须是 UUID，重置密码不允许缺字段', async () => {
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
      newPassword: 'a'.repeat(8),
    })

    expect(errorProperties(roles.errors)).toEqual(['roleIds'])
    // Service 会按稳定 UUID 顺序去重；重复输入不能造成部分写入或 unique 冲突。
    expect(duplicateRoles.errors).toEqual([])
    expect(errorProperties(reset.errors)).toEqual(['mustChangePassword'])
  })
})

describe('User DTO OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(UsersDtoContractModule)
  })

  it('创建请求把资金账户声明为可选嵌套对象', () => {
    const schema = requireSchema(document, CreateUserRequestDto.name)
    expect(schema.required).toEqual(
      expect.arrayContaining([
        'username',
        'displayName',
        'password',
        'mustChangePassword',
      ]),
    )
    expect(schema.required).not.toContain('fundAccount')
    expect(schema.properties).toHaveProperty('fundAccount')

    const accountSchema = requireSchema(
      document,
      CreateUserFundAccountRequestDto.name,
    )
    expect(accountSchema.required).toEqual(['userShareRate'])
    expect(accountSchema.properties).toMatchObject({
      userShareRate: {
        type: 'string',
        pattern: '^(?:100(?:\\.0{1,2})?|(?:0|[1-9]\\d?)(?:\\.\\d{1,2})?)$',
      },
    })
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
        profile: { $ref: `#/components/schemas/${AdminUserProfileDto.name}` },
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
        'profile',
      ],
    })
  })

  it('管理员 Profile 响应包含备注但不暴露 emailNormalized', () => {
    expect(requireSchema(document, AdminUserProfileDto.name)).toEqual({
      type: 'object',
      properties: {
        email: { type: 'string', maxLength: 254, nullable: true },
        mobileE164: { type: 'string', maxLength: 16, nullable: true },
        avatarUrl: { type: 'string', maxLength: 2048, nullable: true },
        issuerPrefix: { type: 'string', maxLength: 3, nullable: true, description: '出单人前缀；最多 3 个汉字' },
        remark: { type: 'string', maxLength: 2000, nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      required: [
        'email',
        'mobileE164',
        'avatarUrl',
        'issuerPrefix',
        'remark',
        'createdAt',
        'updatedAt',
      ],
    })
  })

  it('管理员 PATCH 文档保持六个扁平可选字段', () => {
    expect(requireSchema(document, UpdateUserRequestDto.name)).toEqual({
      type: 'object',
      properties: {
        displayName: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
        },
        email: {
          type: 'string',
          minLength: 1,
          maxLength: 254,
          nullable: true,
        },
        mobileE164: {
          type: 'string',
          minLength: 1,
          maxLength: 16,
          nullable: true,
        },
        avatarUrl: {
          type: 'string',
          minLength: 1,
          maxLength: 2048,
          nullable: true,
        },
        issuerPrefix: {
          type: 'string',
          minLength: 1,
          maxLength: 3,
          nullable: true,
          description: '出单人前缀；最多 3 个汉字',
        },
        remark: {
          type: 'string',
          minLength: 1,
          maxLength: 2000,
          nullable: true,
        },
      },
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
