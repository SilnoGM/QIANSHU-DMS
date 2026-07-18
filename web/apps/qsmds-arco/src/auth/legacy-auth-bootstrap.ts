import { cleanupLegacyAuthStorageBeforeApp } from './legacy-auth-cleanup'

// 必须在 Pinia、Account Store 和全局 Storage proxy 的模块求值之前执行。
cleanupLegacyAuthStorageBeforeApp()
