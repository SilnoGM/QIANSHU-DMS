import type {
  CreateCurrencyCatalogProviderOptions,
  CurrencyCatalogInvalidationOptions,
  CurrencyCatalogProviderController,
} from './provider'
import { createCurrencyCatalogProvider } from './provider'

let defaultController: CurrencyCatalogProviderController | null = null

/**
 * 应用启动层显式安装唯一目录实例；纯测试和 Showcase 仍可使用普通 factory。
 */
export function installDefaultCurrencyCatalogProvider(
  options: CreateCurrencyCatalogProviderOptions,
): CurrencyCatalogProviderController {
  const created = createCurrencyCatalogProvider(options)
  const previous = defaultController
  let installed = true

  const controller: CurrencyCatalogProviderController = Object.freeze({
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
 * 管理写成功后的统一失效入口。未安装时安全 no-op，避免已成功的业务写入
 * 因展示层尚未完成挂载而被错误报告为失败。
 */
export function invalidateCurrencyCatalogCache(
  options: CurrencyCatalogInvalidationOptions,
): void {
  defaultController?.invalidate(options)
}
