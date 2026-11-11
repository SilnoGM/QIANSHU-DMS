# 通知中心与千树小助理接口契约

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档状态 | 设计稿，待评审；未实施 |
| 方案定位 | 通知中心（系统通知）的统一接口；千树小助理是其中的微信出站渠道 |
| 关联文档 | [文档索引](./README.md)、[落地设计](./design.md)、[数据模型](./data-model.md)、[事件规格](./events.md)、[GeWeAPI 评估](../../docs/技术评估/GeWeAPI微信通知接入评估.md) |
| 最后更新 | 2026-10-28 |
| 关键决策 | 阶段 1 不接回调；首批 3 个事件；管理员绑定；进程内循环 + 数据库租约；站内 30 秒轮询 |
| 适用范围 | `server/src/modules/notifications`、`web/apps/qsmds-arco/src/api/modules/notifications.ts` |

本文中的 TypeScript 片段是契约示意，不是最终代码；表结构、权限与迁移以评审通过的实施方案为准。

## 1. 通用约定

- 所有 HTTP 接口挂在全局前缀 `/api` 下，不在路径中重复 `api`。
- 管理端接口使用 Cookie Session 鉴权，写操作必须携带 `X-Qianshu-CSRF: 1`，并按权限码校验。
- 错误响应统一为 `ApiError`：`{ code, message, fieldErrors?, requestId }`，`code` 为大写蛇形。
- 列表查询参数统一为 `query`、`page`（默认 1）、`pageSize`（默认 20，最大 100）。
- 列表响应统一为 `{ items, page, pageSize, total }`。
- 时间字段使用 ISO 8601 UTC 字符串；页面按 `Asia/Shanghai` 展示。
- 资源 ID 使用 UUID。
- 渠道代码固定为两个：`IN_APP`（站内通知）、`ASSISTANT`（千树小助理）。
- 管理端接口进入 OpenAPI 并参与 `contract:sync`；机器回调与可选内部接口不进入 OpenAPI 快照。

## 2. 业务侧统一接口（主入口）

### 2.1 形态

业务模块通过同进程依赖注入调用 `SystemNotificationService.publish()`，不通过 HTTP 调用本系统自身，也不直接调用 GeWe。

```ts
@Injectable()
export class SystemNotificationService {
  publish(
    command: SystemNotificationPublishCommand,
    options?: SystemNotificationPublishOptions,
  ): Promise<SystemNotificationPublishResult>
}
```

选择服务接口而不是 HTTP 的理由：

- 可以与业务变更共用同一个数据库事务，保证「业务成功则通知不丢」。
- 业务模块不接触渠道细节：不知道 `IN_APP` 的收件箱结构，也不知道 `ASSISTANT` 的 `appId`、`wxid`、`chatroomId`、Token 与限速。
- 将来新增渠道时，业务调用方不需要修改。

### 2.2 命令模型

```ts
export const NOTIFICATION_EVENT_TYPES = [
  'PURCHASE_REVIEW_PENDING',
  'FUND_WITHDRAWAL_REVIEW_PENDING',
  'INVOICE_REQUEST_REVIEW_PENDING',
  'PACKAGING_COST_PAYMENT_PENDING',
  'PURCHASE_PAYABLE_PENDING',
  'SLH_RECONCILIATION_COMPLETED',
  'SHIPMENT_ARRIVED',
] as const

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number]

export type NotificationChannel = 'IN_APP' | 'ASSISTANT'

export type NotificationPriority = 'NORMAL' | 'HIGH'

/** 命令只回答“谁应该知道”，不包含渠道目标（群） */
export type NotificationTarget =
  | { kind: 'USERS'; userIds: string[] }
  | { kind: 'ROLE'; roleCodes: string[] }
  | { kind: 'PERMISSION'; permissionCode: string }

export interface SystemNotificationPublishCommand {
  eventType: NotificationEventType
  source: { type: string; id: string }
  target: NotificationTarget
  /** 逻辑模板键；每个渠道各有一份渲染模板 */
  templateKey: string
  variables: Record<string, string | number | null>
  /** 同一事件重复触发时的幂等键；省略时按 eventType + source 生成 */
  dedupeKey?: string
  priority?: NotificationPriority
  /** 只约束站外投递；站内收件箱不因过期删除 */
  expiresAt?: string
  /** 省略时取事件在该事件上的全部启用渠道 */
  channels?: NotificationChannel[]
  requestedByUserId?: string
}

export interface SystemNotificationPublishOptions {
  /** 传入业务事务时，通知与业务变更同事务提交 */
  transaction?: Prisma.TransactionClient
  now?: Date
}

export interface SystemNotificationPublishResult {
  notificationId: string
  duplicated: boolean
  channels: Array<{
    channel: NotificationChannel
    status: 'CREATED' | 'PENDING' | 'SKIPPED'
    recipientCount: number
    skippedCount: number
    skipReason?: NotificationSkipReason
  }>
  warnings: Array<{ code: string; message: string }>
}
```

约束：

- `source.type` 使用大写蛇形业务对象名，例如 `PURCHASE_ORDER`、`SLH_RECONCILIATION_BATCH`。
- `variables` 只允许一层字符串、数字或 `null`；key 最多 20 个，单值最长 200 字符；`null` 渲染为空字符串。
- 阶段 1 的 3 个事件允许金额与客户名称；1:1 只发给已验证绑定，群必须 `internal_only`。
- `dedupeKey` 最长 200 字符，只允许 `A-Z a-z 0-9 : _ -`，不得包含姓名、手机号等个人信息。
- `expiresAt` 必须晚于当前时间；已过期时站外投递直接落 `EXPIRED`，站内收件箱仍然创建。

### 2.3 语义保证

1. **幂等**：同一 `eventType + dedupeKey` 只创建一条通知。重复调用返回原通知，`duplicated: true`，不新增站内条目或站外交付。
2. **事务**：传入 `transaction` 时，通知主记录、站内收件箱条目、站外交付记录都在业务事务内写入；不传时由服务自己开事务。通知表写入失败会连同业务一起回滚，这是为了不出现「业务成功、通知记录丢失」。
3. **不阻断业务**：事件未配置、模板缺失、变量缺失、收件人为空、渠道关闭等情况**不抛异常**，只把对应渠道落为 `FAILED` / `SKIPPED` 并在 `warnings` 返回；只有数据库错误会向上抛出。
4. **渠道独立**：站内条目创建成功、站外投递失败时，通知整体是 `PARTIAL`，不会因为微信失败而撤销站内消息；反之亦然。
5. **异步站外**：`publish()` 不调用 GeWe，只落站外交付记录；由 worker 异步发送。`PENDING` 只代表已入队。
6. **快照**：收件人、模板版本与渲染后的内容在发布时确定，之后模板或角色变化不影响已入队通知。
7. **站内永久**：站内收件箱条目不受 `expiresAt` 影响；过期只作用于站外推送。

### 2.4 渠道选择与目标

`channels` 省略时，取该事件在 `notification_channel_policies` 中所有 `enabled = true` 的渠道。显式传入时取交集；没有配置的渠道返回 warning `CHANNEL_NOT_CONFIGURED`。

每个渠道的目标由 `notification_channel_policies.target_mode` 决定：

| target_mode | 适用渠道 | 含义 |
| --- | --- | --- |
| `COMMAND_TARGET` | 两者 | 使用命令里的 `target` 解析出的用户；默认值 |
| `USERS` | 两者 | 用策略里固定的 `userIds` 覆盖命令目标 |
| `ROLE` | 两者 | 用策略里的 `roleCodes` 覆盖命令目标 |
| `PERMISSION` | 两者 | 用策略里的 `permissionCode` 覆盖命令目标 |
| `GROUP` | 仅 `ASSISTANT` | 发到已登记的群目标，忽略个人收件人；`IN_APP` 出现该值视为策略非法 |

当渠道策略 `allow_sensitive = true` 且 `target_mode = GROUP` 时，只能选择 `internal_only = true` 的群；`COMMAND_TARGET` 的 1:1 只发给 `verified_at` 非空的绑定。

这条规则把「谁应该知道」和「发到哪里」分开：业务模块只知道人，群路由属于千树小助理的渠道配置。渠道策略查询响应包含 `updatedAt`，供管理端展示最近更新时间。

### 2.5 收件人解析

| `target.kind` | 解析方式 | 说明 |
| --- | --- | --- |
| `USERS` | 按 `userIds` 取启用用户 | 停用用户落 `SKIPPED`，原因 `USER_DISABLED` |
| `ROLE` | 取拥有任一 `roleCodes` 的启用用户 | 结果去重 |
| `PERMISSION` | 取角色权限并集包含该权限码的启用用户 | 与 `PermissionGuard` 判定口径一致 |

解析结果按渠道分别落地：`IN_APP` 为每个用户创建收件箱条目；`ASSISTANT` 为每个用户创建 1:1 交付，或按策略发到群目标。

### 2.6 调用示例

```json
{
  "eventType": "PURCHASE_REVIEW_PENDING",
  "source": { "type": "PURCHASE_ORDER", "id": "6f0d6f4e-7a0e-4a1e-9a4a-2f5a1c9b7d31" },
  "target": { "kind": "PERMISSION", "permissionCode": "purchase-orders:review" },
  "templateKey": "purchase.review.pending",
  "variables": {
    "orderNo": "CG20261028-0001",
    "vendorName": "全利机械",
    "itemCount": 3
  },
  "dedupeKey": "purchase-review:6f0d6f4e-7a0e-4a1e-9a4a-2f5a1c9b7d31",
  "priority": "HIGH",
  "expiresAt": "2026-10-29T12:00:00.000Z",
  "requestedByUserId": "1c2f2a64-1f9c-4f6e-8a14-4f0f6f7f8a11"
}
```

```json
{
  "notificationId": "9a0b7f3e-2f6d-4a8e-9b3c-7d1e5f2a6c40",
  "duplicated": false,
  "channels": [
    { "channel": "IN_APP", "status": "CREATED", "recipientCount": 2, "skippedCount": 0 },
    { "channel": "ASSISTANT", "status": "PENDING", "recipientCount": 2, "skippedCount": 1, "skipReason": "NOT_BOUND" }
  ],
  "warnings": []
}
```

### 2.7 事件目录（首批候选，需业务确认）

| eventType | source.type | 业务域 | 默认渠道 | 千树小助理目标 | templateKey | 优先级 | 站外 TTL | 阶段 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `PURCHASE_REVIEW_PENDING` | `PURCHASE_ORDER` | 采购 | `IN_APP` + `ASSISTANT` | `COMMAND_TARGET` | `purchase.review.pending` | HIGH | 24h | 1 |
| `FUND_WITHDRAWAL_REVIEW_PENDING` | `FUND_WITHDRAWAL` | 财务 | `IN_APP` + `ASSISTANT` | `COMMAND_TARGET` | `fund.withdrawal.pending` | HIGH | 24h | 2 |
| `INVOICE_REQUEST_REVIEW_PENDING` | `INVOICE_REQUEST` | 发票 | `IN_APP` + `ASSISTANT` | `COMMAND_TARGET` | `invoice.review.pending` | HIGH | 24h | 2 |
| `PACKAGING_COST_PAYMENT_PENDING` | `PACKAGING_COST` | 财务 | `IN_APP` + `ASSISTANT` | `COMMAND_TARGET` | `packaging.payment.pending` | NORMAL | 48h | 2 |
| `PURCHASE_PAYABLE_PENDING` | `PURCHASE_ORDER_PAYABLE` | 财务 | `IN_APP` + `ASSISTANT` | `COMMAND_TARGET` | `purchase.payable.pending` | NORMAL | 24h | 2 |
| `SLH_RECONCILIATION_COMPLETED` | `SLH_RECONCILIATION_BATCH` | 对账 | `IN_APP` + `ASSISTANT` | `GROUP`（`finance`） | `slh.reconciliation.completed` | NORMAL | 8h | 1 |
| `SHIPMENT_ARRIVED` | `PURCHASE_SHIPMENT` | 货件运输 | `IN_APP` + `ASSISTANT` | `GROUP`（`operations`） | `shipment.arrived` | NORMAL | 8h | 1 |

业务域用于站内通知的单列表筛选，统一为销售、采购、货件运输、财务、发票、对账、运营、系统八个域；没有事件的域保留筛选入口但返回空列表。`PURCHASE_PAYABLE_PENDING` 与包装、提现统一归财务域。`PURCHASE_PAYABLE_PENDING` 是待付款提醒（定金/尾款未付清），不依赖到期日，具体触发方式见 [事件规格](./events.md)。

当前已扩展为 39 个已接入事件，上表只保留首批目录。运营域新增 `MACHINE_VIEWING_APPOINTMENT_CREATED`、`PROXY_NODE_EXPIRING`、`ADVERTISING_RECHARGE_PAYMENT_PENDING`、`ADVERTISING_RECHARGE_PAID`、`ADVERTISING_RECHARGE_REJECTED`、`ADVERTISING_RECHARGE_VOIDED`；其余新增事件见 `GET /api/notifications/events` 返回值。

表中「默认渠道」是阶段 3 的目标状态；阶段 1 只启用 `ASSISTANT` 与表中阶段为 1 的 3 个事件，`IN_APP` 渠道在阶段 1 没有配置行，发布时返回 `CHANNEL_NOT_CONFIGURED` 警告且不创建收件箱条目。

事件目录是稳定的对外契约：新增事件只追加，不修改既有 `eventType` 语义；删除事件需要先停止所有调用方。

### 2.8 业务侧禁止事项

- 不得直接调用 GeWe 的 `postText` / `postLink` 等接口。
- 不得在业务代码里拼接自由文本作为通知内容；必须使用 `templateKey + variables`。
- 不得在数据库事务内发起外部 HTTP 请求。
- 不得把通知当作业务正确性的依赖；通知失败不得回滚业务。
- 不得传入原始 `chatroomId`、员工 `wxid` 或渠道账号信息。
- 不得把未在模板变量白名单中的敏感字段写入 `variables`。

## 3. 跨进程可选入口（默认关闭）

供脚本、未来独立服务或外部系统使用，不暴露给浏览器。

| 项目 | 内容 |
| --- | --- |
| 方法 | `POST /api/internal/notifications` |
| 鉴权 | `Authorization: Bearer <NOTIFICATION_INTERNAL_TOKEN>`，常量时间比较 |
| 请求体 | 与 `SystemNotificationPublishCommand` 相同 |
| 响应 | 与 `SystemNotificationPublishResult` 相同 |
| 开关 | `NOTIFICATION_INTERNAL_API_ENABLED`，默认 `false` |
| OpenAPI | 排除，不进入前端类型生成 |
| 限流 | 按来源 IP 与全局令牌桶双重限制 |

该入口只是服务接口的薄适配层，不新增另一套命令模型。

## 4. 管理端 HTTP API

### 4.1 通知中心（共享）

| 方法 | 路径 | 权限 | operationId | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/api/notifications/overview` | `notification-record:read` | `notifications_overview_get` | 各渠道状态与今日统计 |
| GET | `/api/notifications/events` | `notification-policy:read` 或 `notification-template:read` | `notifications_events_list` | 事件元数据：名称、业务域、变量契约、默认模板键、是否已接入 |
| GET | `/api/notifications/settings` | `notification-policy:read` | `notifications_settings_get` | 全局保留期 |
| PUT | `/api/notifications/settings` | `notification-policy:update` | `notifications_settings_update` | 修改保留期，需 `expectedVersion` |
| GET | `/api/notifications/templates` | `notification-template:read` | `notifications_templates_list` | 模板列表，可按渠道筛选 |
| POST | `/api/notifications/templates` | `notification-template:update` | `notifications_templates_create` | 新建模板；唯一键 `(key, channel)` |
| PATCH | `/api/notifications/templates/:id` | `notification-template:update` | `notifications_templates_update` | 修改模板，版本递增 |
| POST | `/api/notifications/templates/:id/preview` | `notification-template:read` | `notifications_templates_preview` | 用样例变量渲染预览 |
| POST | `/api/notifications/templates/:id/test` | `notification-template:update` | `notifications_templates_test` | 测试发送；`ASSISTANT` 渠道发管理员本人 |
| GET | `/api/notifications/channel-policies` | `notification-policy:read` | `notifications_policies_list` | 事件 × 渠道策略 |
| PUT | `/api/notifications/channel-policies/:eventType/:channel` | `notification-policy:update` | `notifications_policies_update` | 修改单个事件在单个渠道上的策略 |
| GET | `/api/notifications/records` | `notification-record:read` | `notifications_records_list` | 逻辑通知列表与渠道汇总 |
| GET | `/api/notifications/records/:id` | `notification-record:read` | `notifications_records_get` | 详情；站内看阅读计数，站外看逐人交付 |
| POST | `/api/notifications/records/:id/cancel` | `notification-record:manage` | `notifications_records_cancel` | 取消未发送的站外交付；站内条目不受影响 |

模板响应和创建/更新请求新增 `domain`，只能取 `SALES`、`PURCHASE`、`SHIPMENT`、`FINANCE`、`INVOICE`、`RECONCILIATION`、`OPERATIONS`、`SYSTEM` 之一，模板只属于一个业务域。同一 `key` 在两个渠道必须使用同一业务域，冲突返回 422 `NOTIFICATION_TEMPLATE_DOMAIN_CONFLICT`。`PURCHASE_PAYABLE_PENDING` 与 `PACKAGING_COST_PAYMENT_PENDING` 统一归 `FINANCE`；未识别的历史模板回填 `SYSTEM`。策略绑定模板时，管理端在模板域与事件域不一致时提示但允许保存。

策略的 `templateKey` 非空时即显式绑定：模板必须存在于该渠道，否则返回 422 `NOTIFICATION_POLICY_TEMPLATE_NOT_FOUND`；模板占位符必须属于该事件的变量契约，否则返回 422 `NOTIFICATION_POLICY_TEMPLATE_VARIABLES_INVALID`。尚无触发源的事件不登记变量契约，只校验模板存在性。`templateKey` 为空时发布回退到业务命令键。

`GET /api/notifications/events` 的事件元数据由服务端常量派生：`eventType`、`label`、`domain`（模板业务域）、`variables`、`variableDefinitions`、`variablesKnown`、`defaultTemplateKey`（业务命令默认键，无触发源时为 `null`）、`implemented`。`variableDefinitions` 为每个变量提供 `name`、`label`、`description`、`example`、`sensitive`、`maxLength`、`required`，供模板编辑器直接展示和插入；`variables` 保留为变量名数组，供兼容性与策略校验使用。管理端用它展示默认模板、过滤不兼容模板和判断事件是否已接入，不再各自维护事件名与变量清单。

### 4.2 千树小助理（渠道）

| 方法 | 路径 | 权限 | operationId | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/api/assistant/channel` | `assistant-channel:read` | `assistant_channel_get` | 渠道配置；Token 只返回掩码与是否已配置 |
| PUT | `/api/assistant/channel` | `assistant-channel:update` | `assistant_channel_update` | 启停、Base URL、默认静默时段，需 `expectedVersion` |
| POST | `/api/assistant/channel/test` | `assistant-channel:update` | `assistant_channel_test` | 用公司号自己的文件传输助手发测试消息 |
| GET | `/api/assistant/accounts` | `assistant-account:read` | `assistant_accounts_list` | 账号列表 |
| POST | `/api/assistant/accounts` | `assistant-account:operate` | `assistant_accounts_create` | 导入 GeWe 控制台已有节点（`appId` + `wxid`），先校验在线 |
| PATCH | `/api/assistant/accounts/:id` | `assistant-account:operate` | `assistant_accounts_update` | 备注名、`appId`/`wxid`、启停；`appId` 变化时重新校验在线 |
| POST | `/api/assistant/accounts/:id/check` | `assistant-account:operate` | `assistant_accounts_check_status` | 调用 `checkOnline` 刷新本地在线状态，不触发登录、重连或退出 |
| GET | `/api/assistant/accounts/:id/qrcode` | `assistant-account:read` | `assistant_accounts_qrcode` | 获取公司号个人二维码，供员工扫码添加好友；未导入节点返回 422 |
| GET | `/api/assistant/contacts` | `assistant-binding:read` | `assistant_contacts_list` | 公司号好友列表，供管理员选择绑定对象 |
| GET | `/api/assistant/bindings` | `assistant-binding:read` | `assistant_bindings_list` | 绑定列表 |
| POST | `/api/assistant/bindings` | `assistant-binding:manage` | `assistant_bindings_create` | 管理员创建绑定（员工 + 好友 `wxid`） |
| PATCH | `/api/assistant/bindings/:id/reassign` | `assistant-binding:manage` | `assistant_bindings_reassign` | 把现有微信绑定改给另一员工；清空原验证状态，需重新发送测试 |
| POST | `/api/assistant/bindings/:id/verify` | `assistant-binding:manage` | `assistant_bindings_verify` | 发送自定义测试消息并标记已验证；内容必填且不超过 500 字，30 秒冷却 |
| DELETE | `/api/assistant/bindings/:id` | `assistant-binding:manage` | `assistant_bindings_delete` | 解绑 |
| POST | `/api/assistant/bindings/check` | `assistant-binding:manage` | `assistant_bindings_check` | 触发好友关系巡检 |
| GET | `/api/assistant/targets` | `assistant-target:read` | `assistant_targets_list` | 群目标列表 |
| POST | `/api/assistant/targets/sync` | `assistant-target:manage` | `assistant_targets_sync` | 从公司号通讯录同步群；新群 key 默认使用 `chatroomId` |
| GET | `/api/assistant/targets/:id/members` | `assistant-target:read` | `assistant_targets_members` | 按需读取群成员与群主/管理员角色，不落库 |
| POST | `/api/assistant/targets/:id/mention-message` | `assistant-target:manage` | `assistant_targets_mention_message` | 向群发送自由文本并 @ 指定成员 |
| PATCH | `/api/assistant/targets/:id` | `assistant-target:manage` | `assistant_targets_update` | 编辑语义 key、名称、用途、内部群与启停 |
| POST | `/api/assistant/deliveries/:id/retry` | `assistant-delivery:resend` | `assistant_deliveries_retry` | 重试单条站外交付；过期拒绝 |
| GET | `/api/assistant/callback-events` | `assistant-callback:read` | `assistant_callback_events_list` | 回调记录（可选，回调引入后） |
| GET | `/api/assistant/callback-events/:id` | `assistant-callback:read` | `assistant_callback_events_get` | 回调详情；原始报文脱敏（可选） |

账号登录、掉线重连与退出全部在 GeWe 控制台完成；系统不提供扫码登录、`reconnection` 或 `logout` 接口。系统只保存管理员从控制台复制的 `appId`/`wxid`，并在导入或重新指向节点时调用 `checkOnline` 校验；离线节点拒绝导入。旧版 `REQUIRES_LOGIN` 账号仅作为历史占位，需要在「更新节点」中补齐真实 `appId`。

绑定改绑不会改变微信 `wxid`，但会清空 `verifiedAt`、`verifiedByUserId` 和 `friendCheckedAt`，必须重新发送测试消息。目标员工必须启用，且不能已经绑定同一公司号；冲突返回 409 `ASSISTANT_BINDING_USER_CONFLICT`。改绑审计由一条 `ASSISTANT_BINDING_REVOKED` 与一条 `ASSISTANT_BINDING_CREATED` 组成，metadata 标注 `mode = REASSIGN`。

绑定列表、创建和改绑响应同时返回完整 `wxid` 与 `wxidMasked`：`wxid` 只用于管理员在页面核对和复制，日志、审计与错误信息仍不得写入完整 `wxid`。`wechatNickname` 与 `wechatAvatarUrl` 是好友巡检按需刷新的微信资料快照；列表读取不访问 GeWe。

`POST /api/assistant/bindings/:id/verify` 请求体为 `{ "content": "..." }`：去除首尾空白后不能为空，最长 500 个字符；空内容或超限返回 422 `ASSISTANT_BINDING_CONTENT_INVALID`。服务端先以 `last_test_sent_at` 的条件更新原子占用 30 秒冷却窗口，窗口内重复请求返回 429 `ASSISTANT_BINDING_TEST_COOLDOWN` 且不调用 GeWe；发送成功后写入验证时间并标记 `ACTIVE`。测试内容只用于本次发送，不落库、不进审计；上游失败同样占用冷却窗口，避免连续重试。

群目标的 `chatroomId` 是同步身份，`key` 是管理员可编辑的语义键。同步新群时 `key` 默认等于 `chatroomId`；修改 `key` 不会改变 `chatroomId`，但引用旧 `key` 的渠道策略必须同步更新 `targetConfig.targetKeys`。重复 key 返回 409 `ASSISTANT_TARGET_KEY_EXISTS`。同步群会为前 100 个群调用 GeWe `getChatroomInfo` 刷新名称、头像与 `memberCount`（成员列表长度）；单个群详情被拒绝或返回未知业务错误时跳过该群的详情字段，离线、限流、超时和网络失败仍使整批同步失败。群目标响应包含 `avatarUrl`、`memberCount`、`lastSyncedAt`，列表读取不访问 GeWe。

`GET /api/assistant/targets/:id/members` 按需调用 GeWe `getChatroomMemberList`，返回成员 `wxid`、微信昵称、群内昵称、头像、邀请人昵称和角色（`OWNER`/`ADMIN`/`MEMBER`，由 `chatroomOwner`/`adminWxid` 匹配）。GeWe 该接口没有分页参数，返回数量以上游为准。成员列表不落库、不写审计，关闭页面即丢弃；没有可用公司号返回 422 `ASSISTANT_ACCOUNT_UNAVAILABLE`，群目标不存在返回 404 `ASSISTANT_TARGET_NOT_FOUND`，其余上游错误复用统一的 422/429/503 映射。成员是否内部员工不由系统判断。

`POST /api/assistant/targets/:id/mention-message` 请求体为 `{ "memberWxid": "wxid_xxx", "content": "..." }`：内容去空白后 1–1000 字，超限或为空返回 422 `ASSISTANT_TARGET_MESSAGE_INVALID`。群目标停用返回 422 `ASSISTANT_TARGET_DISABLED`，渠道停发返回 422 `ASSISTANT_CHANNEL_DISABLED`，成员不在群内返回 422 `ASSISTANT_TARGET_MEMBER_NOT_FOUND`。服务端按当前群成员资料取 `displayName`（为空回退 `nickName`），自动拼接 `@群内昵称 内容` 并传 `ats=memberWxid`；成功后写 `ASSISTANT_TARGET_MESSAGE_SENT` 审计（成员 wxid 掩码、内容长度、msgId，不写正文）。该发送不创建通知或 `assistant_deliveries` 记录，属于管理员手动外发。

上游错误不再全部折叠为通用 503：地址/代理校验失败返回 503 `ASSISTANT_OUTBOUND_BLOCKED`，节点离线返回 422 `ASSISTANT_ACCOUNT_OFFLINE`，上游限流返回 429 `ASSISTANT_RATE_LIMITED`，网络/DNS 失败返回 503 `ASSISTANT_UPSTREAM_UNAVAILABLE`。响应只使用固定文案，不回传 GeWe 原始 `msg`。

### 4.3 关键响应示例

```json
// GET /api/notifications/overview（阶段 1）
{
  "settingsEnabled": true,
  "channels": [
    {
      "channel": "IN_APP",
      "enabled": false,
      "today": { "published": 0, "unread": 0 }
    },
    {
      "channel": "ASSISTANT",
      "enabled": true,
      "account": { "id": "3d0f...", "name": "公司号-01", "status": "ONLINE", "lastOnlineAt": "2026-10-28T02:15:00.000Z" },
      "today": { "published": 42, "accepted": 39, "failed": 2, "expired": 1 },
      "queue": { "pending": 0, "oldestPendingAt": null }
    }
  ]
}
```

```json
// POST /api/assistant/accounts
{
  "name": "公司号-01",
  "appId": "wx_wR_U4zPj2M_OTS3BCyoE4",
  "wxid": "wxid_company01",
  "nickname": "千树小助理"
}
```

```json
// POST /api/assistant/accounts/:id/check
{
  "id": "3d0f...",
  "name": "公司号-01",
  "appId": "wx_wR_U4zPj2M_OTS3BCyoE4",
  "wxidMasked": "wxid****01",
  "nickname": "千树小助理",
  "avatarUrl": null,
  "status": "ONLINE",
  "enabled": true,
  "lastOnlineAt": "2026-10-28T02:15:00.000Z",
  "lastLoginAt": null,
  "version": 2
}
```

```json
// GET /api/notifications/records/:id
{
  "id": "9a0b...",
  "eventType": "PURCHASE_REVIEW_PENDING",
  "source": { "type": "PURCHASE_ORDER", "id": "6f0d..." },
  "status": "PARTIAL",
  "templateKey": "purchase.review.pending",
  "createdAt": "2026-10-28T02:00:00.000Z",
  "channels": [
    { "channel": "IN_APP", "itemCount": 3, "unreadCount": 2, "readCount": 1 },
    { "channel": "ASSISTANT", "pending": 0, "accepted": 2, "failed": 1, "expired": 0, "skipped": 0 }
  ],
  "assistantDeliveries": [
    {
      "id": "b1...",
      "recipientUserId": "5e2a...",
      "recipientName": "李华",
      "status": "ACCEPTED",
      "attemptCount": 1,
      "providerMsgId": "376897...",
      "providerNewMsgId": "9154...",
      "acceptedAt": "2026-10-28T02:00:03.000Z"
    },
    {
      "id": "b2...",
      "recipientUserId": "8c1b...",
      "recipientName": "王强",
      "status": "FAILED",
      "attemptCount": 3,
      "failureCode": "ACCOUNT_OFFLINE",
      "failureMessage": "公司号离线，通知已过期",
      "acceptedAt": null
    }
  ]
}
```

## 5. 员工侧接口（站内阶段 3 预留）

### 5.1 站内通知（阶段 3）

全部只要求登录，不要求管理权限；服务端强制 `userId = 当前会话用户`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/notifications/me/inbox` | 列表；`status=all/unread/archived`、`domain=sales/purchase/shipment/finance/invoice/reconciliation/operations/system`、`page`、`pageSize` |
| GET | `/api/notifications/me/inbox/unread-count` | 未读总数 `{ total }`；只算未读且未归档 |
| GET | `/api/notifications/me/inbox/new` | 增量新消息；`cursor`、`limit`；供页面内 Toast 与桌面通知使用 |
| GET | `/api/notifications/me/inbox/:id` | 详情；不属于当前用户返回 404 |
| POST | `/api/notifications/me/inbox/:id/read` | 标记已读，幂等 |
| POST | `/api/notifications/me/inbox/:id/unread` | 标记未读，幂等 |
| POST | `/api/notifications/me/inbox/read-all` | 全部已读；请求体可选 `{ domain }` |
| POST | `/api/notifications/me/inbox/:id/archive` | 归档；未读时同时写 `readAt` |
| POST | `/api/notifications/me/inbox/:id/unarchive` | 取消归档；`readAt` 保留 |

列表响应使用 `{ items, page, pageSize, total }`；列表项返回 `id`、`eventType`、`domain`、`title`、`readAt`、`archivedAt`、`createdAt`，正文只在详情返回。增量接口返回 `{ items, unreadTotal, nextCursor, hasMore, serverTime }`，游标编码 `(createdAt, id)`，避免同一时间戳消息漏拉。

完整语义、业务域映射与 30 秒轮询规则见 [站内通知设计](./inapp.md)。

### 5.2 千树小助理绑定

员工侧**没有自助绑定接口**。绑定、解绑、换号由管理员通过第 4.2 节的 `/api/assistant/bindings` 完成；员工只负责在微信里添加公司号并接收消息。

管理员绑定流程对应接口：

1. `GET /api/assistant/contacts` 获取公司号好友列表。
2. `POST /api/assistant/bindings` 选择员工与好友 `wxid`，创建绑定。
3. `POST /api/assistant/bindings/:id/verify` 提交自定义测试内容（≤500 字，30 秒冷却）发送测试消息；发送成功即写入 `verified_at`。
4. 只有 `verified_at` 非空的绑定可以接收 1:1 消息，尤其是金额与客户名称。

## 6. 机器回调契约（可选，阶段 1 不实现）

> 阶段 1 不接回调。本节仅作为后续引入实时掉线/联系人事件时的契约草案；届时先完成 CSRF 安全评审。

### 6.1 路由与要求

| 项目 | 内容 |
| --- | --- |
| 方法 | `POST /api/assistant/callback/:secret` |
| 鉴权 | 路径密钥，常量时间比较；不是用户 Session |
| CSRF | 例外（见设计文档第 7 节，需安全评审） |
| Content-Type | `application/json` |
| 请求体上限 | 1 MiB，超出返回 413 `PAYLOAD_TOO_LARGE` |
| 响应 | 写入 `assistant_callback_events` 后立即返回 200，body 为 `{ "ok": true }` |
| 超时 | 3 秒内必须返回；处理逻辑全部异步 |
| 重试 | 平台不重试；重复投递按 `appid + newMsgId` 去重 |

### 6.2 v1 报文（节选）

```json
{
  "TypeName": "AddMsg",
  "Appid": "wx_wR_U4zPj2M_OTS3BCyoE4",
  "Wxid": "wxid_company01",
  "Data": {
    "MsgId": 1298811784,
    "NewMsgId": 9154432038,
    "MsgType": 1,
    "FromUserName": { "string": "wxid_employee01" },
    "ToUserName": { "string": "wxid_company01" },
    "Content": { "string": "绑定 QS-7F3K-9M2P" },
    "CreateTime": 1761616800
  }
}
```

### 6.3 v2 报文（节选）

```json
{
  "appid": "wx_wR_U4zPj2M_OTS3BCyoE4",
  "wxid": "wxid_company01",
  "content": "绑定 QS-7F3K-9M2P",
  "createTime": 1761616800,
  "fromUser": "wxid_employee01",
  "toUser": "wxid_company01",
  "isSelf": false,
  "msgId": 1298811784,
  "msgType": "TEXT",
  "newMsgId": 9154432038
}
```

### 6.4 归一化映射

| 语义 | v1 | v2 |
| --- | --- | --- |
| 版本判别 | 存在 `TypeName` 或 `Data` | 顶层 `msgType` 为字符串 |
| 账号 | `Appid` | `appid` |
| 当前微信 | `Wxid` | `wxid` |
| 消息唯一 ID | `Data.NewMsgId` | `newMsgId` |
| 消息类型 | `Data.MsgType` 数字 | `msgType` 字符串 |
| 发送人 | `Data.FromUserName.string` | `fromUser` |
| 接收人 | `Data.ToUserName.string` | `toUser` |
| 内容 | `Data.Content.string` | `content` |
| 是否自己发送 | `FromUserName == Wxid` | `isSelf` |
| 掉线 | `TypeName = Offline` | `msgType` 为 `LOGIN_ERROR` / `LOGOUT` / `RECONNECT_FAIL` |
| 联系人变更 | `TypeName = ModContacts` / `DelContacts` | 文档未列出，按未知事件处理 |

### 6.5 处理范围

| 事件 | 处理 |
| --- | --- |
| 文本消息 | 阶段 1 无回调；引入后只入库，不处理（绑定由管理员完成） |
| 掉线与登录事件 | 更新账号状态，写审计，触发告警；不改业务数据 |
| 联系人删除事件 | 将对应绑定置为 `INVALID` |
| 其他消息 | 只入库，不触发业务动作 |

回调内容按不可信输入处理：不解析执行、不拼接 SQL、不把报文字段直接用于权限判断。

## 7. 状态与错误码

### 7.1 通知状态（共享）

| 状态 | 含义 |
| --- | --- |
| `PENDING` | 已入队，站外交付尚未全部处理 |
| `COMPLETED` | 所有启用渠道都成功：站内条目已创建，站外交付全部 `ACCEPTED` |
| `PARTIAL` | 部分渠道成功，部分失败、过期或跳过 |
| `FAILED` | 没有任何渠道成功 |
| `SKIPPED` | 所有渠道在入队时被跳过 |
| `EXPIRED` | 站外交付过期且没有任何渠道成功 |
| `CANCELLED` | 站外交付被取消且没有任何渠道成功；站内条目仍保留 |

### 7.2 站内条目状态

站内不使用投递状态枚举，用时间戳表达：

| 状态 | 判定 |
| --- | --- |
| 未读 | `read_at IS NULL AND archived_at IS NULL` |
| 已读 | `read_at IS NOT NULL AND archived_at IS NULL` |
| 已归档 | `archived_at IS NOT NULL` |

### 7.3 站外交付状态（`assistant_deliveries`）

每条交付包含实际渲染使用的 `templateKey` 与 `templateVersion`；渠道策略覆盖模板时，`templateKey` 可能与通知主表的业务默认键不同，记录详情按交付展示。

| 状态 | 含义 |
| --- | --- |
| `PENDING` | 等待发送或等待重试 |
| `SENDING` | 正在发送 |
| `ACCEPTED` | GeWe 返回 `ret=200`，只代表请求被接受，不代表已送达 |
| `FAILED` | 重试耗尽或不可重试 |
| `SKIPPED` | 未发送，例如未绑定、用户停用、渠道关闭 |
| `EXPIRED` | 超过有效期 |
| `CANCELLED` | 管理员取消 |

### 7.4 跳过原因

`NOT_BOUND`、`USER_DISABLED`、`NO_RECIPIENT`、`TARGET_DISABLED`、`CHANNEL_DISABLED`、`CHANNEL_NOT_CONFIGURED`、`QUIET_HOURS_EXPIRED`。

### 7.5 失败码

`TEMPLATE_NOT_FOUND`、`TEMPLATE_VARIABLE_MISSING`、`TEMPLATE_TOO_LONG`、`ACCOUNT_OFFLINE`、`ACCOUNT_DISABLED`、`TRANSPORT_TIMEOUT`、`TRANSPORT_ERROR`、`PROVIDER_REJECTED`、`RATE_LIMITED`、`UNKNOWN`。

### 7.6 发布警告

`EVENT_NOT_CONFIGURED`、`CHANNEL_NOT_CONFIGURED`、`TEMPLATE_NOT_FOUND`、`TEMPLATE_VARIABLE_MISSING`、`SENSITIVE_VARIABLE_MASKED`、`NO_RECIPIENT`、`DUPLICATE_IGNORED`。

警告只用于调用方日志与排查，不改变业务事务结果。

## 8. 版本与兼容

- `NOTIFICATION_EVENT_TYPES` 只追加，不重命名、不复用已删除的值。
- 模板唯一键是 `(key, channel)`；每个渠道独立版本号。已入队通知保留发布时的模板版本与渲染内容快照。
- 渠道策略唯一键是 `(event_type, channel)`；新增渠道不影响既有策略。
- 回调同时兼容 v1 与 v2；新增事件类型按「未知事件入库、不影响已支持流程」处理。
- 管理端接口的破坏性变更必须走 OpenAPI 快照与前端类型同步，不允许手改生成文件。
- 内部服务接口与 HTTP 适配层共享同一命令模型；新增字段必须可选，保证旧调用方不受影响。
