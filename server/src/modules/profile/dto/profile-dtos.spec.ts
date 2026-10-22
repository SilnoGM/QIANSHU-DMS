import { Controller, Get, Module, Patch } from '@nestjs/common'
import { ApiBody, ApiOkResponse, type OpenAPIObject } from '@nestjs/swagger'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import { CurrentUserProfileDto } from './current-user-profile.dto'
import { UpdateCurrentUserProfileRequestDto } from './update-current-user-profile-request.dto'

async function validatePlain(input: object) {
  const instance = plainToInstance(UpdateCurrentUserProfileRequestDto, input)
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  })

  return errors
}

function errorProperties(
  errors: Awaited<ReturnType<typeof validatePlain>>,
): string[] {
  return errors.map(error => error.property).sort()
}

@Controller('profile-dto-contract')
class ProfileDtoContractController {
  @Get()
  @ApiOkResponse({ type: CurrentUserProfileDto })
  get(): CurrentUserProfileDto {
    throw new Error('OpenAPI scan only')
  }

  @Patch()
  @ApiBody({ type: UpdateCurrentUserProfileRequestDto })
  @ApiOkResponse({ type: CurrentUserProfileDto })
  update(): CurrentUserProfileDto {
    throw new Error('OpenAPI scan only')
  }
}

@Module({ controllers: [ProfileDtoContractController] })
class ProfileDtoContractModule {}

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

describe('UpdateCurrentUserProfileRequestDto', () => {
  it('accepts any non-empty subset and explicit null for all four writable fields', async () => {
    await expect(validatePlain({ email: 'user@example.com' })).resolves.toEqual(
      [],
    )
    await expect(
      validatePlain({ mobileE164: null, avatarUrl: null }),
    ).resolves.toEqual([])
    await expect(
      validatePlain({ email: null, mobileE164: null, avatarUrl: null, issuerPrefix: null }),
    ).resolves.toEqual([])
    await expect(validatePlain({ issuerPrefix: '李华' })).resolves.toEqual([])
    await expect(validatePlain({ issuerPrefix: '李华华' })).resolves.toEqual([])
  })

  it('rejects an empty PATCH and empty supplied strings', async () => {
    const emptyPatch = await validatePlain({})
    const emptyValues = await validatePlain({
      email: '',
      mobileE164: '',
      avatarUrl: '',
      issuerPrefix: '',
    })

    expect(emptyPatch).not.toHaveLength(0)
    expect(errorProperties(emptyValues)).toEqual([
      'avatarUrl',
      'email',
      'issuerPrefix',
      'mobileE164',
    ])
  })

  it('rejects an issuer prefix longer than three Han characters or containing non-Han characters', async () => {
    for (const issuerPrefix of ['李华华华', 'LH', '李1', '李 华', '😀', ' 李华 ']) {
      expect(errorProperties(await validatePlain({ issuerPrefix }))).toEqual([
        'issuerPrefix',
      ])
    }
  })

  it('rejects fields outside the self-service allowlist', async () => {
    const errors = await validatePlain({
      email: 'user@example.com',
      userId: '942ff25a-65f9-45b7-8120-8d4cb2da425e',
      emailNormalized: 'user@example.com',
      remark: 'internal note',
    })

    expect(errorProperties(errors)).toEqual([
      'emailNormalized',
      'remark',
      'userId',
    ])
  })

  it('uses Unicode code points for DTO length boundaries', async () => {
    const maximumAvatar = await validatePlain({
      avatarUrl: '😀'.repeat(2048),
    })
    const oversizedAvatar = await validatePlain({
      avatarUrl: '😀'.repeat(2049),
    })
    const oversizedEmail = await validatePlain({ email: '😀'.repeat(255) })
    const oversizedMobile = await validatePlain({
      mobileE164: '+'.padEnd(17, '1'),
    })

    expect(maximumAvatar).toEqual([])
    expect(errorProperties(oversizedAvatar)).toEqual(['avatarUrl'])
    expect(errorProperties(oversizedEmail)).toEqual(['email'])
    expect(errorProperties(oversizedMobile)).toEqual(['mobileE164'])
  })
})

describe('CurrentUserProfileDto OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(ProfileDtoContractModule)
  })

  it('exposes only the seven self-service response fields', () => {
    expect(requireSchema(document, CurrentUserProfileDto.name)).toEqual({
      type: 'object',
      properties: {
        userId: { type: 'string', format: 'uuid' },
        email: { type: 'string', maxLength: 254, nullable: true },
        mobileE164: {
          type: 'string',
          maxLength: 16,
          nullable: true,
        },
        avatarUrl: {
          type: 'string',
          maxLength: 2048,
          nullable: true,
        },
        issuerPrefix: {
          type: 'string',
          maxLength: 3,
          nullable: true,
          description: '出单人前缀；最多 3 个汉字',
        },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      required: [
        'userId',
        'email',
        'mobileE164',
        'avatarUrl',
        'issuerPrefix',
        'createdAt',
        'updatedAt',
      ],
    })
  })

  it('documents exactly four optional nullable update fields', () => {
    expect(
      requireSchema(document, UpdateCurrentUserProfileRequestDto.name),
    ).toEqual({
      type: 'object',
      properties: {
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
      },
    })
  })
})
