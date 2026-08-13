# 统一媒体资产与产品媒体需求规格

## 1. 文档状态

- 状态：Requirements 与 Design 已编写，等待 Phase 2 确认
- 编写日期：2026-08-13
- 适用范围：`server/`、`web/apps/qsmds-arco`、单机生产部署配置
- 规划分支：`feat/media-asset-product-media`
- 关联规格：`specs/product-list/`、`specs/product-create/`、`specs/product-view-edit/`
- 实施门禁：本文只定义后续实施合同；数据库 Schema、公共 API、代码、依赖和部署配置仍需单独确认后方可修改

## 2. 背景与目标

当前 Product 使用 `mainImage: String?`、`images: String[]`、`videos: String[]`
保存外部 URL，创建与编辑 DTO 则明确拒绝媒体字段。该结构不能可靠管理上传、私有访问、排序、
引用、删除、备份和未来其他业务域的文件。

本规格建立业务中立的 `MediaAsset` 媒体基础设施，并在本期只建立 Product 与媒体资产之间的
显式 `ProductMedia` 领域关联。生产环境按单台服务器、媒体总量约 10GB 起步，首期采用本地
持久目录；业务与 API 不依赖绝对路径或永久公开 URL，以保留未来迁移对象存储的能力。

本期同时实现 `IMAGE`、`VIDEO`、`DOCUMENT` 三类基础资产能力，但 ProductMedia 只能关联
`IMAGE` 与 `VIDEO`。产品说明书、证书和任何其他 Document 均不属于 ProductMedia。

## 3. 当前真相源与覆盖关系

1. 当前数据库真相源是 `server/prisma/schema.prisma` 中 Product 的三个 URL 字段。
2. 当前 HTTP 真相源是 Products Controller、Product DTO、全局
   `whitelist + forbidNonWhitelisted` 和生成后的 OpenAPI 契约。
3. 当前 Web 真相源是 `web/apps/qsmds-arco/src/views/admin/product-management/` 下的产品页面。
4. 当前权限真相源是数据库 `Permission`、角色授权和 Server `PermissionGuard`；路由
   `meta.auth` 只用于前端体验。
5. 本规格一经实施，将只覆盖既有产品规格中“媒体使用 URL 字段”“媒体只读”及“暂不上传”
   的相关段落；产品编号、供应商、金额、属性、状态和其他已确认合同保持不变。
6. 在实施完成前，既有 URL 字段、API 响应和 Web 展示仍是当前运行时事实，不得提前宣称已替换。

## 4. 已确认业务决策

1. 建设统一、业务中立的 `MediaAsset` 基础设施。
2. 本期只实现 `ProductMedia` 领域关联，不创建订单、采购、仓库或其他假设业务域的关联表。
3. 未来真实业务域出现时，应新增该域自己的显式外键关联表，不使用
   `ownerType + ownerId` 泛化多态归属。
4. `MediaAsset` 支持 `IMAGE`、`VIDEO`、`DOCUMENT`。
5. `ProductMedia` 只允许 `IMAGE`、`VIDEO`，明确禁止 `DOCUMENT`。
6. 产品主图必须从该产品当前有效的图片关联中选取，不复制文件或保存另一条 URL。
7. 首期媒体为内部私有媒体，不提供匿名访问、永久公开 URL 或公共媒体库。
8. 产品媒体读取能力与产品资料读取能力解耦；未来订单等内部角色可以仅获得产品媒体读取权限。
9. 首期采用本地服务器持久存储，并通过存储适配边界保留未来迁移对象存储的能力。
10. Product 创建请求继续不接收媒体；产品创建成功后再通过独立媒体能力维护。
11. Product 的媒体集合与 Product 共用 `version` 进行乐观并发控制。
12. 不做视频转码、封面抽帧、图片编辑、公开分享或内容分发网络。

## 5. 术语与数据口径

### 5.1 MediaAsset

`MediaAsset` 表示一份物理文件及其不可伪造的服务端元数据。它不直接表达“属于哪个产品”或
“用于哪个订单”，也不保存业务域多态 owner。

### 5.2 ProductMedia

`ProductMedia` 表示 Product 对 `MediaAsset` 的领域引用，负责图片/视频分类、顺序、主图语义
和解除关联。删除 ProductMedia 不等同于立即物理删除 MediaAsset。

### 5.3 objectKey

`objectKey` 是存储适配层使用的相对对象标识。它不是绝对文件路径，不包含用户原始目录，
也不是可直接访问的永久 URL。

### 5.4 内部私有媒体

只有已认证且通过真实 RBAC 的内部用户才能通过领域授权路由读取文件。Nginx 内部路径和本地
持久目录不得直接暴露给浏览器。

### 5.5 Document

Document 是 `MediaAsset` 的基础类型。本期只验证、持久化并提供内部服务合同，不为 Product
提供关联、上传入口、维护界面或内容下载入口。

## 6. Requirements 与 Acceptance Criteria

### Requirement 1 - 统一媒体资产边界

**User Story:** 作为系统维护者，我希望所有真实文件共享同一套资产基础设施，同时每个业务域保留清晰的引用边界。

#### Acceptance Criteria

1. 当媒体基础设施建立时，系统应使用独立 `MediaAsset` 保存物理文件元数据和生命周期状态。
2. 当 Product 使用媒体时，系统应通过显式 `ProductMedia` 外键关联，不得在 Product 中继续写入新 URL。
3. 当未来出现真实新业务域时，该域应新增自己的关联表和授权路由，不得向 MediaAsset 增加
   `ownerType`、`ownerId` 或无外键的业务身份。
4. 当本期实施完成时，系统不得创建 `OrderMedia`、`PurchaseOrderMedia`、
   `WarehouseReceiptMedia` 或其他仅源自示例的结构。
5. 当基础设施被业务域调用时，业务域应传入允许的媒体类型策略，MediaAsset 不得反向依赖 Product。

### Requirement 2 - MediaAsset 数据完整性

**User Story:** 作为系统维护者，我希望数据库能够可靠描述文件身份、内容和状态，以便校验、恢复、备份和迁移。

#### Acceptance Criteria

1. 当上传开始并创建 MediaAsset 时，系统应先保存 UUID、媒体类型、存储驱动标识、原始文件名、
   UPLOADING 状态、超期时间、创建人和时间；此时尚未取得的内容元数据应为 `null`。
2. 当 MediaAsset 进入 READY 前，系统应保存唯一 `objectKey`、可信 MIME、字节数和 SHA-256；
   缺少任一必需内容元数据时不得进入 READY。
3. 当资产为图片时，系统应保存可信 `width` 与 `height`；当资产为视频时，系统应保存可信
   `durationMs`、画面尺寸和编解码信息。
4. 当某项元数据不适用于资产类型时，系统应保存 `null`，不得伪造零值。
5. 当上传未完成、验证失败、可用、进入回收站或完成物理清理时，系统应使用明确状态表达，
   不得仅凭文件是否存在推断生命周期。
6. 当 MediaAsset 已被业务域关联时，`mediaType`、SHA-256、字节数和对象身份不得原地改写；
   替换内容应创建新资产。
7. 当 API 返回 `sizeBytes` 时，应使用十进制字符串，避免 JavaScript 数值精度或 OpenAPI 类型歧义。

### Requirement 3 - ProductMedia 关联与主图

**User Story:** 作为产品维护人员，我希望为产品维护有序图片、主图和视频，而不会把 Document 错挂到产品。

#### Acceptance Criteria

1. 当创建 ProductMedia 时，关联的 Product 与 MediaAsset 必须真实存在。
2. 当 ProductMedia 类型为 `IMAGE` 时，只能引用 `MediaAsset.mediaType=IMAGE`；类型为 `VIDEO`
   时只能引用 `MediaAsset.mediaType=VIDEO`。
3. 若任何调用尝试把 `DOCUMENT` 关联到 Product，则 Server 和数据库完整性边界均应拒绝。
4. 当产品设置主图时，目标必须是该产品当前有效的图片关联；视频不得成为主图。
5. 当产品已有主图时，再设置另一主图应在同一事务内原子替换，任一时刻最多一个有效主图。
6. 当产品没有图片时，主图应为 `null`；当主图图片被解除关联时，系统不得静默选取另一图片。
7. 当图片或视频排序提交成功时，系统应保存同类型内从零开始、连续且唯一的顺序。
8. 当同一资产已与同一产品有效关联时，系统应拒绝重复关联。
9. 当产品媒体达到上限时，系统应拒绝继续添加；每个产品最多 20 张图片和 5 个视频。

### Requirement 4 - 文件类型与内容验证

**User Story:** 作为管理员，我希望系统只接受明确允许且内容真实匹配的文件，避免把危险或不可播放内容当作产品媒体。

#### Acceptance Criteria

1. 当上传图片时，系统应只接受 JPEG、PNG、WebP，单文件不得超过 10MiB。
2. 当上传视频时，系统应只接受 MP4 容器、H.264 视频；音轨存在时只能为 AAC，单文件不得超过 500MiB。
3. 当内部服务接收 Document 时，应只接受 PDF、DOCX、XLSX，单文件不得超过 50MiB。
4. 当文件扩展名、客户端 MIME、magic bytes 或可解析内容互相冲突时，Server 应拒绝文件。
5. 当图片无法完整解码，或视频无法取得可信容器、codec、时长和尺寸时，Server 应拒绝文件。
6. 当 OOXML Document 不是对应的有效 ZIP 包结构、包含宏、加密内容或异常解压规模时，
   Server 应拒绝文件。
7. 当收到 SVG、HTML、脚本、可执行文件、压缩包、宏文档或仅靠改后缀伪装的文件时，
   Server 应拒绝。
8. 当客户端校验通过但 Server 校验失败时，应以 Server 结果为准，并返回安全、可定位的错误码。
9. 当本期 Product 上传入口被调用时，即使文件本身是合法 Document，也应因 ProductMedia
   类型策略而拒绝。

### Requirement 5 - 本地存储与故障恢复

**User Story:** 作为运维人员，我希望单机环境安全保存约 10GB 媒体，并能处理上传中断和进程崩溃产生的残留。

#### Acceptance Criteria

1. 当使用本地存储时，媒体根目录应是 release 目录之外的绝对持久路径，建议
   `/var/lib/qianshu-dms/media`，不得位于 `server/dist`、源码目录或系统临时目录。
2. 当写入文件时，Server 应流式写入 staging，并在同一文件系统完成验证后原子移动到最终对象路径，
   不得把完整大文件读入内存。
3. 当原始文件名包含路径、控制字符或特殊字符时，只能作为受长度限制的展示元数据，
   不得参与磁盘路径计算。
4. 当上传在任一阶段失败时，系统应留下可对账状态，并由清理任务回收超期 staging 或无引用最终文件。
5. 当进程在文件移动与数据库提交之间崩溃时，定期对账应识别数据库/文件系统不一致，
   不得把未知文件直接暴露为 READY。
6. 当本地磁盘空间不足、根目录不可写或 storage 配置无效时，系统应失败关闭写入能力并暴露健康告警。
7. 当对象存储在未来替换本地存储时，业务表和领域 API 不应依赖绝对路径；迁移应通过
   `storageDriver + objectKey` 和校验和进行对账。

### Requirement 6 - 私有访问与未来订单使用

**User Story:** 作为内部用户，我希望在获授权的产品或未来订单界面查看产品主图，而无需获得全部产品管理权限。

#### Acceptance Criteria

1. 当用户读取产品媒体内容时，Server 应要求 Session 和独立 `product-media:read` 权限。
2. 当用户缺少 `product-media:read` 时，即使知道 MediaAsset ID、Product ID 或 objectKey，
   Server 也不得返回文件或可访问内部路径。
3. 当用户具有 `product-media:read` 但不具有 `products:read` 时，领域内容路由仍可在验证有效
   ProductMedia 关联后返回文件，以支持未来订单等内部场景。
4. 当用户读取 Product 列表或详情 JSON 时，仍应分别满足既有 `products:read` 权限。
5. 当 Nginx 提供文件时，只能消费 Server 返回的内部重定向；内部 location 不得允许外部直接访问。
6. 当读取视频时，服务链路应支持标准 byte Range；图片与视频应返回可信 Content-Type、
   `X-Content-Type-Options: nosniff` 和私有缓存策略。
7. 当未来业务需要冻结产品主图时，应通过该业务域自己的 MediaAsset 关联表达快照引用；
   不得复制 ProductMedia ID 到无外键字符串，也不得假设产品后来解除关联即可物理删文件。

### Requirement 7 - 产品媒体写入与并发

**User Story:** 作为产品维护人员，我希望上传、排序、设主图和删除操作不会覆盖其他人的并发修改。

#### Acceptance Criteria

1. 当用户上传、调整布局或解除产品媒体时，Server 应要求 `products:update`、Session、CSRF
   和 `expectedVersion`。
2. 当媒体写事务开始时，Server 应锁定 Product 并比较 `expectedVersion`；版本不一致应返回
   `409 PRODUCT_STATE_CHANGED`，且不得创建有效关联或覆盖排序。
3. 当长时间上传开始前，Server 应先快速检查产品和版本；文件验证结束后仍应在最终事务内重新锁定并复核。
4. 当 ProductMedia 发生真实变更时，系统应令 `Product.version + 1` 并更新 Product 审计身份与时间。
5. 当上传结果因网络或 `5xx` 未知时，Web 不得自动重传文件；应先重新读取产品并根据新关联、
   文件名、大小和服务端返回身份进行人工可理解的对账。
6. 当请求没有产生真实布局变化时，系统应返回当前快照且不得增加 Product 版本或写重复审计。
7. 当用户解除 ProductMedia 时，系统应软解除关联；只有资产不再被任何领域有效引用且保留期届满，
   才允许进入物理清理。

### Requirement 8 - 生命周期、保留与引用安全

**User Story:** 作为系统维护者，我希望删除操作可恢复且不会误删仍被其他业务引用的文件。

#### Acceptance Criteria

1. 当上传记录超过 24 小时仍未 READY 时，清理任务应把它视为超期候选并安全回收。
2. 当最后一个有效领域关联解除时，资产应先进入至少 7 天软删除保留期，不得立即物理删除。
3. 当保留期结束时，系统应再次检查全部已实现领域关联表；只要存在任一有效引用，便不得物理删除。
4. 当本期只有 ProductMedia 时，引用检查应显式查询 ProductMedia；未来新增领域关联表时，
   该领域的交付必须同步扩展引用检查和回归测试。
5. 当资产进入回收站后又被允许恢复关联时，系统应在物理清理前恢复为 READY 并取消清理时间。
6. 当物理文件已删除时，数据库仍应保留最小生命周期与审计事实，不得复用原 objectKey。
7. 当 ProductMedia 被软解除后，产品查询和内容授权路由均不得再把它视为有效媒体。

### Requirement 9 - 产品 API 数据合同

**User Story:** 作为 Web 开发者，我希望产品 API 返回结构化媒体，而不是泄露存储 URL 或本地路径。

#### Acceptance Criteria

1. 当本规格实施时，Product 列表与详情响应应以结构化 `media` 对象替换当前三个 URL 字段。
2. 当返回媒体项时，应包含 ProductMedia 身份、类型、顺序、主图标记、显示元数据和领域内容 URL，
   不得返回 objectKey、绝对路径、SHA-256 或存储内部状态。
3. 当返回主图时，`media.mainImage` 应为图片项或 `null`；`media.images` 应包含全部有效图片且保持顺序，
   主图可以同时出现在 images 中；`media.videos` 应保持视频顺序。
4. 当媒体为空时，系统应返回稳定的 `null` 和空数组，不得返回缺失字段或伪造 URL。
5. 当执行媒体写操作时，应使用独立 Product media operation，不得重新允许基础 Product
   create/update DTO 接收媒体字段。
6. 当公共 API 或生成客户端发生结构替换时，Server、OpenAPI、Web 适配器和测试应在同一实施阶段更新，
   不得手工修改生成快照掩盖差异。

### Requirement 10 - Product Web 维护体验

**User Story:** 作为桌面或移动端产品维护人员，我希望清楚看到上传进度、媒体顺序、主图和失败原因。

#### Acceptance Criteria

1. 当用户打开产品编辑页时，页面应提供独立的产品媒体区域，并根据权限显示只读或可维护状态。
2. 当上传进行时，Web 应显示单文件进度、类型、大小和可取消状态，不得只显示全页 spinner。
3. 当图片上传成功时，用户应能预览、排序、设为主图和解除关联；当视频上传成功时，用户应能预览、
   排序和解除关联，但不得设置为主图。
4. 当用户选择 Document 时，Product 页面应在客户端立即说明不支持，并且 Server 仍应再次拒绝。
5. 当图片或视频达到数量上限时，上传入口应被禁用并说明限制。
6. 当排序或主图有未保存变化时，页面应明确显示 dirty 状态；离开页面前应确认。
7. 当提交冲突时，Web 应保留本地预览和用户意图，提示加载最新媒体，不得自动覆盖服务端顺序。
8. 当媒体加载失败时，单项应显示可恢复错误态且不破坏其他媒体；不得展示内部对象路径。
9. 当屏幕变窄时，媒体卡片应使用单列或双列自适应布局，不得依赖横向滚动桌面表格。
10. 当用户只使用键盘或辅助技术时，应能上传、选择主图、调整顺序、删除和读取进度/错误状态。

### Requirement 11 - 审计、安全与可观测性

**User Story:** 作为管理员和审计人员，我希望媒体变更可追踪，但日志和审计不会泄露文件内容或存储细节。

#### Acceptance Criteria

1. 当 ProductMedia 发生真实变更时，系统应在 Product 写事务内记录现有 `PRODUCT_UPDATED` 审计事件。
2. 当审计写入失败时，ProductMedia 关联、Product 版本和 READY 状态提交应整体回滚；文件系统残留由对账任务处理。
3. 当记录审计时，应保留既有 Product 更新元数据，并固定 `changedFields=media`；媒体扩展只允许
   增加 action、productMediaId 和 mediaType，不得记录原始文件名、objectKey、SHA-256、文件内容、
   永久 URL 或完整请求体。
4. 当记录应用日志和指标时，应包含安全 requestId、阶段、结果、媒体类型和字节数量级；不得记录
   Cookie、Token、连接字符串或文件内容。
5. 当上传请求超过反向代理或 Server 限制时，应在读取完整请求体前尽早拒绝。
6. 当异常文件名用于响应 Header 时，应经过 CR/LF、路径和长度清理；Document 未来下载时必须使用 attachment。
7. 当监控生产存储时，应至少覆盖可用空间、staging 年龄、FAILED 数量、对账差异、上传失败率和清理结果。

### Requirement 12 - 数据迁移、备份与验收

**User Story:** 作为交付负责人，我希望既有 URL 数据不会被静默丢失，并能证明本地媒体可备份和恢复。

#### Acceptance Criteria

1. 当实施前检测到 Product 的 `mainImage/images/videos` 存在非空 URL 时，迁移应停止并报告精确计数与样例 ID；
   未经单独确认不得下载外部文件、清空字段或伪造 MediaAsset。
2. 当旧媒体字段全部为空时，迁移才可在同一已确认实施中建立新表、切换 API 后删除旧字段。
3. 当数据库 migration 应用时，应使用隔离 PostgreSQL 先验证约束、触发器、索引、回滚路径和现有 Product 行数不变量。
4. 当备份生产环境时，数据库备份和媒体目录备份应形成同一恢复点说明，并至少有一份副本位于本机故障域之外。
5. 当执行恢复演练时，应校验数据库引用、文件存在性、字节数和 SHA-256，不得只验证目录可见。
6. 当规划磁盘时，约 10GB 媒体规模下目标卷最低应为 30GB，建议 50GB，并配置容量阈值告警。
7. 当实施完成时，自动化应覆盖 DTO、magic-byte 验证、状态机、并发、引用安全、RBAC、Range、
   OpenAPI、Web 交互、数据库 E2E 和备份/对账脚本的安全 dry run。

## 7. UI Design Specification

- Purpose：在产品编辑上下文中完成私有图片与视频维护，同时清楚表达主图、顺序、进度和失败恢复。
- Aesthetic Direction：`Industrial/utilitarian`，延续现有 Fantastic-admin/Fa/Qs 管理后台，不使用营销型视觉。
- Color Palette：Ink `#0F172A`、Paper `#FFFFFF`、Mist `#F1F5F9`、
  Functional teal `#0F766E`、Warning `#B45309`、Destructive `#DC2626`；实现只消费既有语义 Token。
- Typography：正文使用 `Noto Sans SC`；文件大小、时长、尺寸、序号和技术状态使用 `Noto Sans Mono`。
- Layout：桌面采用约 `7/5` 非对称布局，左侧为媒体画布和排序，右侧为上传队列与规则；窄屏收敛为单列。
- Interaction：图标使用项目既有图标库；状态不能只依赖颜色；主要触控目标不小于 44px；支持 Dark、键盘和 Reduced Motion。

## 8. 非目标

- ProductMedia 关联 Document、产品说明书或证书。
- 建立公共媒体库、通用媒体管理页面或匿名上传/下载 API。
- 建立订单、采购、仓库等尚未确认业务域的媒体关联。
- `ownerType + ownerId` 多态媒体表。
- 视频转码、压缩、封面抽帧、在线裁剪、水印、OCR、病毒扫描服务或内容审核平台。
- CDN、跨区域复制、多机共享存储、高可用对象存储或直传云端。
- 根据 SHA-256 自动跨业务去重或让多个上传共享同一资产。
- Product 删除、批量媒体操作、外部分享链接或面向消费者的公开商品图库。

## 9. Phase 2 确认点

进入任务拆分和实施前，需要确认以下合同作为首期固定值：

1. 图片 JPEG/PNG/WebP、10MiB、每产品最多 20 张。
2. 视频 MP4 + H.264/AAC、500MiB、每产品最多 5 个，并要求生产机提供 `ffprobe`。
3. Document 仅为 MediaAsset 内部能力，允许 PDF/DOCX/XLSX、50MiB；Product 无任何 Document 入口。
4. 新增独立权限 `product-media:read`；媒体写入继续使用 `products:update`。
5. Product API 使用结构化 `media` 替换三个 URL 字段，不保留双写或长期兼容字段。
   `media.mainImage` 是对 images 中主图项的投影，不从 `media.images` 移除该项。
6. 本地软删除保留 7 天，未完成上传超期时间 24 小时。
7. 首期目标卷最低 30GB、建议 50GB，媒体备份必须离开同机故障域。
