import type { AuthAdminIO } from './auth-admin.runner'
import {
  executeAuthAdminCli,
  type AuthAdminCliApplication,
} from './auth-admin.main'

function createIO(interactive = true) {
  const lines: string[] = []
  const io: AuthAdminIO = {
    isInteractive: jest.fn(() => interactive),
    readText: jest.fn(),
    readSecret: jest.fn(),
    writeLine: jest.fn((line: string) => lines.push(line)),
  }
  return { io, lines }
}

describe('executeAuthAdminCli', () => {
  it('refuses non-TTY execution before creating an application or database connection', async () => {
    const { io, lines } = createIO(false)
    const createApplication = jest.fn()

    await expect(
      executeAuthAdminCli('bootstrap', io, createApplication),
    ).resolves.toBe(1)
    expect(createApplication).not.toHaveBeenCalled()
    expect(lines).toEqual(['该命令只允许在交互式 TTY 中执行'])
  })

  it('runs the command with the application service and always closes the context', async () => {
    const { io } = createIO()
    io.readText = jest
      .fn()
      .mockResolvedValueOnce('rootadmin')
      .mockResolvedValueOnce('系统管理员')
    io.readSecret = jest
      .fn()
      .mockResolvedValueOnce('Admin-pass-2026!')
      .mockResolvedValueOnce('Admin-pass-2026!')
    const service = {
      bootstrap: jest.fn().mockResolvedValue({ userId: 'created-id' }),
    }
    const application: AuthAdminCliApplication = {
      get: <T>() => service as unknown as T,
      close: jest.fn().mockResolvedValue(undefined),
    }
    const createApplication = jest.fn().mockResolvedValue(application)

    await expect(
      executeAuthAdminCli('bootstrap', io, createApplication),
    ).resolves.toBe(0)
    expect(service.bootstrap).toHaveBeenCalledTimes(1)
    expect(application.close).toHaveBeenCalledTimes(1)
  })

  it('does not leak an unknown startup error and does not attempt to close an unavailable context', async () => {
    const { io, lines } = createIO()
    const createApplication = jest.fn().mockRejectedValue(
      new Error('postgres://operator:secret@db.internal/qianshu'),
    )

    await expect(
      executeAuthAdminCli('recover', io, createApplication),
    ).resolves.toBe(1)
    expect(lines).toEqual(['系统管理员操作失败'])
    expect(JSON.stringify(lines)).not.toContain('secret')
  })
})
