import { readConfiguration } from './regions.browser.helpers.mjs'

/**
 * 字典 Browser 复用认证套件生成的真实同源地址、Chrome 与管理员凭据，只额外
 * 接收一个由根 runner 独立生成并遮罩的普通用户密码。
 */
export function readDictionaryBrowserConfiguration(environment) {
  let authentication
  try {
    authentication = readConfiguration(environment)
  }
  catch {
    throw new Error('Browser dictionaries test configuration is invalid')
  }
  const limitedPassword
    = environment.QIANSHU_BROWSER_DICTIONARIES_LIMITED_PASSWORD
  const passwordLength = typeof limitedPassword === 'string'
    ? Array.from(limitedPassword.normalize('NFC')).length
    : 0
  if (passwordLength < 8 || passwordLength > 20) {
    throw new Error('Browser dictionaries test configuration is invalid')
  }
  return Object.freeze({
    ...authentication,
    limitedPassword,
  })
}

/**
 * 从正式 Vue 应用的 provide 边界定位中立 DictionaryCatalogProvider。
 * 只识别公开只读契约，Browser 测试不得依赖 default controller 的私有失效入口。
 */
export function dictionaryCatalogProviderExpression(body) {
  if (typeof body !== 'string' || body.trim() === '') {
    throw new TypeError('Dictionary provider expression body is invalid')
  }
  return `(() => {
    const app = document.querySelector('#app')?.__vue_app__
    const provides = app?._context?.provides
    const provider = provides
      ? Reflect.ownKeys(provides)
          .map(key => provides[key])
          .find(value => (
            value
            && typeof value.get === 'function'
            && typeof value.prefetch === 'function'
            && typeof value.subscribeInvalidation === 'function'
          ))
      : undefined
    if (!provider) throw new Error('dictionary provider unavailable')
    ${body}
  })()`
}

/**
 * 必须在应用首个 document 创建前安装。Probe 只复制字典失效消息，不读取
 * Cookie、Storage 或网络内容；原生频道仍照常发送，测试不会改变正式时序。
 */
export function installDictionaryBroadcastProbeScript() {
  return `(() => {
    const NativeBroadcastChannel = globalThis.BroadcastChannel
    globalThis.__dictionaryBroadcastPayloads = []
    if (typeof NativeBroadcastChannel !== 'function') return
    globalThis.BroadcastChannel = class DictionaryProbeBroadcastChannel
      extends NativeBroadcastChannel {
      postMessage(message) {
        if (this.name === 'qianshu-dictionary-catalog-v1') {
          try {
            globalThis.__dictionaryBroadcastPayloads.push(
              JSON.parse(JSON.stringify(message)),
            )
          }
          catch {
            // Probe 不能缩窄原生 structured-clone 支持的消息范围。
          }
        }
        return super.postMessage(message)
      }
    }
  })()`
}

/**
 * 生成可在 CDP 页面上下文执行的布局审计。移动端只检查当前字典页面与其可见
 * Dialog/Drawer 中的真实交互控件，避免把全局隐藏模板或无关导航计入 44px。
 */
export function dictionaryLayoutAuditExpression({ mobile }) {
  if (typeof mobile !== 'boolean') {
    throw new TypeError('Dictionary layout audit mode is invalid')
  }
  return `(() => {
    const mobile = ${mobile}
    // Chromium 在缩放与动画合成后可能把 44px 返回为 43.99994px。仅容忍
    // 浮点计算误差；41.8px 等真实不足尺寸仍会失败。
    const touchTargetTolerance = 0.001
    const workspace = document.querySelector(
      '[data-testid="dictionary-management-workspace"]',
    )
    const typePanel = document.querySelector(
      '[data-testid="dictionary-type-panel"]',
    )
    const typePanelScroll = document.querySelector(
      '[data-testid="dictionary-type-panel-scroll"]',
    )
    const typeSummaryPanel = document.querySelector(
      '[data-testid="dictionary-type-summary-panel"]',
    )
    const itemTablePanel = document.querySelector(
      '[data-testid="dictionary-item-table-panel"]',
    )
    const typeDrawerTrigger = document.querySelector(
      '[data-testid="dictionary-open-type-drawer"]',
    )
    const visibleTypeCard = [...document.querySelectorAll(
      '[data-testid="dictionary-type-card"]',
    )].find(element => element.getClientRects().length > 0)
    const typeCardIdentity = visibleTypeCard?.querySelector(
      '[data-testid="dictionary-type-card-identity"]',
    )
    const typeCardMeta = visibleTypeCard?.querySelector(
      '[data-testid="dictionary-type-card-meta"]',
    )
    const cards = [...document.querySelectorAll(
      '[data-testid="dictionary-item-card"]',
    )].filter(element => element.getClientRects().length > 0)
    const desktopTables = [...document.querySelectorAll(
      '[data-testid="dictionary-item-table"] table',
    )].filter(element => element.getClientRects().length > 0)
    const visibleOverlays = [...document.querySelectorAll('[role="dialog"]')]
      .filter(element => element.getClientRects().length > 0)
    const roots = [workspace, ...visibleOverlays].filter(Boolean)
    /*
     * FaCheckbox 的 Reka checkbox 与可点击 Label 是同级节点，通过 for/id 关联。
     * 移动端应审计实际扩大的 Label 目标，并避免把同一控件的 20px 图标重复计为
     * 独立目标；没有关联 Label 的 checkbox 仍按自身几何接受审计。
     */
    const checkboxLabels = roots.flatMap(root => [
      ...root.querySelectorAll('label[for]'),
    ].filter(label => {
      const checkbox = document.getElementById(label.htmlFor)
      return label.getClientRects().length > 0
        && label.getAttribute('aria-hidden') !== 'true'
        && getComputedStyle(label).pointerEvents !== 'none'
        && checkbox?.matches('[role="checkbox"]')
        && root.contains(checkbox)
        && checkbox.getClientRects().length > 0
        && !checkbox.disabled
        && checkbox.getAttribute('aria-disabled') !== 'true'
    }))
    const labelledCheckboxes = new Set(checkboxLabels.map(label =>
      document.getElementById(label.htmlFor)).filter(Boolean))
    const ownedControls = roots.flatMap(root => [
      ...root.querySelectorAll(
        'button, input, textarea, [role="combobox"], [role="checkbox"]',
      ),
    ])
    /*
     * Reka Select 把 option Teleport 到 body；它们不属于 workspace 或 Drawer
     * DOM 子树，但仍是当前移动交互的真实触控目标，必须进入同一审计。
     */
    const ownedSelectContentIds = new Set(roots.flatMap(root => [
      ...root.querySelectorAll(
        '[data-slot="select-trigger"][aria-expanded="true"]',
      ),
    ]).map(trigger => trigger.getAttribute('aria-controls')).filter(Boolean))
    const teleportedOptions = [...document.querySelectorAll(
      '[data-slot="select-content"] [role="option"]',
    )].filter(option => ownedSelectContentIds.has(
      option.closest('[data-slot="select-content"]')?.id,
    ))
    const controls = [...new Set([
      ...ownedControls,
      ...checkboxLabels,
      ...teleportedOptions,
    ])].filter((element) => {
      const associatedCheckbox = element.matches('label[for]')
        ? document.getElementById(element.htmlFor)
        : null
      return element.getClientRects().length > 0
        && element.getAttribute('aria-hidden') !== 'true'
        && element.getAttribute('aria-disabled') !== 'true'
        && !element.disabled
        && !labelledCheckboxes.has(element)
        && !(associatedCheckbox?.matches('[role="checkbox"]')
          && (associatedCheckbox.disabled
            || associatedCheckbox.getAttribute('aria-disabled') === 'true'))
    })
    const touchTargets = controls.map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        height: rect.height,
        label: element.getAttribute('aria-label')
          ?? element.textContent?.trim()?.slice(0, 80)
          ?? element.tagName,
        pass: rect.width + touchTargetTolerance >= 44
          && rect.height + touchTargetTolerance >= 44,
        width: rect.width,
      }
    })
    const viewportWidth = document.documentElement.clientWidth
    const typePanelWidth = typePanel?.getClientRects().length > 0
      ? typePanel.getBoundingClientRect().width
      : null
    const visiblePanels = [typePanel, typeSummaryPanel, itemTablePanel]
      .filter(panel => panel?.getClientRects().length > 0)
    const workspaceRect = workspace?.getBoundingClientRect()
    const typePanelRect = typePanel?.getClientRects().length > 0
      ? typePanel.getBoundingClientRect()
      : null
    const typeSummaryPanelRect = typeSummaryPanel?.getClientRects().length > 0
      ? typeSummaryPanel.getBoundingClientRect()
      : null
    const itemTablePanelRect = itemTablePanel?.getClientRects().length > 0
      ? itemTablePanel.getBoundingClientRect()
      : null
    /*
     * 类型卡片的桌面布局必须通过稳定测试边界量取，不能依赖 Tailwind 类名或
     * 文案定位。移动端继续由 Drawer 和 44px 触控审计负责，因此明确返回 null。
     */
    const typeCardGeometry = !mobile
      && visibleTypeCard?.getClientRects().length > 0
      && typeCardIdentity?.getClientRects().length > 0
      && typeCardMeta?.getClientRects().length > 0
      ? (() => {
          const cardRect = visibleTypeCard.getBoundingClientRect()
          const identityRect = typeCardIdentity.getBoundingClientRect()
          const metaRect = typeCardMeta.getBoundingClientRect()
          const horizontallyOverlaps = Math.min(identityRect.right, metaRect.right)
            - Math.max(identityRect.left, metaRect.left) > 1
          const verticallyOverlaps = Math.min(identityRect.bottom, metaRect.bottom)
            - Math.max(identityRect.top, metaRect.top) > 1
          return {
            cardRight: cardRect.right,
            horizontalGap: metaRect.left - identityRect.right,
            identityRight: identityRect.right,
            metaLeft: metaRect.left,
            metaRight: metaRect.right,
            overlaps: horizontallyOverlaps && verticallyOverlaps,
            rightInset: cardRect.right - metaRect.right,
          }
        })()
      : null
    let leftPanelHeightIsolated = null
    let leftPanelRightStackHeightDelta = null
    let leftPanelScrolls = null
    let leftPanelWorkspaceHeightDelta = null
    /*
     * 桌面端同步注入超高内容，直接验证左侧面板的固有高度不会参与 Grid
     * 行高计算。Probe 必须在同一次 evaluate 内完成测量和清理，避免污染后续
     * 交互；移动端左面板隐藏，因此不执行这组桌面专属断言。
     */
    if (
      !mobile
      && workspaceRect
      && typeSummaryPanelRect
      && itemTablePanelRect
      && typePanelScroll?.getClientRects().length > 0
    ) {
      const workspaceHeightBefore = workspaceRect.height
      const rightStackHeightBefore
        = itemTablePanelRect.bottom - typeSummaryPanelRect.top
      const heightProbe = document.createElement('div')
      heightProbe.setAttribute('aria-hidden', 'true')
      heightProbe.style.cssText
        = 'height:2000px;min-height:2000px;width:1px;pointer-events:none;'
      typePanelScroll.append(heightProbe)

      const workspaceHeightAfter = workspace.getBoundingClientRect().height
      const typeSummaryPanelRectAfter
        = typeSummaryPanel.getBoundingClientRect()
      const itemTablePanelRectAfter = itemTablePanel.getBoundingClientRect()
      const rightStackHeightAfter
        = itemTablePanelRectAfter.bottom - typeSummaryPanelRectAfter.top
      leftPanelWorkspaceHeightDelta = Math.abs(
        workspaceHeightAfter - workspaceHeightBefore,
      )
      leftPanelRightStackHeightDelta = Math.abs(
        rightStackHeightAfter - rightStackHeightBefore,
      )
      leftPanelHeightIsolated = leftPanelWorkspaceHeightDelta <= 1
        && leftPanelRightStackHeightDelta <= 1
      leftPanelScrolls
        = typePanelScroll.scrollHeight > typePanelScroll.clientHeight
      heightProbe.remove()
    }
    const horizontalPanelGap = typePanelRect && typeSummaryPanelRect
      ? typeSummaryPanelRect.left - typePanelRect.right
      : null
    const verticalPanelGap = typeSummaryPanelRect && itemTablePanelRect
      ? itemTablePanelRect.top - typeSummaryPanelRect.bottom
      : null
    const rightPanelsAligned = !!(
      typeSummaryPanelRect
      && itemTablePanelRect
      && Math.abs(typeSummaryPanelRect.left - itemTablePanelRect.left) <= 1
      && Math.abs(typeSummaryPanelRect.right - itemTablePanelRect.right) <= 1
    )
    const panelsFitWorkspace = !!workspaceRect && visiblePanels.every((panel) => {
      const rect = panel.getBoundingClientRect()
      return rect.left >= workspaceRect.left - 1
        && rect.right <= workspaceRect.right + 1
        && rect.top >= workspaceRect.top - 1
        && rect.bottom <= workspaceRect.bottom + 1
    })
    return {
      bodyWidth: document.body.scrollWidth,
      cards: cards.length,
      desktopTables: desktopTables.length,
      documentFits: document.documentElement.scrollWidth <= viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      horizontalPanelGap,
      leftPanelHeightIsolated,
      leftPanelRightStackHeightDelta,
      leftPanelScrolls,
      leftPanelWorkspaceHeightDelta,
      modeMatches: mobile
        ? viewportWidth === 390
          && typePanel?.getClientRects().length === 0
          && typeDrawerTrigger?.getClientRects().length > 0
        : viewportWidth >= 768
          && typePanel?.getClientRects().length > 0
          && typeDrawerTrigger?.getClientRects().length === 0,
      touchTargetViolations: mobile
        ? touchTargets.filter(target => !target.pass)
        : [],
      panelsFitWorkspace,
      rightPanelsAligned,
      typeCardGeometry,
      typePanelWidth,
      verticalPanelGap,
      visiblePanelCount: visiblePanels.length,
      viewportWidth,
      workspaceMounted: workspace?.getClientRects().length > 0,
    }
  })()`
}

/**
 * 在已经打开的移动端类型 Drawer 内同步注入极端文案，验证卡片的真实收缩与
 * 换行能力。探针只暂时替换文本，所有 DOM 内容都会在同一次 evaluate 中恢复。
 */
export function dictionaryTypeCardStressAuditExpression() {
  return `(() => {
    const visibleTypeCard = [...document.querySelectorAll(
      '[data-testid="dictionary-type-card"]',
    )].find(element => element.getClientRects().length > 0)
    const identity = visibleTypeCard?.querySelector(
      '[data-testid="dictionary-type-card-identity"]',
    )
    const meta = visibleTypeCard?.querySelector(
      '[data-testid="dictionary-type-card-meta"]',
    )
    const count = visibleTypeCard?.querySelector(
      '[data-testid="dictionary-type-item-count"]',
    )
    const name = identity?.querySelector('.qs-type-compact-title')
    const code = identity?.querySelector('code')
    const drawer = visibleTypeCard?.closest('[role="dialog"]')
    if (!visibleTypeCard || !identity || !meta || !count || !name || !code || !drawer) {
      throw new Error('Dictionary mobile type card stress target unavailable')
    }

    const originalName = name.textContent
    const originalCode = code.textContent
    const originalCount = count.textContent
    try {
      name.textContent = '移动端超长字典类型名称'.repeat(8)
      code.textContent = 'mobile.extremely_long_dictionary_code_segment_'.repeat(6)
      count.textContent = '123'

      const cardRect = visibleTypeCard.getBoundingClientRect()
      const identityRect = identity.getBoundingClientRect()
      const metaRect = meta.getBoundingClientRect()
      const drawerRect = drawer.getBoundingClientRect()
      const horizontalOverlap = Math.min(identityRect.right, metaRect.right)
        - Math.max(identityRect.left, metaRect.left) > 1
      const verticalOverlap = Math.min(identityRect.bottom, metaRect.bottom)
        - Math.max(identityRect.top, metaRect.top) > 1
      return {
        cardContentFits: visibleTypeCard.scrollWidth <= visibleTypeCard.clientWidth + 1,
        cardFitsDrawer: cardRect.left >= drawerRect.left - 1
          && cardRect.right <= drawerRect.right + 1,
        countFits: count.scrollWidth <= count.clientWidth + 1,
        countText: count.textContent,
        documentFits: document.documentElement.scrollWidth
          <= document.documentElement.clientWidth,
        horizontalGap: metaRect.left - identityRect.right,
        identityContentFits: identity.scrollWidth <= identity.clientWidth + 1,
        metaFitsCard: metaRect.right <= cardRect.right - 10,
        overlaps: horizontalOverlap && verticalOverlap,
      }
    }
    finally {
      name.textContent = originalName
      code.textContent = originalCode
      count.textContent = originalCount
    }
  })()`
}

/**
 * Requirement 12 的 Browser 边界是 console error 与未捕获异常。warning 单独留给
 * 日常诊断，不把既有 intlify warning 升级为交付失败；任何写入数组的文本先遮罩。
 */
export function collectDictionaryRuntimeErrors(
  page,
  { sensitiveValues = [] } = {},
) {
  const issues = []
  let enabled = false
  const secrets = [...new Set(sensitiveValues)]
    .filter(value => typeof value === 'string' && value.length > 0)
    .sort((left, right) => right.length - left.length)
  const redact = (value) => {
    let redacted = String(value)
    for (const secret of secrets) {
      redacted = redacted.replaceAll(secret, '[REDACTED]')
    }
    return redacted.replaceAll(/\s+/gu, ' ').slice(0, 360)
  }
  const removeConsole = page.on('Runtime.consoleAPICalled', (event) => {
    if (!enabled || event.type !== 'error') {
      return
    }
    const detail = (event.args ?? [])
      .map(argument => (
        typeof argument.value === 'string'
          ? argument.value
          : typeof argument.description === 'string'
            ? argument.description
            : ''
      ))
      .filter(Boolean)
      .join(' ')
    const redacted = redact(detail)
    issues.push(`console:error${redacted ? `:${redacted}` : ''}`)
  })
  const removeException = page.on('Runtime.exceptionThrown', (event) => {
    if (!enabled) {
      return
    }
    const detail = event.exceptionDetails?.exception?.description
      ?? event.exceptionDetails?.text
      ?? ''
    const redacted = redact(detail)
    issues.push(`exception${redacted ? `:${redacted}` : ''}`)
  })
  return {
    issues,
    start() {
      enabled = true
    },
    stop() {
      enabled = false
      removeConsole()
      removeException()
    },
  }
}

/** 真实路由、权限工作区与首轮 Type 请求必须完成后才允许进入 Browser 断言。 */
export async function waitForDictionaryWorkspace(page) {
  await page.waitFor(`(() => (
    location.hash === '#/system/basic-data/dictionaries'
    && document.querySelector(
      '[data-testid="dictionary-management-workspace"]',
    )?.getClientRects().length > 0
    && !document.querySelector(
      '[data-testid="dictionary-type-panel"] [aria-busy="true"]',
    )
  ))()`)
}
