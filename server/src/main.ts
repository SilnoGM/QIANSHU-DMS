import 'reflect-metadata'

import {
  ConsoleLogger,
  type INestApplication,
  Logger,
  type Type,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'

import { configureApplication } from './app.setup'

type ApplicationFactory = (
  rootModule: Type<unknown>,
) => Promise<INestApplication>
type RootModuleLoader = () => Promise<Type<unknown>>

interface ExpressApplicationSettings {
  set(setting: string, value: unknown): unknown
}

const createNestApplication: ApplicationFactory = (rootModule) =>
  NestFactory.create(rootModule, {
    abortOnError: false,
    logger: false,
  })

const loadAppModule: RootModuleLoader = async () => {
  const { AppModule } = await import('./app.module')
  return AppModule
}

export async function bootstrap(
  applicationFactory: ApplicationFactory = createNestApplication,
  rootModuleLoader: RootModuleLoader = loadAppModule,
): Promise<void> {
  let application: INestApplication | undefined
  let nestLoggerWasDisabled = false
  const runtimeLogger = new ConsoleLogger('Server')

  try {
    // AppModule 会在加载时执行环境校验，延迟到此处后其异常才能进入统一、脱敏的启动失败边界。
    const rootModule = await rootModuleLoader()
    // 只有默认 factory 会用 logger:false 修改 Nest 全局 Logger；必须在真实调用前才标记，避免污染注入调用方。
    nestLoggerWasDisabled = applicationFactory === createNestApplication
    application = await applicationFactory(rootModule)
    const configService = application.get(ConfigService)
    const nodeEnvironment = configService.getOrThrow<
      'development' | 'test' | 'production'
    >('app.nodeEnv')
    configureApplication(application, { nodeEnvironment })

    const port = configService.getOrThrow<number>('app.port')
    const trustProxyHops = configService.getOrThrow<number>(
      'auth.trustProxyHops',
    )
    const expressApplication = application
      .getHttpAdapter()
      .getInstance() as ExpressApplicationSettings

    // 只接受校验后的明确 hop 数；绝不使用会信任任意转发头的 trust proxy=true。
    expressApplication.set('trust proxy', trustProxyHops)
    await application.listen(port)
    // 初始化与监听成功后才恢复 Nest 日志，避免失败路径先于脱敏边界输出底层异常。
    application.useLogger(runtimeLogger)
  } catch (error) {
    if (application) {
      try {
        // 创建应用后的任何失败都尝试关闭资源；清理失败不能覆盖更有诊断价值的原始启动异常。
        await application.close()
      } catch {
        // 此处有意吞掉清理异常，顶层只记录固定脱敏消息，避免底层连接详情进入日志。
      }
    }

    if (nestLoggerWasDisabled) {
      // 默认 NestFactory 创建阶段会临时关闭全局 Logger；失败清理完成后恢复，避免污染后续进程状态。
      Logger.overrideLogger(runtimeLogger)
    }

    throw error
  }
}

export async function runMain(
  startServer: () => Promise<void> = bootstrap,
): Promise<void> {
  try {
    await startServer()
  } catch {
    // 启动异常可能携带 DATABASE_URL 或驱动详情，入口日志必须保持固定且不输出原始异常。
    new ConsoleLogger('Bootstrap').error('Server bootstrap failed')
    process.exitCode = 1
  }
}

// 测试或工具导入本模块时不得自动监听端口，只有直接执行编译产物才启动服务。
if (require.main === module) {
  void runMain()
}
