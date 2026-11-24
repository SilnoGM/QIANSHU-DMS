# 企业微信通知渠道（WECOM）定稿设计

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档状态 | 一期服务端核心、管理端页面、文本/图片投递与通知记录已实施，真实 API 与 DMS 全链路 POC 已通过；页面验收未完成 |
| 适用范围 | 在现有 `IN_APP`、`ASSISTANT` 之外新增独立渠道 `WECOM`；一期单应用，数据模型按多应用预留 |
| 真相源 | 本文与现有[通知中心文档](./README.md)；冲突时以本文的 WECOM 决策为准 |
| 关联文档 | [落地设计](./design.md)、[接口契约](./api.md)、[数据模型](./data-model.md)、[运维手册](./runbook.md)、[部署清单](./deployment.md) |
| 最后更新 | 2026-11-24 |

> 2026-11-24 实施进展：已完成 WECOM 渠道枚举与约束、8 张新表、`max_bytes`、权限/审计、默认应用、配置/Secret/token、应用与群机器人 text/image 传输、派发 worker、publish 文本与图片分支、群 @，以及管理端 API/页面（渠道开关、应用/Secret/事件分配、绑定/成员、群目标）。真实 API 与隔离测试库全链路 POC（应用/群、文本/图片/@）已通过；模板/策略种子、部署与页面验收未完成。详见第 17 节。

## 1. 结论

新增独立渠道 `WECOM`，保留 `ASSISTANT`（GeWe）不变：

| 渠道 | 定位 | 本次状态 |
| --- | --- | --- |
| `IN_APP` | 站内收件箱，登录后可见 | 保留，作为兜底 |
| `ASSISTANT` | GeWe 个人微信通知 | 暂时保留，逐步缩小到未迁移事件/外部场景 |
| `WECOM` | 企业微信应用消息 + 内部群机器人 | 新增，内部员工专用 |

WECOM 只覆盖：

- 员工 1:1 应用消息，经企业微信客户端或微信插件接收；
- 公司内部群机器人消息；
- 文本、图片、链接、模板、策略、静默时段、TTL、重试、免打扰、发送记录；
- 多应用预留：一期只建“千树 DMS”，二期可在 DMS 后台手动添加应用并分配事件。

WECOM 明确不做：

- 外部微信个人/客户群/客户群发；
- 微信客服；
- 入站消息、自动回复、群指令；
- 智能助理连接器/MCP；
- 多企业租户、跨企业互联群；
- 已读回执。

### 1.1 关键决策记录

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 渠道形态 | 独立 `WECOM` 渠道，不做 `ASSISTANT` provider |
| 2 | 一期应用 | 单应用，默认名称“千树 DMS”，`key=default` |
| 3 | 多应用 | 数据模型按多应用预留；二期由管理员在 DMS 后台手动添加 |
| 4 | 事件分配 | 在 DMS 应用详情中配置该应用承担的事件；一个事件只能属于一个应用 |
| 5 | 事件范围 | 沿用当前 44 个事件；应用事件选择不做业务域分组，平铺多选 |
| 6 | 可见范围 | 各应用可见范围可不同；DMS 使用应用级成员关系校验 |
| 7 | 可见范围同步 | 二期通过企业微信 `agent/get` 同步，先 dry-run 再确认 |
| 8 | 应用 Secret | 加密入库，后台维护；加密密钥 `WECOM_APP_SECRET_KEY` 放环境变量 |
| 9 | 模板 | WECOM 使用独立渠道模板；应用消息与群消息共用同一份纯文本模板 |
| 10 | 字节限制 | `notification_templates` 新增 `max_bytes`；WECOM 共用模板默认 2048 字节 |
| 11 | 长内容 | 摘要 + 详情链接/图片；长明细留在站内或业务详情页 |
| 12 | 图片 | 群图片先压缩到 2MB 内；仍超限改发文件 |
| 13 | @ 功能 | 仅群机器人 text 支持；支持 `@all` 与 `@指定成员`；模板正文不写 @ |
| 14 | 与 GeWe 关系 | 暂时保留；按事件切换，不自动双发/不自动降级 |
| 15 | 双渠道对照 | 允许同一事件短期限时同时开 `ASSISTANT` 与 `WECOM` |
| 16 | 外部场景 | WECOM 不覆盖外部微信个人/外部群 |

## 2. 目标与非目标

### 2.1 目标

1. 让内部员工在个人微信（微信插件）或企业微信客户端收到业务通知。
2. 让财务/运营等内部群通过群机器人收到通知。
3. 复用现有通知域：模板、策略、静默、TTL、优先级、免打扰、去重、记录。
4. 支持按事件逐步从 GeWe 迁移到 WECOM。
5. 数据模型从第一天支持多应用，避免二期重构。
6. 内容、密钥、成员、事件路由都可管理端维护。

### 2.2 非目标

1. 替代客户群/外部微信通知。
2. 替代微信客服。
3. 做双向聊天机器人。
4. 接入 MCP/智能助理连接器。
5. 做已读回执或送达证明。
6. 本期实现同事件多应用 fan-out。

## 3. 现状与边界

### 3.1 现有通知域

- 事件目录共 44 个事件类型，定义在 `server/src/modules/notifications/notification.types.ts`。
- 现有渠道枚举只有 `IN_APP`、`ASSISTANT`。
- `ASSISTANT` 由 GeWe 个人号发送，已有账号、绑定、群目标、投递、重试、发送闸门、管理端页面。
- 站内 `IN_APP` 已独立运行，是天然兜底。
- 当前没有入站回调，没有自动回复；小助理是单向通知通道。

### 3.2 企业微信能力边界

| 能力 | 事实 |
| --- | --- |
| 应用消息接收人 | 仅企业成员/部门/标签，不能直接发给外部微信用户 |
| 应用消息文本 | 2048 字节，超出官方截断 |
| 应用消息图片 | 临时素材 `media_id`，图片 ≤10MB，`media_id` 3 天有效 |
| 应用消息频率 | 同一成员 30 次/分钟、1000 次/小时；每应用每天上限 = 可见成员数 × 200 |
| 微信插件 | 成员关注后可在个人微信接收应用消息；邀请二维码 7 天有效；有多个成员侧开关 |
| 群机器人 | 仅内部群；text 2048 字节、markdown 4096 字节、图片 base64 前 ≤2MB、文件 ≤20MB；每机器人 20 条/分钟 |
| 外部群/客户群 | 群机器人不支持；应用消息不能进外部群 |
| 多个自建应用 | 每企业最多 300 个应用；每月创建次数 ≤900；应用名称 ≤32 字符；每个应用独立可见范围 |
| 微信插件入口 | 消息页只显示发过消息的应用；通讯录页显示可见范围内全部应用 |

### 3.3 24 人规模核算

- 单应用每天上限：24 × 200 = **4,800 人次/天**。
- 按 100 个事件/天、每个事件 5 个收件人计算约 500 人次/天，余量充足。
- 单成员 30 次/分钟、1000 次/小时，远高于日常。
- 群机器人 20 条/分钟是更紧的约束；多应用不能提高群机器人频率，必要时拆群/拆机器人。

## 4. 总体架构

```text
业务模块 publish()
  → notifications（逻辑通知）
  → 按 event × channel 选策略
      ├─ IN_APP    → notification_inbox_items
      ├─ ASSISTANT → assistant_deliveries → GeWe HTTP
      └─ WECOM     → wecom_deliveries
                       ├─ 1:1 → message/send（应用消息）
                       └─ 群  → webhook/send（群机器人）
```

WECOM 与现有渠道共用：

- 事件目录与事件契约；
- 模板变量、渲染器、敏感变量规则；
- 静默时段、TTL、优先级、去重；
- 个人免打扰；
- 通知记录与审计框架。

WECOM 独立拥有：

- 应用配置、Secret、access_token；
- 事件 → 应用路由；
- 应用级成员关系；
- 群机器人目标；
- 投递表、附件表、租约；
- 传输层、限流、错误映射；
- 应用消息与群消息的内容适配。

## 5. 渠道模型

### 5.1 渠道枚举

在 `notification_channel` 增加 `WECOM`。

现有数据库约束必须同步修改：

- `notification_channel_policies_channel_shape_check`：增加 WECOM 分支，允许 `ttl_seconds BETWEEN 60 AND 604800`；
- `notification_channel_policies_group_channel_check`：`GROUP` 允许 `ASSISTANT` 或 `WECOM`。

注意：PostgreSQL 的 `ALTER TYPE ... ADD VALUE` 不能在同一个事务里立刻使用新值，枚举新增与使用该值的迁移必须拆分。

### 5.2 渠道设置与个人免打扰

- `notification_channel_settings` 增加 `WECOM` 行，默认 `enabled=false`，默认静默时段建议 `20:00–08:00`。
- `notification_user_mutes` 渠道枚举增加 `WECOM`，用户可单独关闭企业微信通知。
- 发布期与派发期都要读取个人免打扰，和现有 `ASSISTANT` 一样做二次过滤。

### 5.3 模板与策略

- `notification_templates` 增加 `WECOM` 行，靠 `(key, channel)` 唯一约束区分。
- `notification_channel_policies` 增加 `WECOM` 行，复用 `COMMAND_TARGET`/`USERS`/`ROLE`/`PERMISSION`/`GROUP`。
- 缺少 WECOM 模板或策略未启用时，该渠道 `SKIPPED / CHANNEL_NOT_CONFIGURED`，不影响其他渠道。

## 6. 多应用模型

### 6.1 `wecom_apps`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `key` | VARCHAR(32) | 应用语义键，唯一，创建后不可变；一期为 `default` |
| `name` | VARCHAR(32) | 应用名称，对应企业微信应用名称 |
| `corp_id` | VARCHAR(64) | 企业 ID |
| `agent_id` | INTEGER | 应用 AgentId |
| `secret_encrypted` | TEXT | AES-256-GCM 密文；可为空，未配置时渠道不可用 |
| `secret_updated_at` | TIMESTAMPTZ | Secret 最后更新时间 |
| `secret_updated_by_user_id` | UUID | 最后更新人 |
| `is_default` | BOOLEAN | 默认应用；部分唯一索引保证只有一个 |
| `enabled` | BOOLEAN | 是否允许发送 |
| `status` | ENUM | `PENDING` / `ACTIVE` / `INVALID` / `DISABLED` |
| `last_checked_at` | TIMESTAMPTZ | 最近一次 token/应用检查 |
| `last_error_code` | VARCHAR(64) | 最近错误码 |
| `last_error_message` | VARCHAR(255) | 最近错误摘要 |
| `version` | INTEGER | 乐观锁 |
| `created_at` / `updated_at` | TIMESTAMPTZ | 时间 |

约束：

- `key` 唯一；
- `(corp_id, agent_id)` 唯一；
- `is_default=true` 部分唯一索引；
- 不允许删除已被投递记录引用的应用；只允许停用。

### 6.2 一期默认应用

```text
key: default
name: 千树 DMS
is_default: true
enabled: false
```

一期只建这一行。管理员在 DMS 后台录入 `corp_id`、`agent_id`、`secret`，DMS 加密入库并调用一次 `gettoken` 验证，验证通过后启用。

### 6.3 事件 → 应用路由

新增 `wecom_app_event_routes`：

| 字段 | 说明 |
| --- | --- |
| `app_id` | 承担该事件的应用 |
| `event_type` | 事件类型，**唯一** |
| `enabled` | 路由开关 |
| `updated_by_user_id` | 最后修改人 |
| `created_at` / `updated_at` | 时间 |

规则：

1. 事件有路由且应用 `enabled` → 使用该应用；
2. 事件有路由但应用停用 → `SKIPPED / APP_DISABLED`，**不静默回退默认应用**；
3. 事件无路由 → 使用 `is_default=true` 的应用；
4. 无路由且默认应用不可用 → `SKIPPED / APP_NOT_CONFIGURED`；
5. 一个事件只能属于一个应用；保存冲突返回明确错误并提示占用应用；
6. `targetMode=GROUP` 时忽略应用路由，由群机器人发送。

管理端：

- 应用详情增加“承担事件”Tab；
- 平铺展示当前 44 个事件，不做业务域分组；
- 支持搜索、全选、清空；
- 显示事件当前策略状态（未配置/1:1/群目标/已停用）；
- 群目标事件显示“群机器人发送，不使用应用”；
- 策略页只读展示“该事件将使用应用：千树 DMS / 千树财务”。

### 6.4 全局绑定与应用级成员

`wecom_bindings`（全局身份）：

| 字段 | 说明 |
| --- | --- |
| `user_id` | DMS 用户，唯一 |
| `wecom_user_id` | 企业微信 userid，唯一 |
| `display_name` | 企业微信显示名快照，可空 |
| `status` | `ACTIVE` / `INVALID` / `DISABLED` |
| `bound_by_user_id` | 绑定人 |
| `verified_at` / `verified_by_user_id` | 测试消息确认 |
| `last_test_sent_at` | 最近测试发送 |
| `version` | 乐观锁 |
| `created_at` / `updated_at` | 时间 |

`wecom_app_memberships`（应用级可见/验证）：

| 字段 | 说明 |
| --- | --- |
| `app_id` | 应用 |
| `user_id` | DMS 用户 |
| `status` | `ACTIVE` / `INVALID` / `DISABLED` |
| `source` | `MANUAL` / `AGENT_GET` |
| `verified_at` / `verified_by_user_id` | 该应用测试消息确认 |
| `last_test_sent_at` | 最近测试发送 |
| `last_synced_at` | 最近同步时间 |
| `created_at` / `updated_at` | 时间 |

唯一键：`(app_id, user_id)`。

发送校验：

- 全局绑定 `ACTIVE` 且有 `wecom_user_id`；
- 该应用 membership `ACTIVE` 且 `verified_at` 非空；
- 否则 `SKIPPED`，原因分别为 `NOT_BOUND`、`NOT_VERIFIED`、`NOT_IN_APP_SCOPE`。

`81013` 处理：

- 标记该 `app_id + user_id` 的 membership 为 `INVALID`；
- 不把全局绑定置为失效；
- 记录失败原因并提示“该员工不在本应用可见范围”。

一期 24 人：

- 一期只有默认应用，创建绑定后自动创建默认应用 membership；
- 测试发送通过后同时写全局与应用级 `verified_at`；
- 管理端可批量添加/移除成员。

### 6.5 应用 Secret

存储：

- `wecom_apps.secret_encrypted`，格式 `v1.<iv>.<tag>.<ciphertext>`；
- AES-256-GCM；
- 加密密钥来自 `WECOM_APP_SECRET_KEY`（base64url 32 字节），只放环境变量/密钥服务；
- 不落库、不写日志、不返回前端。

管理端：

- 新增/重置 Secret 使用单独接口；
- `GET` 只返回 `hasSecret`；
- 重置后清空该应用 token 缓存；
- 写审计，不记录 Secret 值。

Token：

- 按 `app_id` 缓存；
- 有效期 7200 秒，提前 300 秒刷新；
- 单飞刷新；
- `40001/42001` 刷新后重试一次；
- Secret 更新或应用停用立即失效缓存。

### 6.6 二期手动新增应用

二期由管理员在 DMS 后台手动添加：

1. 先在企业微信后台创建自建应用，设置名称/logo/可见范围/API 权限/可信 IP；
2. 在 DMS 应用管理点“新增应用”，录入 `key`、`name`、`corp_id`、`agent_id`、`secret`；
3. DMS 加密入库并调用 `gettoken` 验证；
4. 在“承担事件”里勾选该应用负责的事件；
5. 在“可见成员”里添加成员，或使用 `agent/get` 同步。

DMS 不调用企业微信接口创建应用，只做配置登记和验证。

### 6.7 二期 `agent/get` 同步

新增 `POST /api/notifications/wecom/apps/:id/sync-scope`：

1. 用该应用 Secret 取 token；
2. 调 `agent/get?agentid=...`；
3. 解析 `allow_userinfos.user[].userid`、`allow_partys.partyid`、`allow_tags.tagid`；
4. 对显式 userid 生成新增/移除预览；
5. 管理员确认后 upsert membership；
6. 对部门/标签：
   - `agent/get` 只返回部门/标签 ID，不一定能展开成员；
   - 显示“需通讯录权限或人工维护”；
   - 不因为无法展开而自动删除已有 membership。

安全规则：

- 先 dry-run，再确认；
- 不自动删除未返回成员，除非管理员明确选择“全量覆盖”；
- 审计记录应用、新增数、移除数、操作人；
- 不在日志中输出 userid 列表。

建议二期把应用可见范围尽量配置为具体人员，而不是部门/标签，这样 `agent/get` 同步最完整。

## 7. 消息内容与模板

### 7.1 WECOM 模板

WECOM 使用独立渠道模板：

- `NotificationTemplate(key, channel='WECOM')`；
- 字段沿用 `title_template`、`body_template`、`link_url_template`、`variables`、`media_policy`、`max_length`、`version`；
- 新增 `max_bytes`。

`max_bytes`：

| 项目 | 规则 |
| --- | --- |
| 字段 | `notification_templates.max_bytes INTEGER NULL` |
| 校验 | `NULL` 或 `1–4096` |
| IN_APP/ASSISTANT | 保持 `NULL`，继续用 `max_length` 字符限制 |
| WECOM | 默认 `2048`，共用模板必须设置 |
| 保存 | 用示例变量渲染，统计 `title + body + link` 的 UTF-8 字节数，超限拒绝 |
| 发布 | 用真实变量再统计一次，超限 `SKIPPED / TEXT_TOO_LONG`，不截断 |
| 管理端 | 显示“已用 X / max_bytes 字节”，中文/emoji/URL 按 UTF-8 实际字节 |

`max_length` 与 `max_bytes` 同时校验，谁先命中谁生效。

### 7.2 应用消息与群消息共用同一份模板

共用模板使用两者的共同子集：

```text
纯文本 + 换行 + 普通 URL + 图片附件
```

不使用：

- markdown（应用侧微信插件不支持，群侧语法也不同）；
- textcard/mpnews/miniprogram_notice（应用专属，群不支持）；
- template_card（两端结构不同）；
- HTML `<a>`（应用支持，但群机器人和微信插件兼容性需实测；统一 plain URL）；
- @（群机器人用发送参数，不写正文）。

### 7.3 应用消息与群消息能力对比

| 能力 | 应用消息 | 群机器人 | 共用模板 |
| --- | --- | --- | --- |
| text | ✅ 2048 字节 | ✅ 2048 字节 | ✅ |
| image | ✅ `media_id`，≤10MB | ✅ base64，≤2MB | ✅ 附件 |
| file | ✅ ≤20MB | ✅ ≤20MB | 🟡 少用 |
| news | ✅ | ✅ | 🟡 卡片，需 POC |
| textcard | ✅ 标题 128、描述 512、URL、按钮文字 | ❌ | ❌ 应用专属 |
| mpnews | ✅ | ❌ | ❌ 应用专属 |
| miniprogram_notice | ✅ | ❌ | ❌ 应用专属 |
| markdown | ✅ 2048 字节，微信插件不支持 | ✅ 4096 字节，受限语法、颜色、@ | ❌ |
| markdown_v2 | ❌ | ✅ 4096 字节，表格/列表等，无颜色/@ | ❌ |
| template_card | ✅ 可交互 | ✅ 文本通知/图文展示 | ❌ 结构不同 |
| voice | ❌ | ✅ AMR ≤2MB/60s | ❌ |
| @成员 | ❌ | ✅ text `mentioned_list` | ❌ 发送参数 |

结论：一期共用模板只做 text + image + URL，不引入类型特有结构。

### 7.4 长内容策略

WECOM 模板统一为摘要：

```text
【千树 DMS】采购单 {{orderNo}} 已审核通过
供货方：{{vendorName}}
金额：{{currencyCode}} {{totalAmount}}
详情：{{linkUrl}}
```

长明细（`productLines`、`partMarks`、`orderRemark`）留在：

- 站内通知详情；
- DMS 业务详情页；
- 采购单图片/发票照片等附件。

建议正文控制在 1500 字节以内，给链接和变量留余量。

### 7.5 模板缺失与回退

- WECOM 模板不存在或 `enabled=false` → `SKIPPED / CHANNEL_NOT_CONFIGURED`；
- 不回退到 ASSISTANT 模板，避免长文本被 WECOM 截断；
- 其他渠道继续正常发送；
- 管理端事件配置页提示“WECOM 模板未配置”。

### 7.6 图片与压缩

应用消息 1:1：

1. 原图 ≤10MB：直接上传；
2. >10MB：`sharp` 压缩到 ≤10MB；
3. 仍 >10MB：失败并告警。

群机器人：

1. 原图 ≤2MB 且 JPG/PNG：直接发；
2. >2MB：
   - auto-rotate；
   - 透明底转白底；
   - 最长边压到 2000px；
   - JPEG 质量 80；
   - 逐步降尺寸/质量，直到 ≤2MB；
3. 仍 >2MB：`media/upload?type=file`（≤20MB）后发 `file`；
4. 文件也失败：`FAILED / MEDIA_TOO_LARGE`。

压缩结果不落库，按批次缓存；重试时重新压缩。`sharp` 已是项目依赖。

### 7.7 @ 功能

@ 仅用于群机器人 text 消息；应用消息没有群 @ 概念。

策略配置位于群策略 `targetConfig.mention`：

```json
{
  "targetKeys": ["finance"],
  "mention": {
    "mode": "ALL"
  }
}
```

或：

```json
{
  "targetKeys": ["finance"],
  "mention": {
    "mode": "USERS",
    "userIds": ["dms-user-id-1", "dms-user-id-2"]
  }
}
```

模式：

| mode | 发送参数 |
| --- | --- |
| `NONE` | 不传 `mentioned_list` |
| `ALL` | `mentioned_list: ["@all"]` |
| `USERS` | `mentioned_list: [wecom_userid...]` |

规则：

- 仅 `channel=WECOM` 且 `targetMode=GROUP` 允许配置；
- `userIds` 存 DMS 用户 ID，发送时解析为 `wecom_bindings.wecom_user_id`；
- 去重、限制数量（建议最多 50）；
- 未绑定/停用用户跳过，消息仍发送，记录 `mention_skipped`；
- 无法从群机器人 API 校验群成员，userid 不在群内时可能静默无效；
- 模板正文不写 @，避免应用消息显示普通文字、群消息重复；
- `mode=USERS` 但一个都没解析出来时，省略 `mentioned_list`，不阻断消息；
- `@all` 默认不做，必须显式配置并二次确认。

DMS 不建议给模板加 @ 字段；@ 是发送参数，不是内容。

`wecom_deliveries` 可增加可选字段用于排障：

```text
mention_mode      VARCHAR(16)
mentioned_count   INTEGER
mention_skipped   INTEGER
```

不存具体 userid 列表，避免 PII 扩散。

## 8. 投递与派发

### 8.1 投递表

`wecom_deliveries`：

| 字段 | 说明 |
| --- | --- |
| `notification_id` | 逻辑通知 |
| `app_id` | 应用；`transport=APP` 时必填 |
| `transport` | `APP` / `ROBOT` |
| `recipient_user_id` | 1:1 收件人 |
| `target_id` | 群目标 |
| `status` | `PENDING` / `SENDING` / `ACCEPTED` / `PARTIAL` / `FAILED` / `SKIPPED` / `EXPIRED` / `CANCELLED` |
| `attempt_count` / `next_attempt_at` | 重试 |
| `template_key` / `template_version` | 模板快照 |
| `rendered_content` | 渲染后正文 |
| `content_sent_at` | 正文发送成功时间 |
| `mention_mode` / `mentioned_count` / `mention_skipped` | @ 排障 |
| `provider_msg_id` | 应用消息 msgid，可空 |
| `failure_code` / `failure_message` | 失败 |
| `accepted_at` | 受理时间 |
| `created_at` / `updated_at` | 时间 |

`wecom_delivery_media`：

| 字段 | 说明 |
| --- | --- |
| `delivery_id` | 投递 |
| `media_asset_id` | 媒体资产 |
| `sort_order` | 顺序 |
| `status` | 同投递状态 |
| `attempt_count` / `next_attempt_at` | 重试 |
| `media_id` / `media_id_expires_at` | 应用消息临时素材 |
| `failure_code` / `failure_message` | 失败 |
| `accepted_at` | 受理时间 |
| `created_at` / `updated_at` | 时间 |

`wecom_dispatch_leases`：

- 单例租约，保证同一时刻一个实例领取；
- 后续多应用可扩为按应用租约。

### 8.2 发布流程

1. `publish()` 按事件选策略；WECOM 策略存在且启用；
2. `primaryPolicy` 的 TTL 选择要包含 WECOM（不能只看 ASSISTANT）；
3. 查 WECOM 模板；缺失/停用则渠道跳过；
4. 渲染变量；校验 `max_length` 与 `max_bytes`；超限跳过；
5. 解析目标：
   - 1:1：权限/角色/固定用户 → 全局绑定 + 应用 membership；
   - 群：`wecom_targets`；
6. 创建 `wecom_deliveries` 与 `wecom_delivery_media`；
7. 渠道结果汇总进通知状态。

### 8.3 派发 worker

- 数据库租约 + 批量领取；
- `PENDING` → `SENDING` → `ACCEPTED`/`PARTIAL`/`FAILED`；
- 正文先发，附件后发；正文成功写 `content_sent_at`，附件失败只补附件；
- 重试 3 次，退避 5s / 30s / 120s；
- 静默时段：`NORMAL` 延后，`HIGH` 突破；
- TTL 到期转 `EXPIRED`；
- `SENDING` 超时回收；
- 高优先级公平性可复用现有 `HIGH_PRIORITY_BURST=3`。

### 8.4 传输

应用消息：

```text
POST /cgi-bin/message/send
{
  touser: wecom_user_id,
  agentid,
  msgtype: "text",
  text: { content }
}
```

- 每个收件人单独一条 delivery，保留逐人状态；
- 图片先 `media/upload?type=image`，同一通知同一张图可复用 `media_id`；
- 文本发送前校验 2048 字节。

群机器人：

```text
POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...
{
  msgtype: "text",
  text: {
    content,
    mentioned_list?: [...]
  }
}
```

- text 2048 字节；
- 图片 base64 + md5，≤2MB；超限压缩/改文件；
- 每机器人 20 条/分钟，按 `target` 独立限流。

### 8.5 错误映射

| 错误 | 处理 |
| --- | --- |
| `0` | `ACCEPTED` |
| `40001` / `42001` | token 失效，刷新后重试一次 |
| `45009` | 频率超限，退避重试 |
| `81013` | 收件人非法/不在应用可见范围，`FAILED`，标记该应用 membership |
| `60020` | 可信 IP 未配置，`FAILED` 并告警 |
| `40006` | 媒体超限，`FAILED` |
| `40007` | media_id 失效，重新上传后重试 |
| `93000` | 机器人 webhook 无效，`FAILED` 并告警 |
| 网络超时/5xx | 重试 |

### 8.6 限流

- 应用消息：按 `app × member` token bucket；同一成员 30 次/分钟、1000 次/小时；
- 群机器人：按 `target` token bucket；20 条/分钟；
- 应用每日上限 = 可见成员数 × 200；24 人时 4,800/天；
- 多应用不提高群机器人上限，只隔离应用消息配额。

## 9. 管理端

### 9.1 页面

新增 `/system/notifications/wecom`：

- 应用列表；
- 应用详情：基本配置、承担事件、可见成员、Secret、发送记录；
- 渠道开关、应用状态、最近错误；
- 测试 token、测试发送。

现有页面扩展：

- 事件配置：WECOM 卡片；1:1 显示使用的应用（只读）；群策略显示目标与提醒方式；群目标可配置 @；
- 模板库：WECOM 渠道 Tab；`max_bytes` 字节计数器；
- 通知记录：渠道筛选加入 WECOM；显示应用/群目标/@ 计数；
- 个人通知偏好：WECOM 开关；
- 系统状态：`wecomWorkerEnabled`。

### 9.2 接口

```text
GET    /api/notifications/wecom/channel
POST   /api/notifications/wecom/channel/test

GET    /api/notifications/wecom/apps
POST   /api/notifications/wecom/apps
PATCH  /api/notifications/wecom/apps/:id
PUT    /api/notifications/wecom/apps/:id/secret
POST   /api/notifications/wecom/apps/:id/test
GET    /api/notifications/wecom/apps/:id/events
PUT    /api/notifications/wecom/apps/:id/events

GET    /api/notifications/wecom/apps/:id/members
POST   /api/notifications/wecom/apps/:id/members
DELETE /api/notifications/wecom/apps/:id/members/:userId
POST   /api/notifications/wecom/apps/:id/sync-scope   # 二期

GET    /api/notifications/wecom/bindings
POST   /api/notifications/wecom/bindings
PATCH  /api/notifications/wecom/bindings/:id
POST   /api/notifications/wecom/bindings/:id/verify
DELETE /api/notifications/wecom/bindings/:id

GET    /api/notifications/wecom/targets
POST   /api/notifications/wecom/targets
PATCH  /api/notifications/wecom/targets/:id
POST   /api/notifications/wecom/targets/:id/test
DELETE /api/notifications/wecom/targets/:id
```

### 9.3 权限

```text
wecom-channel:read / update
wecom-app:read / manage
wecom-app-secret:update
wecom-membership:read / manage
wecom-target:read / manage
wecom-delivery:resend
```

只授 `system_admin`；Secret 更新单独权限，审计可追溯。

### 9.4 审计

```text
WECOM_CHANNEL_UPDATED
WECOM_APP_CREATED / UPDATED / DISABLED
WECOM_APP_SECRET_UPDATED
WECOM_EVENT_ROUTE_UPDATED
WECOM_MEMBERSHIP_UPDATED / VERIFIED
WECOM_TARGET_CREATED / UPDATED / TESTED
```

审计只记录应用 key、事件类型、成员掩码、计数；不记录 Secret、token、消息正文。

## 10. 运维与开通

### 10.1 企业微信后台

1. 使用已认证企业；当前 24 名成员，容量充足。
2. 创建自建应用“千树 DMS”，设置名称/logo/可见范围/API 权限。
3. 记录 `corp_id`、`agent_id`，生成 Secret。
4. 配置可信 IP（服务器出口 IP）；变更时同步后台。
5. 开启微信插件，生成邀请二维码（7 天有效）。

### 10.2 微信插件开通（24 人）

分批：

- 第一批：5–8 名审批人/财务/运营试点；
- 第二批：其余成员。

每人步骤：

1. 管理员确认应用可见范围包含该员工；
2. 员工用微信扫描微信插件邀请二维码；
3. 员工在微信插件中开启“接收企业消息”；
4. 员工关闭“仅在企业微信中接收消息”；
5. 管理员确认后台未勾选“成员使用微信插件时需要使用企业微信客户端”；
6. DMS 创建绑定 + 默认应用 membership，发送测试消息；
7. 员工确认收到后标记 `verified_at`。

微信插件限制：

- 邀请二维码 7 天有效；
- 全员群超过 2000 人时消息不同步（当前不相关）；
- 消息页只显示发过消息的应用，通讯录页显示可见范围内全部应用；
- API 成功不等于员工看到，必须人工确认。

### 10.3 群机器人

1. 建企业内部群；
2. 群设置添加群机器人；
3. 复制 webhook key；
4. 在 DMS 群目标中录入（加密存储）；
5. 发送测试；
6. 标记 `internal_only=true`；外部群/客户群不纳入。

### 10.4 环境变量

```text
WECOM_APP_SECRET_KEY=      # base64url 32 字节，加密应用 Secret
WECOM_WORKER_ENABLED=false # 派发开关
```

一期单应用，`corp_id`/`agent_id`/`secret` 存数据库，Secret 加密；不再使用多组 `WECOM_*_SECRET` 环境变量。

### 10.5 监控

- access_token 刷新失败；
- `40001/42001/60020/81013/45009/93000` 计数；
- `PENDING` 最老年龄、失败率；
- 每应用/每机器人发送速率；
- 未验证绑定/成员数；
- 媒体失败（超限、media_id 失效）；
- 微信插件人工抽查。

## 11. 与 GeWe 共存

### 11.1 按事件切换

- 同一事件同时启用 ASSISTANT 和 WECOM 会重复发送；
- 迁移时按事件切换：先配好 WECOM，再关闭该事件的 ASSISTANT 策略；
- 未迁移事件继续走 ASSISTANT；
- `IN_APP` 始终保留。

### 11.2 双渠道对照

允许短期同时开启，但必须限时限范围：

- 1:1：WECOM 用 `USERS` 只选试点用户，ASSISTANT 保持原目标；试点用户会收到两份；
- 群：WECOM 指向单独试点群，ASSISTANT 仍指向生产群，避免同群重复；
- WECOM 模板可加 `【企微试点】` 前缀，便于识别；
- 事件配置页显示重复发送警告。

对照指标：

- `ACCEPTED` 率；
- 失败码分布；
- 发布到受理延迟；
- 试点用户确认微信插件是否收到；
- 内容是否截断、链接是否可用；
- 群图片压缩成功率。

退出条件建议：

- 试点 7–14 天；
- `ACCEPTED` 率 ≥95%；
- 试点用户全部确认收到；
- 无漏发、无截断、无链接问题；
- 无机器人/应用频率问题。

### 11.3 不做自动降级

WECOM 失败时：

- 同渠道重试；
- `IN_APP` 仍送达；
- 告警管理员；
- 不自动改发 GeWe，避免重复消息和掩盖问题。

### 11.4 回滚

- 关闭 `notification_channel_settings.WECOM.enabled`；
- 关闭 `WECOM_WORKER_ENABLED`；
- 重新启用对应事件的 ASSISTANT 策略；
- WECOM 表保留，不删数据。

## 12. 实施阶段

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| P0 | POC：应用、微信插件、机器人、文本/图片/长文本/链接/@/2MB 压缩/20 条每分钟 | 3–5 天 |
| P1 | 渠道枚举、约束、表、设置、权限/审计；渠道常量收口 | 1 周 |
| P2 | 群机器人闭环：目标、transport、限流、重试、最小管理页 | 1–2 周 |
| P3 | 1:1：token、绑定、membership、应用消息、图片上传、测试发送 | 2–3 周 |
| P4 | 模板/事件/记录/偏好完整接入；双渠道对照；浏览器 e2e | 2–3 周 |
| P5 | 二期多应用手动新增、事件分配、`agent/get` 同步 | +1–2 周 |
| P6 | 全量内部事件迁移、收缩 GeWe | 按验收结果 |

粗估：一期单人 **5–7 周**（含测试与 POC，不含全员开通和业务验收）；二期多应用再加 1–2 周。

### 12.1 迁移顺序

1. 新增 `notification_channel` 的 `WECOM` 值（单独迁移）；
2. 修改策略约束；
3. 新增 `wecom_*` 表、索引、约束；
4. 增加 `notification_templates.max_bytes`；
5. 增加权限码、审计枚举（注意 enum 拆分）；
6. 插入 WECOM 渠道设置行；
7. 插入默认应用行（`secret` 为空，`enabled=false`）；
8. 按试点事件插入 WECOM 模板/策略（可后续管理端配置）；
9. 登记迁移基线清单；空库自检。

### 12.2 代码触点

| 层 | 位置 |
| --- | --- |
| Prisma/迁移 | `server/prisma/schema.prisma`、`server/prisma/migrations/*` |
| 通知核心 | `server/src/modules/notifications/notification.types.ts`、`system-notification.service.ts`、`notification.module.ts` |
| WECOM 传输 | 新增 `wecom-token.service.ts`、`wecom-app.transport.ts`、`wecom-robot.transport.ts`、`wecom-media.service.ts`、`wecom-dispatch.service.ts` |
| 管理端 | 新增 `wecom-admin.controller/service/dto`；扩展 `notification-admin.*` |
| 业务耦合 | `sales-receipt.service.ts` 出站守卫、`machine-viewing-notification.ts` 模板选择、`system-status.*` |
| 偏好/记录 | `notification-preference.*`、`notification-display-labels.ts`、记录筛选 |
| Web | 新增 `views/system/notifications/wecom.vue`/`wecom-panel.vue`；扩展事件配置、模板库、记录、偏好、路由与权限 |

## 13. 验收

### 13.1 一期

- 默认应用“千树 DMS”配置成功；Secret 加密入库；`gettoken` 通过；
- 24 名成员绑定与默认应用 membership；
- 1:1 文本/图片/链接；
- 群文本/图片压缩；
- @all 与 @指定成员；
- `81013`、`45009`、`93000`、`40006` 错误处理；
- 模板 `max_bytes` 保存与发布校验；
- 事件路由为空时回退默认应用；
- 双渠道对照；
- GeWe 与 IN_APP 现有行为不变；
- 管理端应用/成员/事件/Secret/记录页面。

### 13.2 二期

- 手动新增第二个应用；
- 事件分配与冲突拒绝；
- 不同可见范围 + 应用级 membership；
- `agent/get` dry-run、确认、审计；
- 应用停用不回退；
- 每应用 token/限流独立；
- 微信插件分别显示应用入口。

### 13.3 测试

- 单元：字节预算、路由解析/冲突、membership、Secret 加解密、token 缓存、@ 解析、图片压缩、错误映射；
- 集成：publish → delivery → fake WeCom server；重试、静默、TTL、PARTIAL、invaliduser、@all/@USERS；
- 契约：DTO/OpenAPI、生成类型；
- 数据库：空库迁移、约束、枚举拆分；
- 浏览器：应用页、事件分配、模板字节提示、记录筛选、偏好；
- 真实 POC：3–5 人微信插件、内部群、文本/图片/链接/@/2MB/10MB；
- 回归：ASSISTANT 与 IN_APP 现有用例全部通过。

## 14. 风险与待确认

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 微信插件静默失败 | API 成功但员工没看到 | 绑定/成员测试确认 + SOP + 抽查 |
| 无已读回执 | 无法证明送达 | 只记录 `ACCEPTED`；不承诺已读 |
| `81013` | 用户不在应用可见范围 | 标记应用 membership；不废全局绑定 |
| @ 无法校验群成员 | @ 可能静默无效 | 试点验证 + 群成员维护；@all 兜底 |
| @all 扰民 | 群内过度提醒 | 默认 NONE；只给高优先级事件；二次确认 |
| 2048 字节截断 | 长通知丢内容 | `max_bytes` + 摘要/链接/图片；不截断发送 |
| 群图片 2MB | 凭证图发不出 | `sharp` 压缩；仍超限改文件 |
| 应用路由错误 | 发错应用或跳过 | 冲突校验、只读展示、停用不回退 |
| `agent/get` 只有部门/标签 ID | 同步不完整 | 优先具体人员；dry-run；不自动删除 |
| Secret 轮换 | 加密密钥变更需重加密 | 预留 `secret_version`；后续提供 re-encrypt 工具 |
| 多应用入口碎片化 | 员工漏看 | 一期单应用；二期按 2–4 个业务域拆 |

### 14.1 待确认

1. 试点事件最终选哪几个（建议审批类 3–4 个 + 财务群 1–2 个）。
2. 试点用户与试点群。
3. @ 默认策略：全部 `NONE`，还是审批类 `ALL`/`USERS`。
4. 二期应用拆分数量、名称与事件分配。
5. `agent/get` 同步是否只覆盖显式人员；部门/标签是否需要接通讯录 Secret。
6. `WECOM_APP_SECRET_KEY` 的保管与轮换周期。
7. 试点期是否统一加 `【企微试点】` 前缀。

## 15. 附：配置示例

### 15.1 群策略 @ 配置

```json
{
  "targetKeys": ["finance"],
  "mention": {
    "mode": "USERS",
    "userIds": ["dms-user-id-1", "dms-user-id-2"]
  }
}
```

### 15.2 WECOM 模板

```text
【千树 DMS】采购单 {{orderNo}} 已审核通过
供货方：{{vendorName}}
金额：{{currencyCode}} {{totalAmount}}
详情：{{linkUrl}}
```

`max_length`: 1500（字符）
`max_bytes`: 2048（UTF-8 字节）
`media_policy`: 允许 `purchase.orderImage` 1 张

### 15.3 应用消息发送体

```json
{
  "touser": "zhangsan",
  "agentid": 1000001,
  "msgtype": "text",
  "text": {
    "content": "【千树 DMS】采购单 PO-20261124-01 已审核通过\n供货方：示例供应商\n金额：TWD 1,000.00\n详情：https://dms.example.com/#/purchase-orders/..."
  }
}
```

### 15.4 群机器人发送体

```json
{
  "msgtype": "text",
  "text": {
    "content": "【千树 DMS】采购单 PO-20261124-01 已审核通过\n供货方：示例供应商\n金额：TWD 1,000.00\n详情：https://dms.example.com/#/purchase-orders/...",
    "mentioned_list": ["@all"]
  }
}
```

## 17. 实施进展

### 17.1 已完成（2026-11-24）

- 迁移 `20261124100000_wecom_channel_enum`：`notification_channel` 增加 `WECOM`。
- 迁移 `20261124101000_wecom_channel_schema`：新增应用、事件路由、绑定、应用成员、群目标、投递、投递附件、派发租约八张表；`NotificationTemplate.maxBytes`；通知策略渠道/群目标约束；WECOM 渠道设置、默认应用“千树 DMS”、派发租约。
- 迁移 `20261124102000_wecom_permissions_and_audit`：10 项 `wecom-*` 权限仅授 `system_admin`；11 项 WECOM 审计枚举。
- 迁移 `20261124110000_wecom_provider_msg_id_length`：`wecom_deliveries.provider_msg_id` 放宽到 `VARCHAR(128)`。企业微信实际返回的 `msgid` 为 128 字符，原 64 长度会在发送成功回写时失败。
- 服务端：`wecom.config.ts`、`wecom-secret.service.ts`、`wecom-token.service.ts`、应用 text/image 传输、群机器人 text/@/image 传输、`wecom-media.service.ts`、`wecom-dispatch.service.ts`、`system-notification.service.ts` 的 WECOM 文本与图片分支。
- 管理端：`wecom-admin.controller/service/dto`，覆盖渠道开关、应用 CRUD/Secret/测试、事件分配、员工绑定/验证、应用成员、群目标 CRUD/测试；页面 `/system/notifications/wecom`。
- 图片投递：应用消息 media_id 上传（≤10MB）、群机器人图片 Sharp 压缩（≤2MB）、`wecom_delivery_media` 写入、正文成功后逐张发送与 PARTIAL 汇总。
- 通知记录：按渠道统计 WECOM 投递、详情合并展示 WECOM 投递与附件计数。
- 通知偏好、模板/策略 DTO、权限目录与既有通知派发状态汇总已兼容 WECOM。
- 模板编辑器支持 WECOM `max_bytes`（1–4096，默认 2048）输入与保存。
- 单元测试：7 个 WECOM 套件；Server 全量 472 套件 5,007 用例通过；Web 2,316 用例通过；类型检查、ESLint、构建、契约检查、根治理通过。
- 迁移验证：一次性 PostgreSQL 16 空库 215 条迁移首次部署成功，二次部署无待执行项，`migrate status` 最新。
- 真实 API POC：`gettoken`、应用文本/图片、群机器人文本/图片与 `@all` 全部 `errcode 0`；用户确认微信插件与测试群实际收到。
- DMS 全链路 POC（隔离 PostgreSQL + 真实企业微信）：publish → `wecom_deliveries` → worker → 应用/群投递均 `ACCEPTED`；文本正文、应用图片 `media_id` 上传发送、群机器人图片压缩发送、附件记录均通过；群 `@all` 记录 `mentionMode=ALL`。
- 字节行为确认：2,170 字节文本仍返回 `errcode 0`，但用户看不到末尾标记，证明超 2,048 字节是静默截断，必须由 DMS 发布期 `max_bytes` 拦截。

### 17.2 未完成

- 模板/策略种子与试点事件；页面级验收。
- 二期多应用 `agent/get` 同步、不同可见范围的应用级成员管理。
- 群图片压缩后仍 >2MB 时的文件兜底；当前直接落 PARTIAL/FAILED。
- 记录页 WECOM 投递的手动重发、通知清理任务覆盖。
- 部署与页面级验收；生产环境 `WECOM_APP_SECRET_KEY` / `WECOM_WORKER_ENABLED` 配置。

### 17.3 已知限制

- 群图片按 2MB 目标压缩；压缩后仍超限时暂不转文件，直接标记附件失败。
- 应用图片按 10MB 目标压缩；压缩后仍超限时标记附件失败。
- 群 @ 的成员不在群内时无法通过机器人 API 校验，可能静默无效。
- 2026-11-24 POC 已确认微信插件与测试群收到文本/图片；正式上线前仍建议用真实试点事件做一次页面级验收。

## 18. 参考

- [企业微信帮助中心：如何创建/设置自建应用权限](https://open.work.weixin.qq.com/help2/pc/16892)：应用数量、名称/logo、可见范围
- [企业微信帮助中心：如何在微信插件查看应用](https://open.work.weixin.qq.com/help2/pc/14802)：微信插件应用入口与可见范围
- [企业微信帮助中心：企业微信的消息同步到微信](https://open.work.weixin.qq.com/help2/pc/14797)：微信插件接收条件
- [企业微信发送应用消息](https://developer.work.weixin.qq.com/document/path/90236)：接收对象、text 2048 字节、频率、消息类型
- [企业微信获取应用详情](https://developer.work.weixin.qq.com/document/path/90227)：`allow_userinfos` / `allow_partys` / `allow_tags`
- [企业微信群机器人配置说明](https://developer.work.weixin.qq.com/document/path/91770)：text 2048、markdown 4096、图片 2MB、`mentioned_list`
- [企业微信群发接口](https://developer.work.weixin.qq.com/document/path/92135)：客户群发需成员确认、频率限制
- [微信客服发送消息](https://developer.work.weixin.qq.com/document/path/94700)：用户主动发起后 48 小时内最多 5 条
