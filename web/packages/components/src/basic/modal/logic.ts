export type ModalCloseAction = 'cancel' | 'close' | 'confirm'

export type ModalBeforeClose = (
  action: ModalCloseAction,
  done: () => void,
) => void | Promise<void>

/**
 * 统一执行 FaModal 的关闭守卫。
 *
 * `beforeClose` 保留现有 done-callback 契约，因此同步确认、延迟调用 done 和
 * Promise 守卫都可以继续工作。守卫抛错或拒绝 Promise 时默认保持弹窗打开，
 * 避免异常继续冒泡成未处理 Promise；同一次守卫即使重复调用 done 也只生效一次。
 */
export async function runModalBeforeClose(
  beforeClose: ModalBeforeClose | undefined,
  action: ModalCloseAction,
  onApproved: () => void,
): Promise<void> {
  let approved = false
  const done = () => {
    if (approved) {
      return
    }
    approved = true
    onApproved()
  }

  if (!beforeClose) {
    done()
    return
  }

  try {
    await beforeClose(action, done)
  }
  catch {
    // 关闭守卫失败时保持当前弹窗状态；业务错误文案仍由调用方在守卫内部处理。
  }
}
