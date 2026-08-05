import type {
  CreateDictionaryCatalogProviderInput,
  DictionaryCatalogProviderController,
} from './provider'

import { createDictionaryCatalogProviderController } from './provider'

let defaultController: DictionaryCatalogProviderController | null = null

/**
 * 为正式应用安装唯一的字典目录 Provider。
 *
 * 先完整创建新实例再替换旧实例：若新实例初始化失败，已安装的
 * Provider 仍然可用。旧 controller 即使被重复 dispose，也不能清除
 * 后续安装的新默认实例。
 */
export function installDefaultDictionaryCatalogProvider(
  input: CreateDictionaryCatalogProviderInput,
): DictionaryCatalogProviderController {
  const created = createDictionaryCatalogProviderController(input)
  const previous = defaultController
  let installed = true

  const controller: DictionaryCatalogProviderController = Object.freeze({
    provider: created.provider,
    invalidate: created.invalidate,
    dispose: () => {
      if (!installed) {
        return
      }
      installed = false
      created.dispose()
      if (defaultController === controller) {
        defaultController = null
      }
    },
  })

  defaultController = controller
  previous?.dispose()
  return controller
}

/**
 * 管理写成功后的统一精确失效入口。应用尚未安装或已卸载时安全
 * no-op，避免已成功的服务端写入被展示层生命周期误报为失败。
 */
export function invalidateDictionaryCatalogCache(
  input: Parameters<DictionaryCatalogProviderController['invalidate']>[0],
): void {
  defaultController?.invalidate(input)
}
