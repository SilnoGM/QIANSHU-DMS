# 编号用途分类验收记录

日期：2026-09-06。范围仅为编号用途分类及新增页面；不改编号引擎，不接入采购自动唛头。

## 实现结果

- `NumberingRule.purpose` 非空、无隐式默认，允许 `BUSINESS / SHIPPING_MARK`，创建后不可修改。
- 历史规则通过新迁移回填为 `BUSINESS`；复制从服务端继承用途，不接受前端覆盖。
- 列表按用途过滤，`purposeCounts` 对当前关键词和状态跨页聚合，固定返回三项。
- 列表加入三视图工具条、可信计数及 `minWidth: 120px` 的用途分类列，移动端也展示分类。
- 新增入口为双卡片选择弹窗，再进入独立新增页面；编辑、复制、详情仍保留抽屉。
- 受控表单共用字段、片段编辑、本地校验和 Server 预览；独立页面负责路由离开保护。
- 路由关闭/替换失败时保留页签，返回 NavigationFailure；冲突重读详情只隐藏编辑表单，不卸载其 dirty 基线。
- 新增页右侧统计使用两列，避免在窄预览面板沿用视口断点挤成四列；编辑抽屉布局不变。

## TDD 与回归发现

1. 先运行现有编号测试基线，3 组 53 个测试通过；新增用途测试先出现 4 个目标缺失失败，再实现用途与统计。
2. 新增页签关闭测试先证明取消导航仍移除页签且吞掉失败结果，修复后通过。
3. 首轮浏览器回归发现编辑冲突恢复后按钮不能再次保存。新增测试固定表单不卸载约束，修复后浏览器再次保存通过。
4. 更新既有 DTO、路由清单及测试夹具以适配明确用途；没有放宽非法输入或改写旧迁移。
5. 过程中如实出现并修正：Jest 参数拼写、直接 vue-tsc 调用的弃用选项、测试变量/字段名、抽取后的源码断言、ESLint 自动替换 Node test 导入及 Buffer 导入规范。根测试发现迁移手册漏登记新迁移，补齐后重跑通过；截图等待持续动画导致的超时已收窄为当前可见页面淡入/预览完成。最终结果以下方最新验证为准。

## 验证记录

| 命令 / 场景 | 结果 |
| --- | --- |
| `pnpm -C server check` | 通过：schema、类型、lint，257 组 / 2636 个单元测试 |
| `node --run contract:sync` | 通过：双端 OpenAPI 由 Server 生成，Web 类型通过生成器更新 |
| `node --run contract:check` | 通过：当前 Server 契约、双端快照和生成类型一致 |
| 隔离 PostgreSQL 编号 E2E | 通过：4 组 / 14 个测试，覆盖历史回填、不可变保护、API 与原派发器 |
| `pnpm -C web check` | 通过：172 个 Node 脚本测试、49 个 TS 脚本测试、1128 个 API/视图测试，以及类型、ESLint 和 Stylelint |
| `node --run test:root` | 通过：687 个根编排与治理测试 |
| `node --run ci:browser-numbering-e2e` | 最新完整运行通过：2 组真实 Chrome 场景，含 URL 守卫、稳定截图及预览两列显示 |
| 编号定向 Web 测试 | 最新通过：52 个测试 |
| 预览显示调整后的 Stylelint / ESLint | 通过 |
| `git diff --check` / `git diff --cached --check` | 均通过；暂存范围无文件删除、环境文件或构建产物 |

隔离编号 E2E 精确命令：

```sh
node scripts/ci-postgres.mjs -- /bin/sh -c 'pnpm -C server exec jest --silent --config test/jest-e2e.json --runInBand numbering-purpose-migration numbering-management-api numbering-generator numbering-schema'
```

迁移验证在临时 PostgreSQL 中先写入历史规则、版本、周期状态及 `LEGACY/0073` 派发记录，再应用新迁移；核对除用途外的历史数据不变，并证明缺失、非法、修改用途均被拒绝。

浏览器验收使用根隔离编排器建立的测试库、动态端口 Server/Web 和专用测试身份；不复用业务开发服务。覆盖两种用途创建为 DRAFT、分类计数、编辑/复制、精确大整数、过期预览响应、冲突恢复、未知响应恢复、权限组合与撤权、非法用途 URL、用途变更确认与输入重置、桌面及 390px 暗色页面。截图等待淡入结束后人工核对；截图保留在本机临时目录，不进入 Git。

构建存在上游 VueUse PURE 注释、chunk 体积及插件耗时提示，不是本次新增错误，也未为消除提示改变依赖或打包配置。

## 部署边界

- 新迁移：`server/prisma/migrations/20260906090000_numbering_rule_purpose/migration.sql`。
- **未应用到业务数据库**；未重启业务前后端；未推送或发布。
- 新字段为必填契约，需要 migration 与前后端成套上线，不能把本地验证通过等同于业务环境已经启用。
- 本次只进行经确认的本地提交，不提交环境文件、截图、构建结果、生成目录或日志。
