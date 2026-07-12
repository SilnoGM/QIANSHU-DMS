import { randomUUID } from 'node:crypto'

import { REQUEST_ID_HEADER } from '../../app.constants'
import {
  createRequestId,
  getRequestId,
  requestIdMiddleware,
} from './request-id.middleware'

const CLIENT_VALUE = 'req_00000000-0000-4000-8000-000000000000'
const SERVER_UUID = '550e8400-e29b-41d4-a716-446655440000'
const UNAVAILABLE_REQUEST_ID_ERROR =
  'Request ID is unavailable before requestIdMiddleware runs'

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}))

describe('request ID middleware', () => {
  beforeEach(() => {
    jest.mocked(randomUUID).mockReturnValue(SERVER_UUID)
  })

  it('creates a server-owned request ID with the required prefix', () => {
    expect(createRequestId(() => SERVER_UUID)).toBe(`req_${SERVER_UUID}`)
  })

  it('ignores the inbound header and exposes the generated ID before next runs', () => {
    const request = {
      headers: {
        [REQUEST_ID_HEADER.toLowerCase()]: CLIENT_VALUE,
      },
    }
    let requestIdWhenHeaderWasSet: string | undefined
    const response = {
      setHeader: jest.fn(() => {
        requestIdWhenHeaderWasSet = getRequestId(request)
      }),
    }
    const next = jest.fn()

    requestIdMiddleware(request, response, next)

    expect(requestIdWhenHeaderWasSet).toBe(`req_${SERVER_UUID}`)
    expect(response.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      `req_${SERVER_UUID}`,
    )
    expect(getRequestId(request)).toBe(`req_${SERVER_UUID}`)
    expect(response.setHeader.mock.invocationCallOrder[0]).toBeLessThan(
      next.mock.invocationCallOrder[0],
    )
    expect(getRequestId(request)).not.toBe(CLIENT_VALUE)
  })

  it('throws a fixed safe error instead of generating an ID before middleware', () => {
    const request = {}
    const randomUuid = jest.mocked(randomUUID)
    randomUuid.mockClear()

    expect(() => getRequestId(request)).toThrow(UNAVAILABLE_REQUEST_ID_ERROR)
    expect(() => getRequestId(request)).toThrow(UNAVAILABLE_REQUEST_ID_ERROR)
    expect(randomUuid).not.toHaveBeenCalled()
  })
})
