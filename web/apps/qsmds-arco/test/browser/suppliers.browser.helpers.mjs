import { readConfiguration } from './regions.browser.helpers.mjs'

/**
 * 供应商 Browser 复用真实认证、同源 TLS 代理与 Chrome，只额外接收测试期间
 * 创建只读/无权限身份所需的临时密码。该密码不会传入 Web 构建或 Server。
 */
export function readSupplierBrowserConfiguration(environment) {
  let authentication
  try {
    authentication = readConfiguration(environment)
  }
  catch {
    throw new Error('Browser suppliers test configuration is invalid')
  }
  const limitedPassword
    = environment.QIANSHU_BROWSER_SUPPLIERS_LIMITED_PASSWORD
  const passwordLength = typeof limitedPassword === 'string'
    ? Array.from(limitedPassword.normalize('NFC')).length
    : 0
  if (passwordLength < 8 || passwordLength > 20) {
    throw new Error('Browser suppliers test configuration is invalid')
  }
  return Object.freeze({
    ...authentication,
    limitedPassword,
  })
}

/**
 * 只审计当前供应商工作区与可见 Overlay。移动端要求所有实际交互目标至少
 * 44x44px；桌面端保持紧凑，但两个布局都不得产生 document 横向溢出。
 */
export function supplierLayoutAuditExpression({ mobile }) {
  if (typeof mobile !== 'boolean') {
    throw new TypeError('Supplier layout audit mode is invalid')
  }
  return `(() => {
    const mobile = ${mobile}
    const tolerance = 0.001
    const workspace = document.querySelector(
      '[data-testid="supplier-management-page"]',
    )
    const visibleOverlays = [...document.querySelectorAll('[role="dialog"]')]
      .filter(element => element.getClientRects().length > 0)
    const roots = [workspace, ...visibleOverlays].filter(Boolean)
    const controls = [...new Set(roots.flatMap(root => [
      ...root.querySelectorAll(
        'button, input, textarea, [role="combobox"], [role="checkbox"]',
      ),
    ]))].filter(element => (
      element.getClientRects().length > 0
      && !element.disabled
      && element.getAttribute('aria-disabled') !== 'true'
      && element.getAttribute('aria-hidden') !== 'true'
    ))
    const touchTargets = controls.map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        height: rect.height,
        label: element.getAttribute('aria-label')
          ?? element.textContent?.trim()?.slice(0, 80)
          ?? element.tagName,
        pass: !mobile || (
          rect.width + tolerance >= 44
          && rect.height + tolerance >= 44
        ),
        width: rect.width,
      }
    })
    const mobileRows = [...document.querySelectorAll(
      '[data-testid="supplier-mobile-row"]',
    )].filter(element => element.getClientRects().length > 0)
    const desktopTables = [...document.querySelectorAll(
      '[data-testid="supplier-table"] table',
    )].filter(element => element.getClientRects().length > 0)
    return {
      desktopTableCount: desktopTables.length,
      documentFitsViewport:
        document.documentElement.scrollWidth
        <= document.documentElement.clientWidth + 1,
      mobile,
      mobileRowCount: mobileRows.length,
      touchTargets,
      workspaceVisible: Boolean(
        workspace?.getClientRects().length,
      ),
    }
  })()`
}
