import { Injectable } from '@nestjs/common'

import type { MediaConfiguration } from '../../config/media.config'
import type { MediaOperationalHealthResult } from '../media/media-operational-health'

/**
 * 媒体探针的动态入口。
 *
 * `media-operational-health` 会连带加载 COS SDK；系统状态模块若静态引用它，
 * OpenAPI 预览与模块隔离测试的导入成本会明显增加。这里只在真正探测时动态导入，
 * 让状态模块本身保持轻量。
 */
@Injectable()
export class MediaHealthCollector {
  async collect(
    configuration: MediaConfiguration,
  ): Promise<MediaOperationalHealthResult> {
    const { collectMediaOperationalHealth } = await import(
      '../media/media-operational-health'
    )
    return collectMediaOperationalHealth(configuration)
  }
}
