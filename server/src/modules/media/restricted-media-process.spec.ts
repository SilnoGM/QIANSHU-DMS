import { spawn } from 'node:child_process'

import { RestrictedMediaProcessError } from './restricted-media-process'
import { runRestrictedMediaProcess } from './restricted-media-process'

const NODE_EXECUTABLE = process.execPath

describe('runRestrictedMediaProcess', () => {
  it('uses an absolute executable, no shell, closed stdin and a minimal environment', async () => {
    const spawnSpy = jest.fn(spawn)

    const result = await runRestrictedMediaProcess(
      {
        arguments: ['-e', 'process.stdout.write("safe-json")'],
        executablePath: NODE_EXECUTABLE,
        stderrLimitBytes: 64,
        stdoutLimitBytes: 64,
        timeoutMs: 2_000,
      },
      spawnSpy,
    )

    expect(result).toEqual({ stdout: 'safe-json' })
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    expect(spawnSpy.mock.calls[0]?.[2]).toMatchObject({
      env: { LANG: 'C', LC_ALL: 'C' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  })

  it('rejects relative executables and NUL arguments before spawning', async () => {
    const spawnSpy = jest.fn(spawn)

    await expect(
      runRestrictedMediaProcess({
        arguments: [],
        executablePath: 'ffprobe',
        stderrLimitBytes: 64,
        stdoutLimitBytes: 64,
        timeoutMs: 100,
      }, spawnSpy),
    ).rejects.toMatchObject({ code: 'MEDIA_PROCESS_CONFIGURATION_INVALID' })
    await expect(
      runRestrictedMediaProcess({
        arguments: ['unsafe\0argument'],
        executablePath: NODE_EXECUTABLE,
        stderrLimitBytes: 64,
        stdoutLimitBytes: 64,
        timeoutMs: 100,
      }, spawnSpy),
    ).rejects.toMatchObject({ code: 'MEDIA_PROCESS_CONFIGURATION_INVALID' })
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it('terminates a timed-out process and exposes no command details', async () => {
    const sensitiveCanary = '/private/media/customer-secret.mp4'

    await expect(
      runRestrictedMediaProcess({
        arguments: ['-e', `setInterval(() => {}, 1000)`, sensitiveCanary],
        executablePath: NODE_EXECUTABLE,
        stderrLimitBytes: 64,
        stdoutLimitBytes: 64,
        timeoutMs: 25,
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_PROCESS_TIMEOUT',
      message: 'Media validator process timed out',
    })

    try {
      await runRestrictedMediaProcess({
        arguments: ['-e', `setInterval(() => {}, 1000)`, sensitiveCanary],
        executablePath: NODE_EXECUTABLE,
        stderrLimitBytes: 64,
        stdoutLimitBytes: 64,
        timeoutMs: 25,
      })
    }
    catch (error) {
      expect(String(error)).not.toContain(sensitiveCanary)
    }
  })

  it.each([
    ['stdout', 'process.stdout.write("x".repeat(65))'],
    ['stderr', 'process.stderr.write("x".repeat(65))'],
  ])('fails closed when %s exceeds its byte cap', async (_streamName, script) => {
    await expect(
      runRestrictedMediaProcess({
        arguments: ['-e', script],
        executablePath: NODE_EXECUTABLE,
        stderrLimitBytes: 64,
        stdoutLimitBytes: 64,
        timeoutMs: 2_000,
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_PROCESS_OUTPUT_LIMIT',
      message: 'Media validator process output limit exceeded',
    })
  })

  it('maps spawn and non-zero failures to fixed errors without stderr', async () => {
    const sensitiveCanary = 'customer-secret-document.pdf'
    await expect(
      runRestrictedMediaProcess({
        arguments: [],
        executablePath: '/definitely/missing/media-validator',
        stderrLimitBytes: 64,
        stdoutLimitBytes: 64,
        timeoutMs: 2_000,
      }),
    ).rejects.toMatchObject({
      code: 'MEDIA_PROCESS_UNAVAILABLE',
      message: 'Media validator process is unavailable',
    })

    try {
      await runRestrictedMediaProcess({
        arguments: [
          '-e',
          `process.stderr.write(${JSON.stringify(sensitiveCanary)}); process.exit(7)`,
        ],
        executablePath: NODE_EXECUTABLE,
        stderrLimitBytes: 64,
        stdoutLimitBytes: 64,
        timeoutMs: 2_000,
      })
      throw new Error('Expected restricted process to fail')
    }
    catch (error) {
      expect(error).toBeInstanceOf(RestrictedMediaProcessError)
      expect(error).toMatchObject({
        code: 'MEDIA_PROCESS_EXIT_NON_ZERO',
        message: 'Media validator process rejected the content',
      })
      expect(String(error)).not.toContain(sensitiveCanary)
    }
  })
})
