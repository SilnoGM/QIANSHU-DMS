import { promises as fileSystem } from 'node:fs'
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  basename,
  dirname,
  join,
  resolve,
} from 'node:path'

import {
  defaultSnapshotPath,
  generateOpenApiSnapshot,
  parseGenerateOpenApiArguments,
  runGenerateOpenApi,
} from './generate-openapi'

const INVALID_ARGUMENTS_MESSAGE = 'Invalid OpenAPI generator arguments'

function expectedServerRoot(): string {
  return dirname(dirname(defaultSnapshotPath))
}

async function createTemporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'qianshu-openapi-generator-'))
}

async function expectOnlySnapshotRemains(outputPath: string): Promise<void> {
  expect(await readdir(dirname(outputPath))).toEqual([
    basename(outputPath),
  ])
}

describe('parseGenerateOpenApiArguments', () => {
  it('uses the committed Server snapshot by default', () => {
    expect(parseGenerateOpenApiArguments([])).toEqual({
      outputPath: defaultSnapshotPath,
    })
  })

  it('preserves an absolute output path', () => {
    const absolutePath = join(
      tmpdir(),
      'qianshu-openapi-absolute.json',
    )

    expect(
      parseGenerateOpenApiArguments(['--output', absolutePath]),
    ).toEqual({ outputPath: absolutePath })
  })

  it('resolves a relative output path from the Server root', () => {
    expect(
      parseGenerateOpenApiArguments([
        '--output',
        'temporary/openapi.json',
      ]),
    ).toEqual({
      outputPath: resolve(
        expectedServerRoot(),
        'temporary/openapi.json',
      ),
    })
  })

  it.each([
    ['unknown option', ['--unknown']],
    ['missing output value', ['--output']],
    ['option-shaped output value', ['--output', '--unknown']],
    [
      'duplicate output option',
      ['--output', 'first.json', '--output', 'second.json'],
    ],
    ['positional argument', ['snapshot.json']],
    [
      'extra positional argument',
      ['--output', 'snapshot.json', 'extra'],
    ],
    ['empty output value', ['--output', '']],
    ['blank output value', ['--output', '   ']],
  ])('rejects %s', (_label, argv) => {
    expect(() => parseGenerateOpenApiArguments(argv)).toThrow(
      INVALID_ARGUMENTS_MESSAGE,
    )
  })
})

describe('generateOpenApiSnapshot', () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
    jest.restoreAllMocks()
  })

  it('creates a missing parent and writes stable two-space JSON with one trailing newline', async () => {
    const temporaryDirectory = await createTemporaryDirectory()
    temporaryDirectories.push(temporaryDirectory)
    const outputPath = join(
      temporaryDirectory,
      'missing',
      'nested',
      'openapi.json',
    )

    await generateOpenApiSnapshot(outputPath)

    const snapshotText = await readFile(outputPath, 'utf8')
    const document = JSON.parse(snapshotText) as unknown
    expect(snapshotText).toBe(`${JSON.stringify(document, null, 2)}\n`)
    expect(snapshotText.endsWith('\n\n')).toBe(false)
    await expectOnlySnapshotRemains(outputPath)
  })

  it('removes a partially written sibling temp and preserves an existing snapshot when writing fails', async () => {
    const temporaryDirectory = await createTemporaryDirectory()
    temporaryDirectories.push(temporaryDirectory)
    const outputPath = join(temporaryDirectory, 'openapi.json')
    const originalSnapshot = '{"existing":true}\n'
    await writeFile(outputPath, originalSnapshot, 'utf8')
    const writeFileImplementation = fileSystem.writeFile.bind(fileSystem)
    jest
      .spyOn(fileSystem, 'writeFile')
      .mockImplementationOnce(async (...argumentsList) => {
        await writeFileImplementation(...argumentsList)
        throw new Error('injected snapshot write failure')
      })

    await expect(generateOpenApiSnapshot(outputPath)).rejects.toThrow(
      'injected snapshot write failure',
    )

    expect(await readFile(outputPath, 'utf8')).toBe(originalSnapshot)
    await expectOnlySnapshotRemains(outputPath)
  })

  it('removes the sibling temp and preserves an existing snapshot when rename fails', async () => {
    const temporaryDirectory = await createTemporaryDirectory()
    temporaryDirectories.push(temporaryDirectory)
    const outputPath = join(temporaryDirectory, 'openapi.json')
    const originalSnapshot = '{"existing":true}\n'
    await writeFile(outputPath, originalSnapshot, 'utf8')
    jest
      .spyOn(fileSystem, 'rename')
      .mockRejectedValueOnce(new Error('injected snapshot rename failure'))

    await expect(generateOpenApiSnapshot(outputPath)).rejects.toThrow(
      'injected snapshot rename failure',
    )

    expect(await readFile(outputPath, 'utf8')).toBe(originalSnapshot)
    await expectOnlySnapshotRemains(outputPath)
  })
})

describe('runGenerateOpenApi', () => {
  const originalExitCode = process.exitCode

  afterEach(() => {
    process.exitCode = originalExitCode
    jest.restoreAllMocks()
  })

  it('passes the parsed output path to the generator', async () => {
    const outputPath = join(tmpdir(), 'qianshu-openapi-run.json')
    const generate = jest.fn().mockResolvedValue(undefined)

    await runGenerateOpenApi(['--output', outputPath], generate)

    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledWith(outputPath)
  })

  it('uses a fixed safe error and non-zero exit code for argument failures', async () => {
    process.exitCode = undefined
    const generate = jest.fn().mockResolvedValue(undefined)
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    await runGenerateOpenApi(['--unknown'], generate)

    expect(generate).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'OpenAPI snapshot generation failed',
    )
    expect(process.exitCode).toBe(1)
  })

  it('does not expose a generator failure cause or output path', async () => {
    process.exitCode = undefined
    const sensitiveCause = new Error(
      'postgresql://user:password@localhost/private',
    )
    const generate = jest.fn().mockRejectedValue(sensitiveCause)
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    await runGenerateOpenApi(
      ['--output', '/private/contract/openapi.json'],
      generate,
    )

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'OpenAPI snapshot generation failed',
    )
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(
      'password',
    )
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(
      '/private/contract/openapi.json',
    )
    expect(process.exitCode).toBe(1)
  })
})
