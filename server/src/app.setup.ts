import {
  HttpStatus,
  type PipeTransform,
  ValidationPipe,
} from '@nestjs/common'

interface ApplicationSetupTarget {
  setGlobalPrefix(prefix: string): unknown
  useGlobalPipes(...pipes: PipeTransform[]): unknown
  enableShutdownHooks(): unknown
}

/**
 * 集中配置所有进程入口都必须遵守的 HTTP 与生命周期基线。
 *
 * 未声明字段直接返回 422，既避免多余输入悄悄进入业务层，也让后续 Controller
 * 获得一致的参数校验语义；shutdown hooks 则确保 Nest 能在终止信号下释放资源。
 */
export function configureApplication(
  application: ApplicationSetupTarget,
): void {
  application.setGlobalPrefix('api')
  application.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  )
  application.enableShutdownHooks()
}
