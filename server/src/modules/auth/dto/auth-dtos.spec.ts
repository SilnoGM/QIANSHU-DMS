import { Controller, Module, Post } from '@nestjs/common'
import {
  ApiBody,
  ApiOkResponse,
  type OpenAPIObject,
} from '@nestjs/swagger'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import {
  AuthContextDto,
  AuthSessionDto,
  AuthUserDto,
} from './auth-context.dto'
import { ChangePasswordRequestDto } from './change-password-request.dto'
import { EmptyRequestDto } from './empty-request.dto'
import { LoginRequestDto } from './login-request.dto'

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

@Controller('auth-dto-contract')
class AuthDtoContractController {
  @Post('login')
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({ type: AuthContextDto })
  login(): AuthContextDto {
    throw new Error('OpenAPI scan only')
  }

  @Post('password/change')
  @ApiBody({ type: ChangePasswordRequestDto })
  @ApiOkResponse({ type: AuthContextDto })
  changePassword(): AuthContextDto {
    throw new Error('OpenAPI scan only')
  }

  @Post('logout')
  @ApiBody({ type: EmptyRequestDto, required: true })
  @ApiOkResponse({ type: AuthContextDto })
  logout(): AuthContextDto {
    throw new Error('OpenAPI scan only')
  }
}

@Module({ controllers: [AuthDtoContractController] })
class AuthDtoContractModule {}

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

describe('Auth request DTO validation', () => {
  it('按 Unicode code point 校验 username 的 1..128 边界', async () => {
    const valid = await validatePlain(LoginRequestDto, {
      username: '😀'.repeat(128),
      password: 'valid input',
    })
    const tooLong = await validatePlain(LoginRequestDto, {
      username: '😀'.repeat(129),
      password: 'valid input',
    })
    const empty = await validatePlain(LoginRequestDto, {
      username: '',
      password: 'valid input',
    })

    expect(valid.errors).toEqual([])
    expect(errorProperties(tooLong.errors)).toEqual(['username'])
    expect(errorProperties(empty.errors)).toEqual(['username'])
  })

  it('要求登录密码是 string 且最多 128 code points，并原样保留空格', async () => {
    const password = '  keep surrounding spaces  '
    const valid = await validatePlain(LoginRequestDto, {
      username: 'operator',
      password,
    })
    const emojiBoundary = await validatePlain(LoginRequestDto, {
      username: 'operator',
      password: '😀'.repeat(128),
    })
    const tooLong = await validatePlain(LoginRequestDto, {
      username: 'operator',
      password: '😀'.repeat(129),
    })
    const wrongType = await validatePlain(LoginRequestDto, {
      username: 'operator',
      password: 123,
    })

    expect(valid.errors).toEqual([])
    expect(valid.instance.password).toBe(password)
    expect(emojiBoundary.errors).toEqual([])
    expect(errorProperties(tooLong.errors)).toEqual(['password'])
    expect(errorProperties(wrongType.errors)).toEqual(['password'])
  })

  it('currentPassword 可省略但若提供必须为 string，且密码字段都不 trim', async () => {
    const withoutCurrent = await validatePlain(ChangePasswordRequestDto, {
      newPassword: 'short',
    })
    const currentPassword = '  current password  '
    const newPassword = '  new password  '
    const withSpaces = await validatePlain(ChangePasswordRequestDto, {
      currentPassword,
      newPassword,
    })
    const nullCurrent = await validatePlain(ChangePasswordRequestDto, {
      currentPassword: null,
      newPassword,
    })

    expect(withoutCurrent.errors).toEqual([])
    expect(withSpaces.errors).toEqual([])
    expect(withSpaces.instance.currentPassword).toBe(currentPassword)
    expect(withSpaces.instance.newPassword).toBe(newPassword)
    expect(errorProperties(nullCurrent.errors)).toEqual(['currentPassword'])
  })

  it.each(['currentPassword', 'newPassword'] as const)(
    '%s 按 Unicode code point 拒绝超过 128 的输入',
    async (field) => {
      const input = {
        newPassword: 'valid input',
        [field]: '😀'.repeat(129),
      }
      const result = await validatePlain(ChangePasswordRequestDto, input)

      expect(errorProperties(result.errors)).toEqual([field])
    },
  )

  it('logout empty body 只接受空 JSON object', async () => {
    const empty = await validatePlain(EmptyRequestDto, {})
    const unexpected = await validatePlain(EmptyRequestDto, {
      account: 'must-not-be-accepted',
    })

    expect(empty.errors).toEqual([])
    expect(errorProperties(unexpected.errors)).toEqual(['account'])
  })
})

describe('Auth DTO OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(AuthDtoContractModule)
  })

  it('明确请求字段的必填关系、密码格式和 Unicode code-point 长度', () => {
    expect(requireSchema(document, LoginRequestDto.name)).toEqual({
      type: 'object',
      properties: {
        username: { type: 'string', minLength: 1, maxLength: 128 },
        password: {
          type: 'string',
          format: 'password',
          maxLength: 128,
          writeOnly: true,
        },
      },
      required: ['username', 'password'],
    })
    expect(requireSchema(document, ChangePasswordRequestDto.name)).toEqual({
      type: 'object',
      properties: {
        currentPassword: {
          type: 'string',
          format: 'password',
          maxLength: 128,
          writeOnly: true,
        },
        newPassword: {
          type: 'string',
          format: 'password',
          minLength: 15,
          maxLength: 128,
          writeOnly: true,
        },
      },
      required: ['newPassword'],
    })
    expect(requireSchema(document, EmptyRequestDto.name)).toEqual({
      type: 'object',
      properties: {},
    })
  })

  it('AuthContext 只暴露 user、permissions 与四个 Session 时间', () => {
    expect(requireSchema(document, AuthContextDto.name)).toEqual({
      type: 'object',
      properties: {
        user: { $ref: `#/components/schemas/${AuthUserDto.name}` },
        permissions: {
          type: 'array',
          items: { type: 'string' },
          uniqueItems: true,
        },
        session: { $ref: `#/components/schemas/${AuthSessionDto.name}` },
      },
      required: ['user', 'permissions', 'session'],
    })
    expect(requireSchema(document, AuthUserDto.name)).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        username: { type: 'string', maxLength: 128 },
        displayName: { type: 'string', maxLength: 128 },
        mustChangePassword: { type: 'boolean' },
      },
      required: ['id', 'username', 'displayName', 'mustChangePassword'],
    })
    expect(requireSchema(document, AuthSessionDto.name)).toEqual({
      type: 'object',
      properties: {
        createdAt: { type: 'string', format: 'date-time' },
        lastActivityAt: { type: 'string', format: 'date-time' },
        idleExpiresAt: { type: 'string', format: 'date-time' },
        absoluteExpiresAt: { type: 'string', format: 'date-time' },
      },
      required: [
        'createdAt',
        'lastActivityAt',
        'idleExpiresAt',
        'absoluteExpiresAt',
      ],
    })
  })

  it('响应 Schema 不包含凭证、Cookie 或 Hash 字段', () => {
    const responsePropertyNames = [
      ...Object.keys(
        requireSchema(document, AuthContextDto.name).properties ?? {},
      ),
      ...Object.keys(
        requireSchema(document, AuthUserDto.name).properties ?? {},
      ),
      ...Object.keys(
        requireSchema(document, AuthSessionDto.name).properties ?? {},
      ),
    ]

    expect(responsePropertyNames).not.toEqual(
      expect.arrayContaining([
        'password',
        'passwordHash',
        'token',
        'tokenHash',
        'cookie',
        'sessionId',
      ]),
    )
  })
})
