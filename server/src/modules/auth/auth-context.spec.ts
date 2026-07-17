import type { AuthenticatedSession } from './auth-session.service'
import {
  attachRequestAuthContext,
  getOptionalRequestAuthContext,
  getRequestAuthContext,
} from './auth-context'

const SESSION: AuthenticatedSession = {
  id: '772b69e5-fe77-4316-9cb0-b9ac8ac4d09a',
  userId: 'ab55ea71-fdeb-4126-a811-bc8382f59f9e',
  username: 'operator',
  displayName: '操作员',
  mustChangePassword: true,
  createdAt: new Date('2026-07-17T01:00:00.000Z'),
  lastActivityAt: new Date('2026-07-17T02:00:00.000Z'),
  idleExpiresAt: new Date('2026-07-19T02:00:00.000Z'),
  absoluteExpiresAt: new Date('2026-08-16T01:00:00.000Z'),
}

describe('request auth context', () => {
  it('attaches one immutable, non-enumerable identity snapshot without credentials', () => {
    const request = {
      headers: {
        cookie: 'qianshu_session_dev=selector.secret',
      },
    }

    attachRequestAuthContext(request, SESSION)

    const context = getRequestAuthContext(request)
    expect(context).toEqual({
      sessionId: SESSION.id,
      userId: SESSION.userId,
      username: SESSION.username,
      displayName: SESSION.displayName,
      mustChangePassword: true,
      createdAt: '2026-07-17T01:00:00.000Z',
      lastActivityAt: '2026-07-17T02:00:00.000Z',
      idleExpiresAt: '2026-07-19T02:00:00.000Z',
      absoluteExpiresAt: '2026-08-16T01:00:00.000Z',
    })
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.keys(request)).toEqual(['headers'])
    expect(JSON.stringify(request)).not.toContain('sessionId')
    expect(context).not.toHaveProperty('cookie')
    expect(context).not.toHaveProperty('token')
    expect(context).not.toHaveProperty('tokenValue')
    expect(context).not.toHaveProperty('tokenHash')
  })

  it('does not retain references to mutable Session dates', () => {
    const request = {}

    attachRequestAuthContext(request, SESSION)
    SESSION.createdAt.setUTCFullYear(2030)

    expect(getRequestAuthContext(request).createdAt).toBe(
      '2026-07-17T01:00:00.000Z',
    )
    SESSION.createdAt.setUTCFullYear(2026)
  })

  it('distinguishes optional lookup from a missing required context', () => {
    const request = {}

    expect(getOptionalRequestAuthContext(request)).toBeNull()
    expect(() => getRequestAuthContext(request)).toThrow(
      'Authentication context is unavailable',
    )
  })

  it('does not allow a downstream component to replace an authenticated identity', () => {
    const request = {}

    attachRequestAuthContext(request, SESSION)

    expect(() => attachRequestAuthContext(request, SESSION)).toThrow(
      'Authentication context is already attached',
    )
  })
})
