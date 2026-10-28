# 千树小助理通知接口契约

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档状态 | 设计稿，待评审；未实施 |
| 方案定位 | 通知中心的微信出站通道契约；站内通道后续接入同一命令模型 |
| 关联文档 | [落地设计](./design.md)、[GeWeAPI 微信通知接入评估](../../docs/技术评估/GeWeAPI微信通知接入评估.md) |
| 最后更新 | 2026-10-28 |
| 适用范围 | `server/src/modules/assistant`、`web/apps/qsmds-arco/src/api/modules/assistant.ts` |

本文中的 TypeScript 片段是契约示意，不是最终代码；表结构、权限与迁移以评审通过的实施方案为准。

## 1. 通用约定

- 所有 HTTP 接口挂在全局前缀 `/api` 下，不在路径中重复 `api`。
- 管理端接口使用 Cookie Session 鉴权，写操作必须携带 `X-Qianshu-CSRF: 1`，并按权限码校验。
- 错误响应统一为 `ApiError`：`{ code, message, fieldErrors?, requestId }`，`code` 为大写蛇形。
- 列表查询参数统一为 `query`、`page`（默认 1）、`pageSize`（默认 20，最大 100）。
- 列表响应统一为 `{ items, page, pageSize, total }`。
- 时间字段使用 ISO 8601 UTC 字符串；页面按 `Asia/Shanghai` 展示。
- 资源 ID 使用 UUID。
- 管理端接口进入 OpenAPI 并参与 `contract:sync`；机器回调与可选内部接口不进入 OpenAPI 快照。

## 2. 业务侧统一接口（主入口）

### 2.1 形态

业务模块通过同进程依赖注入调用 `AssistantNotificationService.publish()`，不通过 HTTP 调用本系统自身，也不直接调用 GeWe。

```ts
@Injectable()
export class AssistantNotificationService {
  publish(
    command: AssistantPublishCommand,
    options?: AssistantPublishOptions,
  ): Promise<AssistantPublishResult>
}
```

选择服务接口而不是 HTTP 的理由：

- 可以与业务变更共用同一个数据库事务，保证「业务成功则通知不丢」。
- 业务模块不接触 GeWe 的 `appId`、`wxid`、`chatroomId`、Token 与限速细节。
- 将来接入站内通知时，业务调用方无需修改。

### 2.2 命令模型

```ts
export const ASSISTANT_EVENT_TYPES = [
  'PURCHASE_REVIEW_PENDING',
  'FUND_WITHDRAWAL_REVIEW_PENDING',
  'INVOICE_REQUEST_REVIEW_PENDING',
  'PACKAGING_COST_PAYMENT_PENDING',
  'PURCHASE_PAYABLE_DUE',
  'SLH_RECONCILIATION_COMPLETED',
  'SHIPMENT_ARRIVED',
] as const

export type AssistantEventType = (typeof ASSISTANT_EVENT_TYPES)[number]

/** 首期只实现 WECHAT；IN_APP 为站内通知预留，传入时降级为 warning。 */
export type AssistantChannel = 'WECHAT' | 'IN_APP'

export type AssistantPriority = 'NORMAL' | 'HIGH'

export type AssistantTarget =
  | { kind: 'USERS'; userIds: string[] }
  | { kind: 'ROLE'; roleCodes: string[] }
  | { kind: 'PERMISSION'; permissionCode: string }
  | { kind: 'GROUP'; targetKeys: string[] }

export interface AssistantPublishCommand {
  eventType: AssistantEventType
  source: { type: string; id: string }
  target: AssistantTarget
  templateKey: string
  variables: Record<string, string | number | null>
  /** 同一事件重复触发时的幂等键；省略时按 eventType + source 生成 */
  dedupeKey?: string
  priority?: AssistantPriority
  /** 超过该时间不再投递；省略时取事件策略，最长 7 天 */
  expiresAt?: string
  /** 省略时取事件策略；首期只接受 WECHAT */
  channels?: AssistantChannel[]
  requestedByUserId?: string
}

export interface AssistantPublishOptions {
  /** 传入业务事务时，通知与业务变更同事务提交 */
  transaction?: Prisma.TransactionClient
  now?: Date
}

export interface AssistantPublishResult {
  notificationId: string
  duplicated: boolean
  deliveries: Array<{
    recipientUserId: string | null
    targetId: string | null
    channel: AssistantChannel
    status: 'PENDING' | 'SKIPPED'
    skipReason?: AssistantSkipReason
  }>
  warnings: Array<{ code: string; message: string }>
}
```

约束：

- `source.type` 使用大写蛇形业务对象名，例如 `PURCHASE_ORDER`、`SLH_RECONCILIATION_BATCH`。
- `variables` 只允许一层字符串、数字或 `null`；key 最多 20 个，单值最长 200 字符；`null` 渲染为空字符串。
- `dedupeKey` 最长 200 字符，只允许 `A-Z a-z 0-9 : _ -`，不得包含姓名、手机号等个人信息。
- `expiresAt` 必须晚于当前时间；已过期时直接落 `EXPIRED`，不投递。

### 2.3 语义保证

1. **幂等**：同一 `eventType + dedupeKey` 只创建一条通知。重复调用返回原通知，`duplicated: true`，不新增投递记录。
2. **事务**：传入 `transaction` 时，通知主记录与投递记录在业务事务内写入；不传时由服务自己开事务。通知表写入失败会连同业务一起回滚，这是为了不出现「业务成功、通知记录丢失」。
3. **不阻断业务**：事件未配置、模板缺失、变量缺失、收件人为空、渠道关闭等情况**不抛异常**，只把通知落为 `FAILED` / `SKIPPED` 并在 `warnings` 返回；只有数据库错误会向上抛出。
4. **异步投递**：`publish()` 不调用 GeWe，只落库；由 worker 异步发送。接口返回的 `PENDING` 只代表已入队。
5. **快照**：收件人与渲染后的内容在发布时确定，之后模板或角色变化不影响已入队通知。
6. **过期**：超过 `expiresAt` 的投递不再发送，状态落 `EXPIRED`。

### 2.4 收件人解析

| `target.kind` | 解析方式 | 说明 |
| --- | --- | --- |
| `USERS` | 按 `userIds` 取启用用户 | 停用用户落 `SKIPPED`，原因 `USER_DISABLED` |
| `ROLE` | 取拥有任一 `roleCodes` 的启用用户 | 结果去重 |
| `PERMISSION` | 取角色权限并集包含该权限码的启用用户 | 与 `PermissionGuard` 判定口径一致 |
| `GROUP` | 按 `targetKeys` 取已登记的群目标 | 不接受原始 `chatroomId` |

`USERS`、`ROLE`、`PERMISSION` 解析为个人收件人；`GROUP` 解析为群目标。一次发布只允许一种目标类型，避免个人与群的投递状态混在一起。

### 2.5 渠道选择

- 首期只实现 `WECHAT`。
- `channels` 省略时取事件策略；策略也没有时默认 `WECHAT`。
- 传入 `IN_APP` 时返回 warning `CHANNEL_NOT_AVAILABLE`，不创建投递记录。站内通知中心落地后，`IN_APP` 由独立消费者处理，业务调用方无需改调用方式。

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
  "deliveries": [
    { "recipientUserId": "5e2a...", "targetId": null, "channel": "WECHAT", "status": "PENDING" },
    { "recipientUserId": "8c1b...", "targetId": null, "channel": "WECHAT", "status": "SKIPPED", "skipReason": "NOT_BOUND" }
  ],
  "warnings": []
}
```

### 2.7 事件目录（首批候选，需业务确认）

| eventType | source.type | 默认目标 | templateKey | 渠道 | 优先级 | TTL |
| --- | --- | --- | --- | --- | --- | --- |
| `PURCHASE_REVIEW_PENDING` | `PURCHASE_ORDER` | 权限 `purchase-orders:review` | `purchase.review.pending` | WECHAT | HIGH | 24h |
| `FUND_WITHDRAWAL_REVIEW_PENDING` | `FUND_WITHDRAWAL` | 权限 `fund-withdrawals:review` | `fund.withdrawal.pending` | WECHAT | HIGH | 24h |
| `INVOICE_REQUEST_REVIEW_PENDING` | `INVOICE_REQUEST` | 权限 `invoice-requests:review` | `invoice.review.pending` | WECHAT | HIGH | 24h |
| `PACKAGING_COST_PAYMENT_PENDING` | `PACKAGING_COST` | 权限 `packaging-costs:pay` | `packaging.payment.pending` | WECHAT | NORMAL | 48h |
| `PURCHASE_PAYABLE_DUE` | `PURCHASE_ORDER_PAYABLE` | 负责人（`USERS`） | `purchase.payable.due` | WECHAT | NORMAL | 24h |
| `SLH_RECONCILIATION_COMPLETED` | `SLH_RECONCILIATION_BATCH` | 群目标 `finance` | `slh.reconciliation.completed` | WECHAT | NORMAL | 8h |
| `SHIPMENT_ARRIVED` | `PURCHASE_SHIPMENT` | 群目标 `operations` | `shipment.arrived` | WECHAT | NORMAL | 8h |

事件目录是稳定的对外契约：新增事件只追加，不修改既有 `eventType` 语义；删除事件需要先停止所有调用方。

### 2.8 业务侧禁止事项

- 不得直接调用 GeWe 的 `postText` / `postLink` 等接口。
- 不得在业务代码里拼接自由文本作为通知内容；必须使用 `templateKey + variables`。
- 不得在数据库事务内发起外部 HTTP 请求。
- 不得把通知当作业务正确性的依赖；通知失败不得回滚业务。
- 不得传入原始 `chatroomId` 或员工 `wxid`。
- 不得把未在模板变量白名单中的敏感字段写入 `variables`。

## 3. 跨进程可选入口（默认关闭）

供脚本、未来独立服务或外部系统使用，不暴露给浏览器。

| 项目 | 内容 |
| --- | --- |
| 方法 | `POST /api/internal/assistant-notifications` |
| 鉴权 | `Authorization: Bearer <ASSISTANT_INTERNAL_TOKEN>`，常量时间比较 |
| 请求体 | 与 `AssistantPublishCommand` 相同 |
| 响应 | 与 `AssistantPublishResult` 相同 |
| 开关 | `ASSISTANT_INTERNAL_API_ENABLED`，默认 `false` |
| OpenAPI | 排除，不进入前端类型生成 |
| 限流 | 按来源 IP 与全局令牌桶双重限制 |

该入口只是服务接口的薄适配层，不新增另一套命令模型。

## 4. 管理端 HTTP API

### 4.1 概览与设置

| 方法 | 路径 | 权限 | operationId | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/api/assistant/overview` | `assistant-notification:read` | `assistant_overview_get` | 通道状态、今日发送、队列积压 |
| GET | `/api/assistant/settings` | `assistant-channel:read` | `assistant_settings_get` | 总开关、默认静默时段、保留期 |
| PUT | `/api/assistant/settings` | `assistant-channel:update` | `assistant_settings_update` | 修改总开关与默认策略；需 `expectedVersion` |

### 4.2 渠道与账号

| 方法 | 路径 | 权限 | operationId | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/api/assistant/channel` | `assistant-channel:read` | `assistant_channel_get` | 渠道配置；Token 只返回掩码与是否已配置 |
| PUT | `/api/assistant/channel` | `assistant-channel:update` | `assistant_channel_update` | 修改启停与 Base URL，需 `expectedVersion` |
| POST | `/api/assistant/channel/test` | `assistant-channel:update` | `assistant_channel_test` | 用公司号自己的文件传输助手发测试消息 |
| GET | `/api/assistant/accounts` | `assistant-account:read` | `assistant_accounts_list` | 账号列表 |
| POST | `/api/assistant/accounts` | `assistant-account:operate` | `assistant_accounts_create` | 新增账号记录（首期仅一条） |
| PATCH | `/api/assistant/accounts/:id` | `assistant-account:operate` | `assistant_accounts_update` | 备注名、区域、代理、启停 |
| POST | `/api/assistant/accounts/:id/login` | `assistant-account:operate` | `assistant_accounts_login_start` | 获取二维码，返回 `qrImgBase64` 与过期时间 |
| GET | `/api/assistant/accounts/:id/login-status` | `assistant-account:operate` | `assistant_accounts_login_status` | 轮询扫码状态 |
| POST | `/api/assistant/accounts/:id/reconnect` | `assistant-account:operate` | `assistant_accounts_reconnect` | 掉线重连 |
| POST | `/api/assistant/accounts/:id/logout` | `assistant-account:operate` | `assistant_accounts_logout` | 退出登录 |

### 4.3 绑定与群目标

| 方法 | 路径 | 权限 | operationId | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/api/assistant/bindings` | `assistant-binding:read` | `assistant_bindings_list` | 绑定列表，支持状态与关键字筛选 |
| POST | `/api/assistant/bindings/codes` | `assistant-binding:manage` | `assistant_bindings_code_create` | 生成一次性绑定码，返回明文一次 |
| DELETE | `/api/assistant/bindings/:id` | `assistant-binding:manage` | `assistant_bindings_delete` | 解绑 |
| POST | `/api/assistant/bindings/check` | `assistant-binding:manage` | `assistant_bindings_check` | 触发好友关系巡检 |
| GET | `/api/assistant/targets` | `assistant-target:read` | `assistant_targets_list` | 群目标列表 |
| POST | `/api/assistant/targets/sync` | `assistant-target:manage` | `assistant_targets_sync` | 从公司号通讯录同步群 |
| PATCH | `/api/assistant/targets/:id` | `assistant-target:manage` | `assistant_targets_update` | 命名、启用停用 |

### 4.4 模板与策略

| 方法 | 路径 | 权限 | operationId | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/api/assistant/templates` | `assistant-template:read` | `assistant_templates_list` | 模板列表 |
| POST | `/api/assistant/templates` | `assistant-template:update` | `assistant_templates_create` | 新建模板 |
| PATCH | `/api/assistant/templates/:id` | `assistant-template:update` | `assistant_templates_update` | 修改模板，版本号递增 |
| POST | `/api/assistant/templates/:id/preview` | `assistant-template:read` | `assistant_templates_preview` | 用样例变量渲染预览 |
| POST | `/api/assistant/templates/:id/test` | `assistant-template:update` | `assistant_templates_test` | 发给管理员本人，受频率限制 |
| GET | `/api/assistant/policies` | `assistant-policy:read` | `assistant_policies_list` | 事件策略列表 |
| PUT | `/api/assistant/policies/:eventType` | `assistant-policy:update` | `assistant_policies_update` | 修改事件的目标、渠道、TTL、静默时段 |

### 4.5 发送记录与回调

| 方法 | 路径 | 权限 | operationId | 说明 |
| --- | --- | --- | --- | --- |
| GET | `/api/assistant/notifications` | `assistant-notification:read` | `assistant_notifications_list` | 发送记录列表 |
| GET | `/api/assistant/notifications/:id` | `assistant-notification:read` | `assistant_notifications_get` | 详情与逐人投递状态 |
| POST | `/api/assistant/notifications/:id/retry` | `assistant-notification:resend` | `assistant_notifications_retry` | 重试失败投递；过期通知拒绝 |
| POST | `/api/assistant/notifications/:id/cancel` | `assistant-notification:resend` | `assistant_notifications_cancel` | 取消未发送投递 |
| GET | `/api/assistant/callback-events` | `assistant-callback:read` | `assistant_callback_events_list` | 回调记录 |
| GET | `/api/assistant/callback-events/:id` | `assistant-callback:read` | `assistant_callback_events_get` | 回调详情；原始报文脱敏 |

### 4.6 关键响应示例

```json
// GET /api/assistant/overview
{
  "channelEnabled": true,
  "account": {
    "id": "3d0f...",
    "name": "公司号-01",
    "status": "ONLINE",
    "lastOnlineAt": "2026-10-28T02:15:00.000Z"
  },
  "today": { "published": 42, "accepted": 39, "failed": 2, "expired": 1 },
  "queue": { "pending": 0, "oldestPendingAt": null }
}
```

```json
// POST /api/assistant/accounts/:id/login
{
  "accountId": "3d0f...",
  "appId": "wx_wR_U4zPj2M_OTS3BCyoE4",
  "qrImgBase64": "data:image/jpg;base64,...",
  "expiresAt": "2026-10-28T02:20:00.000Z"
}
```

```json
// POST /api/assistant/bindings/codes
{
  "code": "QS-7F3K-9M2P",
  "expiresAt": "2026-10-28T02:30:00.000Z",
  "instructions": "请员工先添加公司号，再向公司号发送：绑定 QS-7F3K-9M2P"
}
```

```json
// GET /api/assistant/notifications/:id
{
  "id": "9a0b...",
  "eventType": "PURCHASE_REVIEW_PENDING",
  "source": { "type": "PURCHASE_ORDER", "id": "6f0d..." },
  "status": "PARTIAL",
  "templateKey": "purchase.review.pending",
  "templateVersion": 3,
  "createdAt": "2026-10-28T02:00:00.000Z",
  "expiresAt": "2026-10-29T02:00:00.000Z",
  "deliveries": [
    {
      "id": "b1...",
      "recipientUserId": "5e2a...",
      "recipientName": "李华",
      "channel": "WECHAT",
      "status": "ACCEPTED",
      "attemptCount": 1,
      "providerMsgId": "376897...",
      "providerNewMsgId": "9154...",
      "sentAt": "2026-10-28T02:00:03.000Z"
    },
    {
      "id": "b2...",
      "recipientUserId": "8c1b...",
      "recipientName": "王强",
      "channel": "WECHAT",
      "status": "FAILED",
      "attemptCount": 3,
      "failureCode": "ACCOUNT_OFFLINE",
      "failureMessage": "公司号离线，通知已过期",
      "sentAt": null
    }
  ]
}
```

## 5. 员工自助接口

仅要求登录，不额外要求管理权限。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/assistant/me/binding` | 查看本人绑定状态、公司号名称、绑定时间、好友状态 |
| POST | `/api/assistant/me/binding/codes` | 生成本人绑定码，10 分钟内有效 |
| DELETE | `/api/assistant/me/binding` | 解绑本人微信 |

响应示例：

```json
// GET /api/assistant/me/binding
{
  "status": "ACTIVE",
  "accountName": "公司号-01",
  "wechatNickname": "李华",
  "boundAt": "2026-10-20T08:00:00.000Z",
  "friendStatus": "NORMAL",
  "lastCheckedAt": "2026-10-28T01:00:00.000Z"
}
```

## 6. 机器回调契约

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
| 绑定码消息 | 校验一次性码，写入绑定，可选回复「绑定成功」 |
| 掉线与登录事件 | 更新账号状态，写审计，触发告警；不改业务数据 |
| 联系人删除事件 | 将对应绑定置为 `INVALID` |
| 其他消息 | 只入库，不触发业务动作 |

回调内容按不可信输入处理：不解析执行、不拼接 SQL、不把报文字段直接用于权限判断。

## 7. 状态与错误码

### 7.1 通知状态

| 状态 | 含义 |
| --- | --- |
| `PENDING` | 已入队，尚未全部处理 |
| `DISPATCHING` | 至少一条投递正在发送 |
| `COMPLETED` | 全部个人/群投递均为 `ACCEPTED` |
| `PARTIAL` | 部分 `ACCEPTED`，部分 `FAILED` / `EXPIRED` / `SKIPPED` |
| `FAILED` | 没有任何 `ACCEPTED`，且存在失败 |
| `SKIPPED` | 全部投递在入队时被跳过 |
| `EXPIRED` | 超过有效期未完成 |
| `CANCELLED` | 管理员取消 |

### 7.2 投递状态

| 状态 | 含义 |
| --- | --- |
| `PENDING` | 等待发送或等待重试 |
| `SENDING` | 正在发送 |
| `ACCEPTED` | GeWe 返回 `ret=200`，只代表请求被接受，不代表已送达 |
| `FAILED` | 重试耗尽或不可重试 |
| `SKIPPED` | 未发送，例如未绑定、用户停用、渠道关闭 |
| `EXPIRED` | 超过有效期 |
| `CANCELLED` | 管理员取消 |

### 7.3 跳过原因

`NOT_BOUND`、`USER_DISABLED`、`NO_RECIPIENT`、`TARGET_DISABLED`、`CHANNEL_DISABLED`、`CHANNEL_NOT_AVAILABLE`、`QUIET_HOURS_EXPIRED`。

### 7.4 失败码

`TEMPLATE_NOT_FOUND`、`TEMPLATE_VARIABLE_MISSING`、`TEMPLATE_TOO_LONG`、`ACCOUNT_OFFLINE`、`ACCOUNT_DISABLED`、`TRANSPORT_TIMEOUT`、`TRANSPORT_ERROR`、`PROVIDER_REJECTED`、`RATE_LIMITED`、`UNKNOWN`。

### 7.5 发布警告

`EVENT_NOT_CONFIGURED`、`TEMPLATE_NOT_FOUND`、`TEMPLATE_VARIABLE_MISSING`、`SENSITIVE_VARIABLE_MASKED`、`NO_RECIPIENT`、`CHANNEL_NOT_AVAILABLE`、`DUPLICATE_IGNORED`。

警告只用于调用方日志与排查，不改变业务事务结果。

## 8. 版本与兼容

- `ASSISTANT_EVENT_TYPES` 只追加，不重命名、不复用已删除的值。
- 模板每次修改递增 `version`；已入队通知保留发布时的模板版本与渲染内容快照。
- 回调同时兼容 v1 与 v2；新增事件类型按「未知事件入库、不影响已支持流程」处理。
- 管理端接口的破坏性变更必须走 OpenAPI 快照与前端类型同步，不允许手改生成文件。
- 内部服务接口与 HTTP 适配层共享同一命令模型；新增字段必须可选，保证旧调用方不受影响。
