/**
 * 同一页面可能同时挂载独立配置页与全局弹窗。
 * 使用共享会话集合，避免任一实例关闭时提前恢复用户偏好持久化。
 */
export const activeSettingsPanels = new Set<symbol>()
