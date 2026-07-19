import { UserStatus } from '../../generated/prisma/enums'
import type { AuthAdminService } from './auth-admin.service'
import {
  runAuthAdminCommand,
  type AuthAdminIO,
} from './auth-admin.runner'

function createIOFixture(options: {
  interactive?: boolean
  text?: string[]
  secrets?: string[]
} = {}) {
  const text = [...(options.text ?? [])]
  const secrets = [...(options.secrets ?? [])]
  const lines: string[] = []
  const io: AuthAdminIO = {
    isInteractive: jest.fn(() => options.interactive ?? true),
    readText: jest.fn(() => Promise.resolve(text.shift() ?? '')),
    readSecret: jest.fn(() => Promise.resolve(secrets.shift() ?? '')),
    writeLine: jest.fn((line: string) => lines.push(line)),
  }

  return { io, lines }
}

function createServiceFixture() {
  return {
    bootstrap: jest.fn().mockResolvedValue({ userId: 'created-id' }),
    inspectRecoveryTarget: jest.fn().mockResolvedValue({
      userId: 'target-id',
      status: UserStatus.ACTIVE,
    }),
    recover: jest.fn().mockResolvedValue({
      userId: 'target-id',
      enabled: false,
    }),
  }
}

describe('runAuthAdminCommand', () => {
  it('rejects a non-TTY invocation before reading input or touching the database service', async () => {
    const { io } = createIOFixture({ interactive: false })
    const service = createServiceFixture()

    await expect(
      runAuthAdminCommand('bootstrap', io, service as unknown as AuthAdminService),
    ).rejects.toMatchObject({ code: 'INTERACTIVE_TTY_REQUIRED' })
    expect(io.readText).not.toHaveBeenCalled()
    expect(io.readSecret).not.toHaveBeenCalled()
    expect(service.bootstrap).not.toHaveBeenCalled()
  })

  it('uses hidden double-entry for bootstrap and only prints a fixed success message', async () => {
    const password = 'Admin-pass-2026!'
    const { io, lines } = createIOFixture({
      text: ['RootAdmin', '系统管理员'],
      secrets: [password, password],
    })
    const service = createServiceFixture()

    await runAuthAdminCommand(
      'bootstrap',
      io,
      service as unknown as AuthAdminService,
    )

    expect(io.readSecret).toHaveBeenCalledTimes(2)
    expect(service.bootstrap).toHaveBeenCalledWith({
      username: 'RootAdmin',
      displayName: '系统管理员',
      password,
    })
    expect(lines).toEqual(['system_admin 初始化完成。'])
    expect(JSON.stringify(lines)).not.toContain(password)
  })

  it('does not call the service when the two passwords differ', async () => {
    const { io } = createIOFixture({
      text: ['RootAdmin', '系统管理员'],
      secrets: ['Admin-pass-2026!', 'Different-pass-2026!'],
    })
    const service = createServiceFixture()

    await expect(
      runAuthAdminCommand(
        'bootstrap',
        io,
        service as unknown as AuthAdminService,
      ),
    ).rejects.toMatchObject({ code: 'PASSWORD_CONFIRMATION_MISMATCH' })
    expect(service.bootstrap).not.toHaveBeenCalled()
  })

  it.each([
    ['', false],
    ['ENABLE', true],
  ] as const)(
    'keeps a disabled administrator disabled unless the operator types the exact high-risk confirmation %j',
    async (confirmation, expectedEnable) => {
      const password = 'Admin-new-2026!'
      const { io, lines } = createIOFixture({
        text: ['rootadmin', confirmation],
        secrets: [password, password],
      })
      const service = createServiceFixture()
      service.inspectRecoveryTarget.mockResolvedValue({
        userId: 'target-id',
        status: UserStatus.DISABLED,
      })

      await runAuthAdminCommand(
        'recover',
        io,
        service as unknown as AuthAdminService,
      )

      expect(service.recover).toHaveBeenCalledWith({
        username: 'rootadmin',
        password,
        enableDisabled: expectedEnable,
      })
      expect(lines).toEqual([
        'HIGH_PRIORITY: system_admin 离线恢复完成，请立即核查审计事件。',
      ])
      expect(JSON.stringify(lines)).not.toContain(password)
    },
  )
})
