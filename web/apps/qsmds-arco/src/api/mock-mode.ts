/**
 * mock 数据是否可用。
 *
 * 应用外壳的若干服务端接口（通知、收藏夹、标签栏、偏好设置）当前只有 mock 实现，
 * 由 `vite-plugin-fake-server` 在开发服务器或 `VITE_BUILD_FAKE=true` 的构建里提供。
 *
 * 关闭时 `api/modules/app.ts` 的请求会落到真实 API；这是硬要求——生产站点只代理 `/api/`，
 * 指向 `/fake/*` 的请求会被静态站点按 404（HTML）处理，前端只能报「服务器返回了无法识别的错误响应」。
 *
 * 两点实现约束：
 * 1. 变量必须写成 `import.meta.env` 的成员访问：Vite 与 vite-plugin-env-parse 只替换这种字面量表达式，
 *    包一层函数或解构后就拿不到构建期注入的值；
 * 2. 赋值本身不能直接取属性：`settings.ts` 会被 web/scripts 下的 node 测试导入，那里 `import.meta.env`
 *    是 undefined，直接读 `.DEV` 会抛错（可选链读到 undefined 才是安全的）。
 */
const viteEnv: ImportMetaEnv | undefined = import.meta.env

export const isMockDataEnabled
  = viteEnv?.DEV === true || String(viteEnv?.VITE_BUILD_FAKE) === 'true'
