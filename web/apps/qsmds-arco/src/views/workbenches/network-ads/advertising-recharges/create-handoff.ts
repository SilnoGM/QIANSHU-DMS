/**
 * 「猎豹广告户 → 广告充值」的一次性交接。
 *
 * 不能用路由 query 传递：布局的 RouterView 按 `route.fullPath` 做 key
 * （见 layouts/index.vue），清 query 会触发整页重建，刚打开的弹窗状态会丢。
 * 也不能不清：清不掉就会在刷新/回退时重复弹窗。
 * 因此用模块级变量做一次「取出即清空」的交接，URL 保持干净。
 */
let pendingPaste: string | null = null

export function setPendingRechargePaste(text: string): void {
  pendingPaste = text
}

export function takePendingRechargePaste(): string | null {
  const value = pendingPaste
  pendingPaste = null
  return value
}
