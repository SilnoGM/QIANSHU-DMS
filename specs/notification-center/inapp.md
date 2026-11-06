# 站内通知设计

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档状态 | 设计稿，关键决策已确认，待实施 |
| 方案定位 | 通知中心的站内渠道 `IN_APP`；与千树小助理共享同一套发布与模板体系 |
| 关联文档 | [文档索引](./README.md)、[落地设计](./design.md)、[接口契约](./api.md)、[数据模型](./data-model.md)、[事件规格](./events.md) |
| 适用范围 | 阶段 3：站内通知中心；桌面浏览器通知为可选增强 |
| 最后更新 | 2026-10-28 |

## 0. 已确认决策

| 决策 | 结论 |
| --- | --- |
| 产品形态 | 完整通知中心：顶栏铃铛 + 独立页面，列表、筛选、详情、已读、归档 |
| 可见范围 | 与站外一致：`publish` 的 `target` 解析出谁，就为谁创建站内条目 |
| 已读与操作 | 点击跳转业务页，支持单条/全部已读、归档、取消归档；不删除 |
| 实时性 | 30 秒轮询 + 聚焦/可见性刷新 + 操作后立即刷新；不做 SSE/WebSocket |
| 分类 | 单列表 + 业务域筛选；业务域从 `eventType` 派生，不落库 |
| 用户偏好 | 固定策略，不做按用户/事件的开关 |
| 事件覆盖 | 阶段 3 只覆盖 `PURCHASE_REVIEW_PENDING`、`SLH_RECONCILIATION_COMPLETED`、`SHIPMENT_ARRIVED` |
| 点击行为 | 标记已读并直接跳业务详情；没有链接或链接失效时打开详情抽屉 |
| 未读计数 | 只返回总数 `{ total }`，不做按业务域计数 |
| 桌面通知 | 桌面端可选开启；通知页放开关；三个事件都弹；允许带详情；逐条弹；与千树小助理可同时开；不做 Web Push |

## 1. 定位与边界

- 站内通知是通知中心的第二个渠道，不是独立系统。业务模块仍然只调用 `SystemNotificationService.publish()`。
- 逻辑通知在 `notifications`，站内给每个收件人一条 `notification_inbox_items`，站外给每个收件人或群一条 `assistant_deliveries`。
- 站内与站外可以同时启用；站外失败不影响站内，站内已读也不影响站外记录。
- 站内不做“确认收到/已处理”回执，只有已读与归档。
- 页面关闭后没有站内提醒；桌面通知依赖页面开着，不做 Web Push。
- 不做按用户关闭某类通知的偏好；是否进站内由管理员的事件 × 渠道策略决定。

## 2. 数据模型

### 2.1 `notification_inbox_items`

| 字段 | 类型 | 可空 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | uuid | 否 | `gen_random_uuid()` | 主键 |
| `notificationId` | uuid | 否 | — | FK `notifications(id)`，`onDelete: Cascade` |
| `userId` | uuid | 否 | — | 收件人，FK `users(id)` |
| `eventType` | varchar(64) | 否 | — | 事件类型快照，用于业务域筛选 |
| `templateVersion` | int | 否 | — | 发布时站内模板版本 |
| `titleSnapshot` | text | 否 | — | 标题快照 |
| `bodySnapshot` | text | 否 | — | 正文快照，可能含金额与客户名称 |
| `linkUrlSnapshot` | text | 是 | `null` | 点击跳转地址 |
| `readAt` | timestamptz(6) | 是 | `null` | 已读时间 |
| `archivedAt` | timestamptz(6) | 是 | `null` | 归档时间 |
| `createdAt` | timestamptz(6) | 否 | `now()` | 创建时间 |

索引与约束：

- 唯一 `(notificationId, userId)`。
- 列表索引：`(userId, archivedAt, createdAt DESC)`。
- 未读计数部分索引：`(userId) WHERE readAt IS NULL AND archivedAt IS NULL`。
- 业务域筛选索引：`(userId, eventType, createdAt DESC)`。
- CHECK：`eventType <> ''`、`titleSnapshot <> ''`、`bodySnapshot <> ''`。

`eventType` 快照是必要的：通知主表按保留期清理后，归档消息仍要能按业务域筛选。业务域本身不落库，由共享常量映射。

### 2.2 状态与未读口径

- 未读：`readAt IS NULL AND archivedAt IS NULL`。
- 已读：`readAt IS NOT NULL AND archivedAt IS NULL`。
- 已归档：`archivedAt IS NOT NULL`。
- `unreadTotal` 只统计未读且未归档；归档一条未读消息会把它从总数中扣除。
- 归档时如果 `readAt` 为空，一并写入 `readAt = now()`；取消归档后保持已读，避免未读数回跳。
- 没有删除接口；归档可逆。

### 2.3 保留与清理

| 数据 | 默认保留 |
| --- | --- |
| 未归档站内条目 | 180 天 |
| 已归档站内条目 | 1 年 |

清理由 `notification-operations.ts cleanup` 每日执行；分批删除，避免长事务。保留期可在 `notification_settings` 调整，但必须有下限。

### 2.4 业务域映射

业务域是前端筛选维度，由共享常量从 `eventType` 派生；服务端列表查询把 `domain` 转成 `eventType IN (...)`。

| eventType | 业务域 | 阶段 | 备注 |
| --- | --- | --- | --- |
| `PURCHASE_REVIEW_PENDING` | 采购 | 1 | 已确认 |
| `PURCHASE_PAYABLE_PENDING` | 采购 | 2 | 已确认归采购；语义是待付款提醒，不是到期提醒 |
| `FUND_WITHDRAWAL_REVIEW_PENDING` | 资金 | 2 | 建议值，实施前确认 |
| `INVOICE_REQUEST_REVIEW_PENDING` | 发票 | 2 | 建议值，实施前确认 |
| `PACKAGING_COST_PAYMENT_PENDING` | 资金 | 2 | 建议值，实施前确认 |
| `SLH_RECONCILIATION_COMPLETED` | 对账 | 1 | 已确认 |
| `SHIPMENT_ARRIVED` | 货件 | 1 | 已确认 |

阶段 3 只有采购、对账、货件三个域有数据；筛选器可以展示全部五个域，也可以只展示当前有数据的域，实施时按 UI 简洁度决定。

## 3. 接口

### 3.1 接口清单

全部只要求登录，不要求管理权限；服务端强制 `userId = 当前会话用户`，不接受客户端传 `userId`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/notifications/me/inbox` | 列表，支持状态、业务域、分页 |
| GET | `/api/notifications/me/inbox/unread-count` | 未读总数 `{ total }` |
| GET | `/api/notifications/me/inbox/new` | 增量新消息，供桌面通知使用 |
| GET | `/api/notifications/me/inbox/:id` | 详情 |
| POST | `/api/notifications/me/inbox/:id/read` | 标记已读，幂等 |
| POST | `/api/notifications/me/inbox/:id/unread` | 标记未读，幂等 |
| POST | `/api/notifications/me/inbox/read-all` | 全部已读，可选业务域 |
| POST | `/api/notifications/me/inbox/:id/archive` | 归档；未读时同时写 `readAt` |
| POST | `/api/notifications/me/inbox/:id/unarchive` | 取消归档 |

### 3.2 列表

```http
GET /api/notifications/me/inbox?status=all&domain=purchase&page=1&pageSize=20
```

- `status`：`all`（未归档，含已读与未读）、`unread`、`archived`；默认 `all`。
- `domain`：`purchase`、`fund`、`invoice`、`reconciliation`、`shipment`；省略表示全部；非法值 422。
- 排序：`createdAt DESC, id DESC`。
- 响应：`{ items, page, pageSize, total }`。
- 列表项：`id`、`eventType`、`domain`、`title`、`readAt`、`archivedAt`、`createdAt`；正文只在详情返回，避免列表过大。

### 3.3 详情

```json
{
  "id": "...",
  "eventType": "PURCHASE_REVIEW_PENDING",
  "domain": "purchase",
  "title": "采购单 CG20261028-0001 待审核",
  "body": "客户：赖文寿\n金额：CNY 12,345.00\n明细：3 行 / 5 个货件",
  "linkUrl": "/operations/purchase-orders/...",
  "readAt": null,
  "archivedAt": null,
  "createdAt": "2026-10-28T02:00:00.000Z"
}
```

不属于当前用户的 ID 一律 404，不区分“不存在”和“无权查看”。

### 3.4 未读数

```json
{ "total": 3 }
```

只返回总数；`total` = 未读且未归档。不做 `byDomain`。

### 3.5 增量新消息（桌面通知）

```http
GET /api/notifications/me/inbox/new?cursor=<opaque>&limit=20
```

- 首次请求不带 `cursor`：服务端以当前时间为起点，返回空列表与 `nextCursor`，不回放已有未读。
- 后续请求带 `nextCursor`；游标编码 `(createdAt, id)`，避免同一时间戳的消息被漏掉。
- `limit` 默认 20，最大 50。
- 响应：

```json
{
  "items": [
    {
      "id": "...",
      "eventType": "PURCHASE_REVIEW_PENDING",
      "domain": "purchase",
      "title": "采购单 CG20261028-0001 待审核",
      "body": "客户：赖文寿\n金额：CNY 12,345.00\n明细：3 行 / 5 个货件",
      "linkUrl": "/operations/purchase-orders/...",
      "createdAt": "2026-10-28T02:00:00.000Z"
    }
  ],
  "unreadTotal": 3,
  "nextCursor": "...",
  "hasMore": false,
  "serverTime": "2026-10-28T02:00:30.000Z"
}
```

- 客户端维护已见 ID 的有界 LRU，即使游标重叠也不重复弹。
- 如果 `hasMore = true`，客户端最多续拉 3 页，避免批量事件把页面拖死；剩余的新消息在下一轮或打开列表时可见。

### 3.6 已读、归档与全部已读

- `read` / `unread`：幂等；返回更新后的详情。
- `read-all`：请求体可选 `{ domain }`；只影响未归档消息；返回 `{ updated, unreadTotal }`。
- `archive`：设置 `archivedAt`；如果 `readAt` 为空，同时写 `readAt`；返回详情。
- `unarchive`：清空 `archivedAt`；`readAt` 保留。
- 重复归档/取消归档不报错，返回当前状态。

## 4. 前端

### 4.1 入口与路由

- 顶栏铃铛沿用现有 `Notification/index.vue`，面板改为真实数据：最近 10 条、未读红点、「查看全部」。
- 新增完整页面 `/notifications`，标题「通知中心」，路由 `meta.menu: false`，从铃铛进入，不占侧边栏菜单；所有登录用户可访问，不需要管理权限。
- 页面结构：

```
views/notifications/
├── index.vue                 # 页头 + 状态/业务域筛选 + 列表
├── notifications.logic.ts    # 筛选、域映射、轮询、格式化
├── notification-detail-drawer.vue
└── components/
    ├── desktop-notification-toggle.vue
    └── notification-list-item.vue
```

### 4.2 列表与筛选

- 单列表，不按业务域拆页签；状态用 `QsStatusSwitchToolbar`（全部/未读/已归档），业务域用 `FaSelect` 或 `QsGenericTable` 的筛选定义。
- 行内容：标题、业务域、时间、已读状态；点击行标记已读并跳转。
- 操作：详情、标记未读、归档/取消归档；不做删除。
- 空态区分「没有通知」和「当前筛选没有结果」。
- 移动端 768px 以下切卡片，筛选进底部抽屉，按钮触控高度不小于 44px。

### 4.3 轮询

| 场景 | 行为 |
| --- | --- |
| 页面可见且已登录 | 每 30 秒刷新；加 ±3 秒抖动 |
| 页面隐藏 | 暂停计时器 |
| 恢复可见/窗口聚焦 | 立即刷新 |
| 打开铃铛或通知页 | 立即刷新 |
| 已读/未读/归档/全部已读 | 立即刷新未读数和当前列表 |
| 上一请求未完成 | 不重复发请求 |
| 失败 | 退避 30→60→120 秒，上限 5 分钟；恢复可见或网络恢复时重置 |
| 401 | 停止轮询，走会话失效流程 |
| 退出登录/切换账号 | 停止计时器、清理游标与已见 ID |
| 多标签 | `BroadcastChannel` 选主标签轮询并广播，其他标签只更新铃铛 |

桌面通知关闭时轮询 `unread-count`；开启时轮询 `inbox/new`，同时拿到新消息和未读总数。列表只在打开页面/铃铛时拉取，不参与 30 秒轮询。

### 4.4 桌面浏览器通知

- **仅桌面端**：移动端/窄屏不显示开关；`Notification` 不存在时显示「当前浏览器不支持」。
- **开关位置**：通知页页头或设置卡片，默认关闭；文案注明「仅页面打开时提醒」。
- **权限**：点击开关时调用 `requestPermission()`；授权成功后弹一条测试通知；被拒绝时显示「已被浏览器阻止」和设置指引，不反复弹权限框。
- **触发**：页面隐藏或窗口失焦时，对 `inbox/new` 返回的每条消息逐条弹；页面可见时只更新铃铛。
- **事件范围**：三个事件都弹。
- **内容**：使用 `title`/`body` 快照，允许包含金额与客户名称；`tag = notificationId`。
- **节奏**：多条新消息按约 200ms 间隔逐条创建，避免同一毫秒被系统合并。
- **点击**：聚焦窗口并跳到 `linkUrl`；没有链接时打开 `/notifications`。
- **多标签**：仍由主标签负责弹，其他标签不弹。
- **退出登录**：关闭本页创建的 Notification，清理当前用户游标；浏览器权限不变。
- **不做 Web Push**：页面关闭后不提醒，帮助文案写清楚。
- **隐私提示**：系统通知可能出现在锁屏和通知历史；共享电脑建议关闭；偏好按「浏览器 + 当前用户」存储。

### 4.5 测试

- 单元：业务域映射、筛选参数、游标与已见 ID、30 秒调度、页面隐藏/聚焦、退避、401、权限状态机、通知 adapter 调用、多标签选主。
- 浏览器：铃铛红点、打开下拉、列表筛选、已读/归档/取消归档、桌面开关只在桌面显示、权限被拒绝提示；用 stub 替换 `Notification`，不依赖真实系统通知。
- 契约：列表、详情、未读数、增量、已读、归档接口的 OpenAPI 与前端类型同步。
- 数据：站内条目的唯一约束、未读部分索引、归档语义、保留期清理。

## 5. 权限与安全

- 站内接口只要求登录，不新增权限码；所有查询强制当前会话用户。
- 管理员不能通过站内接口查看他人的消息；管理端只统计聚合数据，不展示个人正文。
- 已读/归档是个人操作，不写审计，避免审计表被高频读写撑大。
- 正文含金额与客户名称，接口必须 `no-store`，不进入共享缓存；日志不记录正文。
- 桌面通知的内容会进入操作系统通知中心，属于用户可见范围；不在 URL 或日志里放敏感字段。

## 6. 阶段与验收

### 6.1 阶段 3 核心

- 创建 `notification_inbox_items`，启用 `IN_APP` 渠道与三个事件的站内策略。
- 实现第 3 节全部接口。
- 顶栏铃铛替换 fake 数据；新增 `/notifications` 页面。
- 30 秒轮询、聚焦刷新、操作后刷新、多标签选主。
- 单列表 + 状态/业务域筛选、已读、全部已读、归档、取消归档。
- 保留期清理。

### 6.2 可选增强

- 桌面浏览器通知：开关、权限、逐条弹、详情、点击跳转、退出清理。
- 不进入阶段 3 核心验收；上线后观察开启率、点击率与投诉。

### 6.3 验收

1. 三个事件的站内条目与站外收件人一致。
2. 未读数口径正确：已读、归档、取消归档、全部已读后立即变化。
3. 30 秒轮询在页面隐藏时暂停，聚焦时立即刷新；操作后立即刷新。
4. 多标签只由主标签轮询，其他标签仍能更新铃铛。
5. 业务域筛选正确映射到 `eventType`，不存在的域返回 422。
6. 其他用户无法通过 ID 读取、已读、归档本站内消息。
7. 桌面通知只在桌面显示开关；页面隐藏时逐条弹；页面可见时不弹；退出登录后不再弹。
8. 页面关闭后没有提醒，帮助文案与实际行为一致。

## 7. 不做与后续

- 不做 Web Push、Service Worker 推送、页面关闭后的浏览器通知。
- 不做用户级通知偏好、按事件关闭、免打扰时段。
- 不做删除；归档可逆。
- 不做管理员查看他人站内消息。
- 不做按业务域拆页签、SSE/WebSocket。
- 阶段 2 的 `PURCHASE_PAYABLE_PENDING` 等事件按同一模型接入；业务域映射先按第 2.4 节，未确认的域在实施前定稿。

## 8. 风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 批量事件逐条弹 | 一次创建多张采购单会连续弹多个系统通知 | 当前按逐条实现；观察投诉，必要时再评估熔断/摘要 |
| 锁屏泄露 | 金额、客户名称进入系统通知中心 | 共享电脑提示；偏好按用户存；退出关闭本页通知 |
| 后台节流 | 隐藏标签的 30 秒计时器可能被降到约 1 分钟 | 明确尽力而为；聚焦时补拉 |
| 权限被拒绝 | 无法再次自动申请 | 开关显示阻止状态与设置指引 |
| 多标签重复 | 同一消息弹多次 | 主标签选主 + `tag` + 已见 ID |
| 游标同时间戳 | 同一批消息 `createdAt` 相同 | 游标编码 `(createdAt, id)`；客户端 LRU 去重 |
