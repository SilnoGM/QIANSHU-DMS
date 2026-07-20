/**
 * 组件库是公开的构建期能力开关，不得承载 token、密码或其他敏感配置。
 * 此声明独立于 env-parse 自动生成文件，避免开发服务器刷新类型时丢失可选开关。
 */
interface ImportMetaEnv {
  readonly VITE_ENABLE_COMPONENT_LIBRARY?: boolean
}
