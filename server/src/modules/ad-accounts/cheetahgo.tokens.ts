/**
 * 依赖注入令牌。单独成文件，避免 module 与 service 相互 import 形成循环。
 *
 * 凭据缺失时为 null：同步任务跳过并如实上报，不阻断服务启动。
 */
export const CHEETAHGO_CLIENT = Symbol('CHEETAHGO_CLIENT')
