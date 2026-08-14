import { ValidationPipe } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { createValidationException } from '../../../infrastructure/http/validation-exception.factory'
import {
  ProductMediaDetachRequestDto,
  ProductMediaIdParamDto,
  ProductMediaLayoutRequestDto,
  ProductMediaUploadRequestDto,
} from './product-media.dto'

const dtoPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  exceptionFactory: createValidationException,
})

const IMAGE_ID = '11111111-1111-4111-8111-111111111111'
const VIDEO_ID = '22222222-2222-4222-8222-222222222222'

describe('Product media request DTOs', () => {
  it('accepts exact ProductMedia locators and layout/detach bodies', async () => {
    expect(await validate(plainToInstance(ProductMediaIdParamDto, {
      productId: IMAGE_ID,
      productMediaId: VIDEO_ID,
    }))).toEqual([])

    await expect(dtoPipe.transform({
      expectedVersion: 2,
      imageIds: [IMAGE_ID],
      videoIds: [VIDEO_ID],
      primaryImageId: IMAGE_ID,
    }, {
      type: 'body',
      metatype: ProductMediaLayoutRequestDto,
    })).resolves.toMatchObject({
      expectedVersion: 2,
      imageIds: [IMAGE_ID],
      videoIds: [VIDEO_ID],
      primaryImageId: IMAGE_ID,
    })

    await expect(dtoPipe.transform({ expectedVersion: 3 }, {
      type: 'body',
      metatype: ProductMediaDetachRequestDto,
    })).resolves.toMatchObject({ expectedVersion: 3 })
  })

  it.each([
    { expectedVersion: 0, imageIds: [], videoIds: [], primaryImageId: null },
    { expectedVersion: 1, imageIds: [IMAGE_ID, IMAGE_ID], videoIds: [], primaryImageId: IMAGE_ID },
    { expectedVersion: 1, imageIds: [], videoIds: [VIDEO_ID, VIDEO_ID], primaryImageId: null },
    { expectedVersion: 1, imageIds: ['not-a-uuid'], videoIds: [], primaryImageId: null },
    { expectedVersion: 1, imageIds: [], videoIds: [], primaryImageId: undefined },
    { expectedVersion: 1, imageIds: [], videoIds: [], primaryImageId: null, unknown: true },
  ])('rejects an invalid or non-whitelisted layout body: %j', async (body) => {
    await expect(dtoPipe.transform(body, {
      type: 'body',
      metatype: ProductMediaLayoutRequestDto,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it.each([
    {},
    { expectedVersion: 0 },
    { expectedVersion: 1, unknown: true },
  ])('rejects an invalid detach body: %j', async (body) => {
    await expect(dtoPipe.transform(body, {
      type: 'body',
      metatype: ProductMediaDetachRequestDto,
    })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('publishes multipart fields as IMAGE/VIDEO plus a positive integer string', async () => {
    expect(await validate(plainToInstance(ProductMediaUploadRequestDto, {
      file: 'binary-placeholder',
      kind: 'IMAGE',
      expectedVersion: '12',
    }))).toEqual([])
    expect(await validate(plainToInstance(ProductMediaUploadRequestDto, {
      file: 'binary-placeholder',
      kind: 'DOCUMENT',
      expectedVersion: '0',
    }))).not.toHaveLength(0)
  })
})
