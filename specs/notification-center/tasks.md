# 通知中心与千树小助理任务拆分

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档状态 | 实施计划，待授权开工 |
| 关联文档 | [落地设计](./design.md)、[接口契约](./api.md)、[数据模型](./data-model.md)、[事件规格](./events.md) |
| 适用范围 | 阶段 1（3 个事件、管理员绑定、群 + 1:1、无回调） |
| 最后更新 | 2026-10-28 |

## 1. 开工前置

| 前置 | 状态 | 说明 |
| --- | --- | --- |
| 设计、契约、数据模型、事件规格 | 完成 | 本文档目录 |
| 数据库 schema 授权 | **待批** | 10 张表；`notification_inbox_items` 与 `assistant_callback_events` 延后 |
| 15 个权限码授权 | **待批** | `system_only`，授予 `system_admin` |
| 公共 API 范围授权 | **待批** | `/api/notifications/*` 与 `/api/assistant/*` 首批接口 |
| GeWe 公司号与 Token | 已准备 | Token 只进环境变量/密钥服务 |
| 测试群与测试员工 | 已准备 | 群需保存到通讯录；员工需已加公司号为好友 |
| 事件触发口径 | 已核对代码位置 | 文案、变量、TTL 待业务确认 |

没有前三项授权，只能做任务 A（纯逻辑），不能写迁移、权限、接口。

## 2. 任务批次

### 任务 A：纯逻辑与 Transport（无 schema）

**范围**

- 模板渲染与变量校验：`{{variable}}` 占位、白名单、长度截断、敏感字段替换。
- 收件人解析：`USERS`、`ROLE`、`PERMISSION` 到用户集合；去重、停用过滤。
- 渠道策略解析：事件 × 渠道的 `targetMode`、TTL、优先级、静默时段。
- 错误分类：超时、网络、5xx、离线、限流、拒绝、未知。
- 回调归一化：v1/v2 判别与字段映射（阶段 1 不接路由）。
- `AssistantTransport` 接口、`GeweAssistantTransport`、`FakeAssistantTransport`。
- 出站 URL 校验：HTTPS、host 白名单、拒绝私网/回环/保留地址、禁止重定向。

**验收**

- 全部为纯函数或可注入依赖的 service，不需要数据库。
- 单元测试覆盖分支与边界；`pnpm -C server test` 通过。
- 测试不访问网络；`FakeAssistantTransport` 记录调用参数。
- 代码中不存在 Token 字面量；Token 只从配置读取。

### 任务 B：Schema、权限、审计（需授权）

**范围**

- 按 `data-model.md` 新增 Prisma 模型与迁移。
- CHECK、部分唯一索引、普通索引写在迁移 SQL。
- 15 个权限码、`role_permissions` 授予、`permission.constants.ts` 同步。
- `AuditEventType` 新增 15 个值。
- 种子：`notification_settings`、`notification_channel_settings`（仅 `ASSISTANT`）、`assistant_dispatch_leases`。
- `notification-schema.spec.ts` 断言表、索引、约束、权限与枚举。

**验收**

- `pnpm -C server exec prisma validate` 通过。
- `pnpm -C server test` 通过，含权限一致性与 schema 断言。
- 隔离 schema 重放全部迁移成功。
- 未创建 `notification_inbox_items` 与 `assistant_callback_events`。
- 迁移是纯新增，没有修改既有业务表。

### 任务 C：发布服务与入队（依赖 B）

**范围**

- `SystemNotificationService.publish(command, options)`。
- 事件策略解析、收件人快照、模板渲染、幂等键、通知与交付写入。
- 通知状态汇总：`PENDING`、`COMPLETED`、`PARTIAL`、`FAILED`、`SKIPPED`、`EXPIRED`、`CANCELLED`。
- 站外交付的 `SKIPPED`：未绑定、用户停用、群禁用、渠道关闭。
- 业务事务参数：传入时同事务写入；不传时自开事务。

**验收**

- 业务回滚时，通知与交付都不落库。
- 模板缺失/变量缺失时，业务提交成功，通知落 `FAILED`。
- 同一 `dedupeKey` 重复发布只产生一条通知。
- 站外全部失败时，通知状态不是 `COMPLETED`。
- 单测与集成测试通过。

### 任务 D：派发器（依赖 C）

**范围**

- `AssistantDispatchService` 进程内循环：5 秒轮询、批量 20、串行发送。
- `assistant_dispatch_leases` 获取/续租/释放；续租失败停止领取。
- 限速：40 条/分钟、单收件人 ≥1 秒、群消息 2~5 秒抖动。
- 重试：5s/30s/2m；离线 30s/2m/5m；4xx 不重试；TTL 兜底。
- 静默时段：`NORMAL` 延后，`HIGH` 突破。
- 过期扫描与状态汇总。
- 失败码落库与结构化日志。

**验收**

- 测试环境禁用 worker；集成测试可手动触发一轮。
- 同一时刻只有一个租约持有者；模拟双实例不会重复发送。
- 失败分类覆盖超时、5xx、503 离线、4xx、未知。
- 过期通知不再发送，状态落 `EXPIRED`。
- `pnpm -C server test:e2e` 通过。

### 任务 E：管理端 API（依赖 B、C）

**范围**

- 渠道配置与测试发送。
- 公司号 CRUD、二维码登录、登录状态轮询、重连、退出、个人二维码。
- 公司号好友列表、管理员创建绑定、测试消息验证、解绑、好友巡检。
- 群目标同步、命名、`internalOnly`、启停。
- 模板 CRUD、预览、测试发送。
- 事件 × 渠道策略 CRUD。
- 逻辑通知列表/详情/取消；单条站外交付重试。
- 权限、审计、OpenAPI 契约同步。

**验收**

- 每个写操作都有 `@RequirePermissions` 与审计。
- 管理端响应不返回 Token、绑定码或完整 `wxid`。
- 未验证绑定不能接收敏感 1:1；非 `internalOnly` 群不能绑定敏感策略。
- `pnpm contract:sync` 后 `pnpm contract:check` 通过。
- Controller 单测覆盖权限与错误码。

### 任务 F：管理端页面（依赖 E）

**范围**

- 路由 `/system/notifications`，`qs-notification` 品牌图标。
- 页签：概览、千树小助理（渠道/账号/管理员绑定/群目标）、通知规则（模板/策略）、发送记录。
- 二维码登录弹窗、绑定创建/验证、模板编辑、策略编辑、通知详情抽屉。
- 权限控制、移动端 768 断点、错误与空态。
- 测试：路由断言、API 模块断言、页面源码契约、逻辑纯函数。

**验收**

- 无权限用户看不到对应页签与按钮。
- 管理员可以完成「绑定 → 测试消息 → 验证」全流程。
- 发送记录能按接收人、事件、状态筛选，并看到失败原因。
- 窄屏表格切卡片，操作收进底部抽屉。
- `pnpm -C web test:api` 与 `pnpm -C web check` 通过。

### 任务 G：业务事件接线（依赖 C、D，建议先群后 1:1）

**范围**

- 先接 `SLH_RECONCILIATION_COMPLETED` 与 `SHIPMENT_ARRIVED`，验证群通道。
- 再接 `PURCHASE_REVIEW_PENDING`，验证管理员绑定后的 1:1。
- 模板文案按 `events.md` 落库或种子。
- 变量准备：单号、金额、客户名称、货件号、到仓时间。
- 发布位置与事务边界按 `events.md`。

**验收**

- 每个事件只在预期状态变更后触发一次。
- 业务回滚时通知不落库；模板缺失不阻断业务。
- 未绑定审核人落 `NOT_BOUND`；非 `internalOnly` 群被拒绝。
- 金额与客户名称只在 `allowSensitive = true` 时出现。
- 事件级集成测试通过。

### 任务 H：测试环境联调与试运行（依赖 F、G）

**范围**

- 真实 GeWe 账号：登录、`checkOnline`、发送到测试群、发送到测试员工。
- 限速、离线、TTL、停发、失败重试。
- 管理端页面全流程。
- 监控与告警验证。
- 运维手册与部署清单演练。

**验收**

- 测试群收到群通知；测试员工收到 1:1 通知。
- 停发开关立即生效；恢复后继续派发。
- 账号离线 60 秒内被发现；重新扫码后恢复。
- 队列积压、失败率、离线告警按预期触发。
- 部署清单可被另一人按步骤复现。

## 3. 测试矩阵

| 层级 | 覆盖 | 命令 |
| --- | --- | --- |
| 单元 | 模板、收件人、策略、状态、错误分类、回调归一化、绑定校验 | `pnpm -C server test` |
| 集成 | 事务发布、幂等、模板缺失、离线重试、TTL、停发、渠道独立失败、租约 | `pnpm -C server test:e2e` |
| 契约 | 管理端接口 OpenAPI 与前端类型 | `pnpm contract:sync && pnpm contract:check` |
| 前端 API | API 方法、路径、参数、错误呈现 | `pnpm -C web test:api` |
| 页面契约 | 路由、权限、组件使用、移动端 | `pnpm -C web test:api` |
| 浏览器（可选） | 页签权限、二维码弹窗、绑定流程 | 现有浏览器测试入口 |

硬性要求：

- 测试不访问真实 GeWe；全部使用 `FakeAssistantTransport`。
- 测试不写入可用 Token；只使用明显的假值或空配置。
- E2E 使用隔离 schema，不触碰 dev 数据。
- 日志、错误响应、OpenAPI 快照中不得出现 Token 字面量。

## 4. 每批 Definition of Done

1. 代码、测试、文档同步；新增公开行为有对应文档。
2. `pnpm -C server check` 或 `pnpm -C web check` 通过。
3. 涉及契约时 `pnpm contract:sync` 后 `pnpm contract:check` 通过。
4. 没有硬编码凭据、Token、真实 `wxid`、真实客户名称。
5. 新增权限码、审计事件同时更新常量、迁移与测试。
6. 失败与未验证项在提交说明中如实列出。

## 5. 风险与应对

| 风险 | 应对 |
| --- | --- |
| 迁移一次太大 | 拆成「枚举/表/索引」「权限」「审计」三个迁移，逐个隔离重放 |
| 事务发布拖慢业务 | `publish` 只做数据库写入；模板缺失不抛异常；不在事务内发 HTTP |
| Worker 与 API 共享进程 | 测试环境禁用；租约续期；优雅退出；监控租约空窗 |
| 真实账号不可控 | 测试群/测试员工隔离；限速；不压测真实员工 |
| 敏感内容外泄 | 只允许 3 个事件、只发已验证绑定与 `internalOnly` 群；日志脱敏 |
| 管理员绑错人 | 备注名/头像核对 + 测试消息确认 + `verifiedAt` + 审计 |
| 契约与前端类型漂移 | 只跑 `contract:sync`，不手改生成文件 |
| 事件接错位置 | 按 `events.md` 的 service/方法/事务边界接线；加事务回滚测试 |

## 6. 明确不做

- 员工自助绑定、绑定码、员工侧绑定入口。
- 回调路由、CSRF 例外、回调记录（阶段 1）。
- 站内通知中心页面、收件箱、铃铛、已读/归档（阶段 3）。
- 图片/文件/语音/视频、群内 `@`、微信内回复指令。
- 多公司号选号与故障转移（阶段 4）。
- 推送回执、送达率、已读状态。
