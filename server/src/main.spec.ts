import {
  ConsoleLogger,
  type INestApplication,
  Logger,
  Module,
  type Type,
} from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

type AppModuleClass = typeof import('./app.module').AppModule
type Bootstrap = typeof import('./main').bootstrap
type RunMain = typeof import('./main').runMain

let AppModule: AppModuleClass
let bootstrap: Bootstrap
let runMain: RunMain

const originalDatabaseUrl = process.env.DATABASE_URL

beforeAll(async () => {
  // AppModule 在模块加载时执行环境校验；此处只提供不可用于真实认证的测试 URL，不会连接数据库。
  process.env.DATABASE_URL = 'postgresql://localhost:5432/qianshu_test'

  const appModuleExports = await import('./app.module')
  const mainExports = await import('./main')
  AppModule = appModuleExports.AppModule
  bootstrap = mainExports.bootstrap
  runMain = mainExports.runMain
})

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL
    return
  }

  process.env.DATABASE_URL = originalDatabaseUrl
})

describe('entry module', () => {
  it('can be imported without validating runtime environment', async () => {
    const databaseUrl = process.env.DATABASE_URL
    const exitCode = process.exitCode
    const stderrWrite = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)

    try {
      delete process.env.DATABASE_URL
      let importedMain: typeof import('./main') | undefined

      await jest.isolateModulesAsync(async () => {
        importedMain = await import('./main')
      })

      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(typeof importedMain?.bootstrap).toBe('function')
      expect(typeof importedMain?.runMain).toBe('function')
      expect(stderrWrite).not.toHaveBeenCalled()
      expect(process.exitCode).toBe(exitCode)
    } finally {
      stderrWrite.mockRestore()
      process.exitCode = exitCode

      if (databaseUrl === undefined) {
        delete process.env.DATABASE_URL
      } else {
        process.env.DATABASE_URL = databaseUrl
      }
    }
  })
})

describe('bootstrap', () => {
  function createRootModuleLoader() {
    return jest
      .fn<Promise<Type<unknown>>, []>()
      .mockResolvedValue(AppModule)
  }

  function createApplication(options?: {
    listenError?: Error
    closeError?: Error
  }) {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue(43101),
    }
    const application = {
      setGlobalPrefix: jest.fn(),
      useGlobalPipes: jest.fn(),
      enableShutdownHooks: jest.fn(),
      useLogger: jest.fn(),
      get: jest.fn().mockReturnValue(configService),
      listen: options?.listenError
        ? jest.fn().mockRejectedValue(options.listenError)
        : jest.fn().mockResolvedValue(undefined),
      close: options?.closeError
        ? jest.fn().mockRejectedValue(options.closeError)
        : jest.fn().mockResolvedValue(undefined),
    }

    return { application, configService }
  }

  it('does not replace the caller logger when root module loading fails', async () => {
    const loadingError = new Error('module loading failed')
    const overrideLogger = jest.spyOn(Logger, 'overrideLogger')
    const rootModuleLoader = jest
      .fn<Promise<Type<unknown>>, []>()
      .mockRejectedValue(loadingError)

    try {
      await expect(bootstrap(undefined, rootModuleLoader)).rejects.toBe(
        loadingError,
      )
      expect(overrideLogger).not.toHaveBeenCalled()
    } finally {
      overrideLogger.mockRestore()
      Logger.overrideLogger(new ConsoleLogger())
    }
  })

  it('does not replace the caller logger when an injected factory fails', async () => {
    const factoryError = new Error('injected factory failed')
    const overrideLogger = jest.spyOn(Logger, 'overrideLogger')
    const applicationFactory = jest
      .fn<Promise<INestApplication>, [Type<unknown>]>()
      .mockRejectedValue(factoryError)

    try {
      await expect(
        bootstrap(applicationFactory, createRootModuleLoader()),
      ).rejects.toBe(factoryError)
      expect(overrideLogger).not.toHaveBeenCalled()
    } finally {
      overrideLogger.mockRestore()
      Logger.overrideLogger(new ConsoleLogger())
    }
  })

  it('disables Nest fatal abort so bootstrap errors reach the sanitized boundary', async () => {
    const { application } = createApplication()
    const createApplicationSpy = jest
      .spyOn(NestFactory, 'create')
      .mockResolvedValue(application as never)

    try {
      await bootstrap(undefined, createRootModuleLoader())

      expect(createApplicationSpy).toHaveBeenCalledWith(AppModule, {
        abortOnError: false,
        logger: false,
      })
    } finally {
      createApplicationSpy.mockRestore()
    }
  })

  it('does not log a real Nest initialization error or terminate the process', async () => {
    const initializationError = new Error('nest-do-not-print')

    @Module({
      providers: [
        {
          provide: 'FAILURE_PROBE',
          useFactory: () => {
            throw initializationError
          },
        },
      ],
    })
    class FailingModule {}

    const stderrWrite = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    const exitCode = process.exitCode
    const overrideLogger = jest.spyOn(Logger, 'overrideLogger')
    const rootModuleLoader = jest
      .fn<Promise<Type<unknown>>, []>()
      .mockResolvedValue(FailingModule)

    try {
      await expect(bootstrap(undefined, rootModuleLoader)).rejects.toBe(
        initializationError,
      )
      expect(stderrWrite).not.toHaveBeenCalled()
      expect(overrideLogger).toHaveBeenCalledWith(expect.any(ConsoleLogger))
      expect(process.exitCode).toBe(exitCode)
    } finally {
      stderrWrite.mockRestore()
      process.exitCode = exitCode
      overrideLogger.mockRestore()
      Logger.overrideLogger(new ConsoleLogger())
    }
  })

  it('creates AppModule, configures the application and listens on app.port', async () => {
    const { application, configService } = createApplication()
    const applicationFactory = jest
      .fn<Promise<INestApplication>, [Type<unknown>]>()
      .mockResolvedValue(application as unknown as INestApplication)
    const rootModuleLoader = createRootModuleLoader()

    await bootstrap(applicationFactory, rootModuleLoader)

    expect(rootModuleLoader).toHaveBeenCalledTimes(1)
    expect(applicationFactory).toHaveBeenCalledWith(AppModule)
    expect(application.setGlobalPrefix).toHaveBeenCalledWith('api')
    expect(application.enableShutdownHooks).toHaveBeenCalledTimes(1)
    expect(configService.getOrThrow).toHaveBeenCalledWith('app.port')
    expect(application.listen).toHaveBeenCalledWith(43101)
    expect(application.useLogger).toHaveBeenCalledWith(
      expect.any(ConsoleLogger),
    )
    expect(application.listen.mock.invocationCallOrder[0]).toBeLessThan(
      application.useLogger.mock.invocationCallOrder[0] ?? Infinity,
    )
    expect(application.close).not.toHaveBeenCalled()
  })

  it('closes the application when listening fails', async () => {
    const listenError = new Error('listen failed')
    const { application } = createApplication({ listenError })
    const applicationFactory = jest
      .fn<Promise<INestApplication>, [Type<unknown>]>()
      .mockResolvedValue(application as unknown as INestApplication)
    const rootModuleLoader = createRootModuleLoader()

    await expect(bootstrap(applicationFactory, rootModuleLoader)).rejects.toBe(
      listenError,
    )
    expect(application.close).toHaveBeenCalledTimes(1)
  })

  it('keeps the original bootstrap error when cleanup also fails', async () => {
    const listenError = new Error('listen failed')
    const closeError = new Error('close failed')
    const { application } = createApplication({ listenError, closeError })
    const applicationFactory = jest
      .fn<Promise<INestApplication>, [Type<unknown>]>()
      .mockResolvedValue(application as unknown as INestApplication)
    const rootModuleLoader = createRootModuleLoader()

    await expect(bootstrap(applicationFactory, rootModuleLoader)).rejects.toBe(
      listenError,
    )
    expect(application.close).toHaveBeenCalledTimes(1)
  })
})

describe('runMain', () => {
  const originalExitCode = process.exitCode

  afterEach(() => {
    process.exitCode = originalExitCode
    jest.restoreAllMocks()
  })

  it('reports a fixed sanitized message and marks the process as failed', async () => {
    const unsafeError = new Error(
      'postgresql://user:do-not-print@localhost:5432/qianshu',
    )
    const logger = jest
      .spyOn(ConsoleLogger.prototype, 'error')
      .mockImplementation()

    await runMain(jest.fn().mockRejectedValue(unsafeError))

    expect(logger).toHaveBeenCalledWith('Server bootstrap failed')
    expect(logger).not.toHaveBeenCalledWith(
      expect.stringContaining('do-not-print'),
    )
    expect(process.exitCode).toBe(1)
  })
})
