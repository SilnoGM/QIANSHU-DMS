import { requestIdMiddleware } from '../../infrastructure/http/request-id.middleware'
import { attachRequestAuthContext } from './auth-context'
import { AuthContextService } from './auth-context.service'
import { AuthController } from './auth.controller'
import type { IssuedSession } from './auth-session.service'
import { AuthService } from './auth.service'
import { LogoutService } from './logout.service'
import { PasswordChangeService } from './password-change.service'
import { SessionCookieProvider } from './providers/session-cookie.provider'

const USER_ID = '8ac94425-c78c-4b32-ae2d-e3ce808b0275'
const SESSION_ID = 'e8acf4bf-51b9-4fbf-a2eb-4b107fbec1e1'
const TOKEN_VALUE = `${SESSION_ID}.${Buffer.alloc(32, 2).toString('base64url')}`
type Request = object & {
  headers: { cookie?: string }
  ip: string
}

type Response = {
  cookie(name: string, value: string, options: object): unknown
}

const ISSUED_SESSION: IssuedSession = {
  tokenValue: TOKEN_VALUE,
  session: {
    id: SESSION_ID,
    userId: USER_ID,
    username: 'operator',
    displayName: '操作员',
    mustChangePassword: false,
    createdAt: new Date('2026-07-17T08:00:00.000Z'),
    lastActivityAt: new Date('2026-07-17T08:00:00.000Z'),
    idleExpiresAt: new Date('2026-07-19T08:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-08-16T08:00:00.000Z'),
  },
}

const AUTH_DTO = {
  user: {
    id: USER_ID,
    username: 'operator',
    displayName: '操作员',
    mustChangePassword: false,
  },
  permissions: ['users:read'],
  session: {
    createdAt: '2026-07-17T08:00:00.000Z',
    lastActivityAt: '2026-07-17T08:00:00.000Z',
    idleExpiresAt: '2026-07-19T08:00:00.000Z',
    absoluteExpiresAt: '2026-08-16T08:00:00.000Z',
  },
}

function createRequest(cookie?: string): Request {
  const request = {
    headers: cookie === undefined ? {} : { cookie },
    ip: '192.0.2.30',
  } as unknown as Request
  requestIdMiddleware(
    request,
    { setHeader: jest.fn() },
    jest.fn(),
  )
  return request
}

function attachSession(request: Request): void {
  attachRequestAuthContext(request, ISSUED_SESSION.session)
}

function createFixture() {
  const loginResult = {
    issuedSession: ISSUED_SESSION,
    permissions: ['users:read'],
  }
  const auth = {
    login: jest
      .fn<Promise<typeof loginResult>, [Record<string, unknown>]>()
      .mockResolvedValue(loginResult),
  }
  const passwordChange = {
    change: jest
      .fn<Promise<typeof loginResult>, [Record<string, unknown>]>()
      .mockResolvedValue(loginResult),
  }
  const logout = {
    logout: jest
      .fn<Promise<void>, [Record<string, unknown>]>()
      .mockResolvedValue(undefined),
    logoutAll: jest
      .fn<Promise<void>, [Record<string, unknown>]>()
      .mockResolvedValue(undefined),
  }
  const authContext = {
    get: jest.fn().mockResolvedValue(AUTH_DTO),
    fromMutationResult: jest.fn().mockReturnValue(AUTH_DTO),
  }
  const cookie = {
    readValue: jest.fn().mockReturnValue('existing-token'),
    create: jest.fn().mockReturnValue({
      name: 'qianshu_session_dev',
      value: TOKEN_VALUE,
      options: { httpOnly: true, sameSite: 'strict', path: '/' },
    }),
    clear: jest.fn().mockReturnValue({
      name: 'qianshu_session_dev',
      value: '',
      options: { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 0 },
    }),
  }
  const controller = new AuthController(
    auth as unknown as AuthService,
    passwordChange as unknown as PasswordChangeService,
    logout as unknown as LogoutService,
    authContext as unknown as AuthContextService,
    cookie as unknown as SessionCookieProvider,
  )
  const response = { cookie: jest.fn() } as unknown as Response

  return {
    auth,
    authContext,
    controller,
    cookie,
    logout,
    passwordChange,
    response,
  }
}

describe('AuthController', () => {
  it('logs in, sets the HttpOnly Session Cookie and returns only AuthContext', async () => {
    const fixture = createFixture()
    const request = createRequest('qianshu_session_dev=existing-token')

    await expect(
      fixture.controller.login(
        { username: 'operator', password: 'password input' },
        request,
        fixture.response,
      ),
    ).resolves.toEqual(AUTH_DTO)

    const loginInput = fixture.auth.login.mock.calls[0]?.[0]
    expect(loginInput).toMatchObject({
      username: 'operator',
      password: 'password input',
      sourceIp: '192.0.2.30',
      existingSessionToken: 'existing-token',
    })
    expect(loginInput?.requestId).toMatch(/^req_/)
    expect(fixture.cookie.create).toHaveBeenCalledWith(
      TOKEN_VALUE,
      ISSUED_SESSION.session.absoluteExpiresAt,
    )
    expect(fixture.response.cookie).toHaveBeenCalledWith(
      'qianshu_session_dev',
      TOKEN_VALUE,
      expect.objectContaining({ httpOnly: true, sameSite: 'strict' }),
    )
    expect(JSON.stringify(AUTH_DTO)).not.toContain(TOKEN_VALUE)
  })

  it('returns current context from the Guard-bound request identity', async () => {
    const fixture = createFixture()
    const request = createRequest()
    attachSession(request)

    await expect(fixture.controller.me(request)).resolves.toEqual(AUTH_DTO)
    expect(fixture.authContext.get).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, sessionId: SESSION_ID }),
    )
  })

  it('rotates the Cookie after a successful normal or forced password change', async () => {
    const fixture = createFixture()
    const request = createRequest()
    attachSession(request)

    await expect(
      fixture.controller.changePassword(
        { currentPassword: 'old', newPassword: 'new password input' },
        request,
        fixture.response,
      ),
    ).resolves.toEqual(AUTH_DTO)

    expect(fixture.passwordChange.change).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPassword: 'old',
        newPassword: 'new password input',
        sourceIp: '192.0.2.30',
      }),
    )
    expect(fixture.response.cookie).toHaveBeenCalledWith(
      'qianshu_session_dev',
      TOKEN_VALUE,
      expect.any(Object),
    )
  })

  it('keeps optional logout successful without a valid Session and always clears Cookie', async () => {
    const fixture = createFixture()
    const request = createRequest()

    await expect(
      fixture.controller.logout({}, request, fixture.response),
    ).resolves.toBeUndefined()

    expect(fixture.logout.logout).toHaveBeenCalledWith(
      expect.objectContaining({ auth: null, sourceIp: '192.0.2.30' }),
    )
    expect(fixture.response.cookie).toHaveBeenCalledWith(
      'qianshu_session_dev',
      '',
      expect.objectContaining({ maxAge: 0 }),
    )
  })

  it('invalidates all Sessions and clears Cookie for logout-all', async () => {
    const fixture = createFixture()
    const request = createRequest()
    attachSession(request)

    await fixture.controller.logoutAll({}, request, fixture.response)

    const logoutAllInput = fixture.logout.logoutAll.mock.calls[0]?.[0]
    expect(logoutAllInput?.auth).toMatchObject({ userId: USER_ID })
    expect(fixture.response.cookie).toHaveBeenCalledWith(
      'qianshu_session_dev',
      '',
      expect.any(Object),
    )
  })
})
