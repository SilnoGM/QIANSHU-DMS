# 通知中心数据模型

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档状态 | 设计稿，待 schema 评审；未建表 |
| 关联文档 | [落地设计](./design.md)、[接口契约](./api.md) |
| 适用范围 | 阶段 1 的 Prisma 模型、迁移、权限与审计枚举 |
| 最后更新 | 2026-10-28 |

本文是阶段 1 的逐字段模型。阶段 1 只创建千树小助理真正使用的表；`notification_inbox_items`（阶段 3）与 `assistant_callback_events`（引入回调时）**不在阶段 1 迁移中创建**，字段只在第 8 节冻结，避免空表与无用列。

## 1. 通用约定

- 模型 PascalCase，表名 `@@map` 为 snake_case 复数；字段 camelCase，列 `@map` 为 snake_case。
- 主键统一 `String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`。
- 时间统一 `DateTime @db.Timestamptz(6)`；业务时刻由应用时钟写入，不依赖数据库会话时区。
- 不使用软删除；用 `status` 与时间字段表达生命周期。
- 外键默认 `onDelete: Restrict, onUpdate: Restrict`；只有 `notifications → assistant_deliveries` 允许 `Cascade`，用于保留期清理。
- 部分唯一索引、CHECK 约束 Prisma schema 无法表达，必须在迁移 SQL 中补充；并新增 `notification-schema.spec.ts` 断言约束存在。
- 所有查询使用参数绑定；禁止拼接 SQL、`format` 或字符串模板组装 SQL。

## 2. 枚举

| 枚举 | 值 | 说明 |
| --- | --- | --- |
| `NotificationChannel` | `IN_APP`、`ASSISTANT` | 站内通知 / 千树小助理 |
| `NotificationPriority` | `NORMAL`、`HIGH` | `HIGH` 可突破静默时段 |
| `NotificationStatus` | `PENDING`、`COMPLETED`、`PARTIAL`、`FAILED`、`SKIPPED`、`EXPIRED`、`CANCELLED` | 逻辑通知状态 |
| `NotificationTargetMode` | `COMMAND_TARGET`、`USERS`、`ROLE`、`PERMISSION`、`GROUP` | 渠道策略的目标模式 |
| `NotificationTemplateKind` | `TEXT`、`LINK` | 阶段 1 只用 `TEXT`，`LINK` 预留阶段 2 |
| `AssistantAccountStatus` | `ONLINE`、`OFFLINE`、`REQUIRES_LOGIN`、`DISABLED` | 公司号状态 |
| `AssistantBindingStatus` | `ACTIVE`、`INVALID`、`DISABLED` | 绑定状态 |
| `AssistantDeliveryStatus` | `PENDING`、`SENDING`、`ACCEPTED`、`FAILED`、`SKIPPED`、`EXPIRED`、`CANCELLED` | 站外交付状态 |

阶段 3/回调引入时再新增：`AssistantCallbackVersion`（`V1`、`V2`）、`AssistantCallbackProcessStatus`（`RECEIVED`、`PROCESSED`、`IGNORED`、`FAILED`）。

## 3. 共享表

### 3.1 `notifications`

| 字段 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `eventType` | varchar(64) | 否 | — | 事件类型，对应 `NOTIFICATION_EVENT_TYPES` |
| `sourceType` | varchar(64) | 否 | — | 业务对象类型，如 `PURCHASE_ORDER` |
| `sourceId` | varchar(128) | 否 | — | 业务对象 ID |
| `dedupeKey` | varchar(200) | 否 | — | 幂等键，全局唯一 |
| `priority` | `NotificationPriority` | 否 | `NORMAL` | 优先级 |
| `status` | `NotificationStatus` | 否 | `PENDING` | 通知状态 |
| `templateKey` | varchar(64) | 否 | — | 逻辑模板键 |
| `requestedChannels` | jsonb | 否 | `[]` | 发布时请求的渠道快照 |
| `variables` | jsonb | 否 | `{}` | 变量快照，敏感字段按策略脱敏 |
| `expiresAt` | timestamptz(6) | 是 | `null` | 只约束站外交付；站内不因过期删除 |
| `publishedAt` | timestamptz(6) | 否 | `now()` | 入队时间 |
| `completedAt` | timestamptz(6) | 是 | `null` | 全部渠道终态时间 |
| `requestedByUserId` | uuid | 是 | `null` | 触发人；FK `users(id)` |
| `createdAt` | timestamptz(6) | 否 | `now()` | — |
| `updatedAt` | timestamptz(6) | 否 | `now()` | — |

索引与约束：

- 唯一 `dedupeKey`。
- `(eventType, publishedAt DESC)`、`(sourceType, sourceId)`、`(status, expiresAt)`。
- CHECK：`jsonb_typeof(requestedChannels) = 'array'`、`jsonb_typeof(variables) = 'object'`。

### 3.2 `notification_templates`

| 字段 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `key` | varchar(64) | 否 | — | 逻辑模板键 |
| `channel` | `NotificationChannel` | 否 | — | 每个渠道一份 |
| `name` | varchar(128) | 否 | — | 管理端显示名 |
| `messageKind` | `NotificationTemplateKind` | 否 | `TEXT` | 阶段 1 只用 `TEXT` |
| `titleTemplate` | text | 是 | `null` | `LINK` 用 |
| `bodyTemplate` | text | 否 | — | 正文 |
| `linkUrlTemplate` | text | 是 | `null` | `LINK` 用 |
| `variables` | jsonb | 否 | `[]` | 变量白名单：`[{name, required, maxLength, sensitive}]` |
| `maxLength` | int | 否 | `2000` | 渲染后上限 |
| `enabled` | boolean | 否 | `true` | — |
| `version` | int | 否 | `1` | 每次修改递增 |
| `createdByUserId` | uuid | 是 | `null` | FK `users(id)` |
| `updatedByUserId` | uuid | 是 | `null` | FK `users(id)` |
| `createdAt` / `updatedAt` | timestamptz(6) | 否 | `now()` | — |

索引与约束：

- 唯一 `(key, channel)`。
- `(channel, enabled)`。
- CHECK：`maxLength BETWEEN 1 AND 5000`。
- CHECK：`messageKind = 'LINK'` 时 `linkUrlTemplate IS NOT NULL`。

### 3.3 `notification_channel_policies`

| 字段 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `eventType` | varchar(64) | 否 | — | 事件 |
| `channel` | `NotificationChannel` | 否 | — | 渠道 |
| `targetMode` | `NotificationTargetMode` | 否 | `COMMAND_TARGET` | 目标模式 |
| `targetConfig` | jsonb | 否 | `{}` | `userIds` / `roleCodes` / `permissionCode` / `targetKeys` |
| `templateKey` | varchar(64) | 是 | `null` | 可选默认模板键 |
| `priority` | `NotificationPriority` | 否 | `NORMAL` | — |
| `ttlSeconds` | int | 是 | `null` | `ASSISTANT` 必填，`IN_APP` 必须为空 |
| `quietHours` | jsonb | 是 | `null` | `{start,end,timezone}`；`IN_APP` 必须为空 |
| `allowSensitive` | boolean | 否 | `false` | 是否允许金额/客户名称 |
| `enabled` | boolean | 否 | `true` | — |
| `version` | int | 否 | `1` | — |
| `updatedByUserId` | uuid | 是 | `null` | FK `users(id)` |
| `createdAt` / `updatedAt` | timestamptz(6) | 否 | `now()` | — |

索引与约束：

- 唯一 `(eventType, channel)`。
- `(channel, enabled)`。
- CHECK：`channel = 'IN_APP'` 时 `targetMode <> 'GROUP'`、`ttlSeconds IS NULL`、`quietHours IS NULL`。
- CHECK：`channel = 'ASSISTANT'` 时 `ttlSeconds BETWEEN 60 AND 604800`。
- CHECK：`targetMode = 'GROUP'` 时 `channel = 'ASSISTANT'`。
- `targetConfig` 的具体形状由服务层校验，数据库只保证是 object。

### 3.4 `notification_settings`

单例表，只保留阶段 1 需要的保留期；回调/站内的保留期在对应阶段再加列。

| 字段 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | varchar(32) | 否 | `'default'` | 主键 |
| `notificationRetentionDays` | int | 否 | `180` | 逻辑通知保留期 |
| `deliveryRetentionDays` | int | 否 | `90` | 站外交付保留期 |
| `version` | int | 否 | `1` | 乐观锁 |
| `updatedByUserId` | uuid | 是 | `null` | FK `users(id)` |
| `updatedAt` | timestamptz(6) | 否 | `now()` | — |

CHECK：两个保留期都在 `7..3650`。

### 3.5 `notification_channel_settings`

| 字段 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `channel` | `NotificationChannel` | 否 | — | 主键 |
| `enabled` | boolean | 否 | `false` | 渠道总开关 |
| `defaultQuietHours` | jsonb | 是 | `null` | `{start,end,timezone}` |
| `version` | int | 否 | `1` | 乐观锁 |
| `updatedByUserId` | uuid | 是 | `null` | FK `users(id)` |
| `updatedAt` | timestamptz(6) | 否 | `now()` | — |

阶段 1 只插入 `ASSISTANT` 一行，`enabled = false`、默认静默 `20:00–08:00 Asia/Shanghai`；`IN_APP` 行在阶段 3 插入。

## 4. 千树小助理表

### 4.1 `assistant_accounts`

| 字段 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `name` | varchar(64) | 否 | — | 管理端备注名，如 `公司号-01` |
| `appId` | varchar(128) | 否 | — | GeWe 设备 ID，唯一 |
| `wxid` | varchar(128) | 是 | `null` | 登录后回填 |
| `nickname` | varchar(128) | 是 | `null` | 微信昵称 |
| `avatarUrl` | text | 是 | `null` | 头像 |
| `status` | `AssistantAccountStatus` | 否 | `OFFLINE` | 在线状态 |
| `regionId` | varchar(16) | 是 | `null` | 登录区域 |
| `proxyIpEncrypted` | text | 是 | `null` | 代理，含凭据时加密存储 |
| `enabled` | boolean | 否 | `true` | 是否允许派发 |
| `lastOnlineAt` | timestamptz(6) | 是 | `null` | 最近在线 |
| `lastLoginAt` | timestamptz(6) | 是 | `null` | 最近登录 |
| `lastErrorCode` | varchar(64) | 是 | `null` | 最近错误码 |
| `lastErrorMessage` | varchar(255) | 是 | `null` | 最近错误摘要 |
| `version` | int | 否 | `1` | — |
| `createdAt` / `updatedAt` | timestamptz(6) | 否 | `now()` | — |

索引：唯一 `appId`，`(status, enabled)`。

### 4.2 `assistant_bindings`

| 字段 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `userId` | uuid | 否 | — | FK `users(id)` |
| `accountId` | uuid | 否 | — | FK `assistant_accounts(id)` |
| `wxid` | varchar(128) | 否 | — | 员工微信 ID |
| `wechatNickname` | varchar(128) | 是 | `null` | 展示用 |
| `status` | `AssistantBindingStatus` | 否 | `ACTIVE` | — |
| `boundByUserId` | uuid | 否 | — | 管理员，FK `users(id)` |
| `verifiedAt` | timestamptz(6) | 是 | `null` | 测试消息确认时间 |
| `verifiedByUserId` | uuid | 是 | `null` | 确认管理员，FK `users(id)` |
| `friendCheckedAt` | timestamptz(6) | 是 | `null` | 最近好友巡检 |
| `boundAt` | timestamptz(6) | 否 | `now()` | — |
| `updatedAt` | timestamptz(6) | 否 | `now()` | — |

索引与约束：

- 唯一 `(userId, accountId)`、`(accountId, wxid)`。
- `(status)`、`(userId)`。
- CHECK：`(verifiedAt IS NULL) = (verifiedByUserId IS NULL)`。
- 只有 `status = 'ACTIVE' AND verifiedAt IS NOT NULL` 的绑定允许 1:1 发送；尤其是 `allowSensitive = true` 的事件，服务层必须强制。

### 4.3 `assistant_targets`

| 字段 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `key` | varchar(64) | 否 | — | 业务 key，如 `finance` |
| `chatroomId` | varchar(128) | 否 | — | `xxx@chatroom` |
| `name` | varchar(128) | 否 | — | 群名 |
| `purpose` | varchar(255) | 是 | `null` | 用途 |
| `internalOnly` | boolean | 否 | `false` | 是否纯内部成员 |
| `memberCount` | int | 是 | `null` | 同步到的成员数 |
| `enabled` | boolean | 否 | `true` | — |
| `lastSyncedAt` | timestamptz(6) | 是 | `null` | — |
| `createdAt` / `updatedAt` | timestamptz(6) | 否 | `now()` | — |

索引：唯一 `key`、`chatroomId`；`(enabled, internalOnly)`；CHECK `memberCount IS NULL OR memberCount >= 0`。

### 4.4 `assistant_deliveries`

| 字段 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `notificationId` | uuid | 否 | — | FK `notifications(id)`，`onDelete: Cascade` |
| `recipientUserId` | uuid | 是 | `null` | 1:1 收件人，FK `users(id)` |
| `targetId` | uuid | 是 | `null` | 群目标，FK `assistant_targets(id)` |
| `accountId` | uuid | 是 | `null` | 发送账号，FK `assistant_accounts(id)` |
| `status` | `AssistantDeliveryStatus` | 否 | `PENDING` | — |
| `attemptCount` | int | 否 | `0` | — |
| `nextAttemptAt` | timestamptz(6) | 否 | `now()` | 下次尝试 |
| `templateVersion` | int | 否 | — | 发布时模板版本 |
| `renderedContent` | text | 否 | — | 渲染快照，可能含金额/客户名称 |
| `providerMsgId` | varchar(64) | 是 | `null` | GeWe `msgId` |
| `providerNewMsgId` | varchar(64) | 是 | `null` | GeWe `newMsgId` |
| `failureCode` | varchar(64) | 是 | `null` | — |
| `failureMessage` | varchar(255) | 是 | `null` | — |
| `acceptedAt` | timestamptz(6) | 是 | `null` | GeWe 接受时间 |
| `createdAt` / `updatedAt` | timestamptz(6) | 否 | `now()` | — |

索引与约束：

- CHECK：`(recipientUserId IS NOT NULL) <> (targetId IS NOT NULL)`，一条交付只能是个人或群。
- CHECK：`attemptCount >= 0`。
- CHECK：`status = 'ACCEPTED'` 时 `acceptedAt IS NOT NULL`。
- 部分唯一：`(notificationId, recipientUserId) WHERE recipientUserId IS NOT NULL`。
- 部分唯一：`(notificationId, targetId) WHERE targetId IS NOT NULL`。
- 派发索引：`(status, nextAttemptAt)`。
- 查询索引：`(accountId, status)`、`(recipientUserId, createdAt DESC)`、`(targetId, createdAt DESC)`。

部分唯一索引必须写在迁移 SQL 中，Prisma schema 只声明普通索引。

### 4.5 `assistant_dispatch_leases`

| 字段 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | varchar(64) | 否 | — | 主键，固定 `assistant-dispatch` |
| `ownerId` | uuid | 是 | `null` | 当前持有派发权的实例 |
| `expiresAt` | timestamptz(6) | 是 | `null` | 租约到期 |
| `updatedAt` | timestamptz(6) | 否 | `now()` | 心跳时间 |

迁移时插入一行：`INSERT INTO assistant_dispatch_leases (id) VALUES ('assistant-dispatch') ON CONFLICT DO NOTHING`。

## 5. 阶段 3 / 回调预留表

以下表**不在阶段 1 迁移中创建**。

### 5.1 `notification_inbox_items`（阶段 3）

`id`、`notificationId`、`userId`、`templateVersion`、`titleSnapshot`、`bodySnapshot`、`linkUrlSnapshot`、`readAt`、`archivedAt`、`createdAt`。

- 唯一 `(notificationId, userId)`。
- 索引 `(userId, archivedAt, createdAt DESC)`。
- 没有投递状态枚举；未读 = `readAt IS NULL AND archivedAt IS NULL`。

### 5.2 `assistant_callback_events`（回调引入时）

`id`、`appId`、`version`、`kind`、`providerMsgId`、`providerNewMsgId`、`dedupeKey`、`rawPayload`、`processStatus`、`processError`、`receivedAt`、`processedAt`。

- 唯一 `dedupeKey`（`appId + ':' + providerNewMsgId`）。
- 索引 `(receivedAt DESC)`、`(processStatus)`。
- 原始报文保留 30 天，`content` 查看时脱敏。

## 6. 权限迁移

新增 15 个权限码，`system_only = true`，并授予 `system_admin`：

```text
notification-template:read
notification-template:update
notification-policy:read
notification-policy:update
notification-record:read
notification-record:manage
assistant-channel:read
assistant-channel:update
assistant-account:read
assistant-account:operate
assistant-binding:read
assistant-binding:manage
assistant-target:read
assistant-target:manage
assistant-delivery:resend
```

`assistant-callback:read` 在引入回调时新增，阶段 1 不插入。

迁移写法沿用现有模式：`INSERT INTO permissions(...)`，再 `INSERT INTO role_permissions(...) SELECT ... WHERE role.code = 'system_admin'`。同时更新 `permission.constants.ts` 与权限一致性测试。

## 7. 审计枚举

`AuditEventType` 新增：

```text
NOTIFICATION_TEMPLATE_UPDATED
NOTIFICATION_POLICY_UPDATED
NOTIFICATION_CANCELLED
ASSISTANT_CHANNEL_UPDATED
ASSISTANT_CHANNEL_ENABLED
ASSISTANT_CHANNEL_DISABLED
ASSISTANT_ACCOUNT_LOGIN_STARTED
ASSISTANT_ACCOUNT_LOGGED_IN
ASSISTANT_ACCOUNT_LOGGED_OUT
ASSISTANT_ACCOUNT_RECONNECTED
ASSISTANT_BINDING_CREATED
ASSISTANT_BINDING_VERIFIED
ASSISTANT_BINDING_REVOKED
ASSISTANT_BINDING_INVALIDATED
ASSISTANT_DELIVERY_RESENT
```

注意：

- PostgreSQL 的 `ALTER TYPE ... ADD VALUE` 与事务存在版本差异；按仓库现有迁移方式处理，必要时拆成独立迁移。
- 审计元数据不写消息正文、金额、客户名称、Token、完整 `wxid`。
- 回调引入后再新增 `ASSISTANT_CALLBACK_*` 事件。

## 8. 迁移顺序

1. 创建枚举（`notification_*`、`assistant_*`）。
2. 创建共享表：`notifications`、`notification_templates`、`notification_channel_policies`、`notification_settings`、`notification_channel_settings`。
3. 创建渠道表：`assistant_accounts`、`assistant_bindings`、`assistant_targets`、`assistant_deliveries`、`assistant_dispatch_leases`。
4. 补充 CHECK、部分唯一索引、普通索引。
5. 插入种子：`notification_settings` 单例、`notification_channel_settings` 的 `ASSISTANT` 行、`assistant_dispatch_leases` 单行。
6. 权限迁移（可独立文件）。
7. 审计枚举迁移（可独立文件，先于使用它的代码）。
8. 用隔离 schema 重放全部迁移，再跑 `prisma migrate status`。

没有历史数据回填；全部是新增表，迁移可向前执行，不需要数据修复。

## 9. 保留期与清理

`server/src/commands/notification-operations.ts cleanup` 每日执行：

1. 删除超过 `deliveryRetentionDays` 的 `assistant_deliveries`。
2. 删除超过 `notificationRetentionDays` 且没有未完成交付的 `notifications`。
3. 回调引入后删除超过 30 天的 `assistant_callback_events`。
4. 阶段 3 的 `notification_inbox_items` 按用户归档或 1 年清理。

实现要求：

- 分批删除（按 `ctid` 或主键分页），避免长事务与长时间锁表。
- 所有参数使用绑定变量，不拼接 SQL。
- 清理命令幂等，可重复执行；失败只记录日志，不阻断服务。
- 保留期读取 `notification_settings`，并受下限约束（投递 ≥30 天）。

## 10. Schema 验收清单

- [ ] `prisma validate` 通过。
- [ ] 隔离 schema 重放全部迁移成功。
- [ ] 唯一索引、部分唯一索引、CHECK 均存在，`notification-schema.spec.ts` 断言通过。
- [ ] 15 个权限码与 `system_admin` 授权存在，权限一致性测试通过。
- [ ] `AuditEventType` 新值存在，审计写入测试通过。
- [ ] `notification_channel_settings` 只有 `ASSISTANT` 行，`enabled = false`。
- [ ] `assistant_dispatch_leases` 有 `assistant-dispatch` 单行。
- [ ] 没有创建 `notification_inbox_items` 与 `assistant_callback_events`。
