# 销售收款审核与资金入账验证记录

日期：2026-09-08。分支：`feat/finance-purchase-workbenches`。

## 授权与环境

用户已确认按实施清单修改应用代码、公共 API、schema/migration、权限与受控资金来源，并运行隔离测试。未应用业务库 migration、未修改业务汇率/余额、未新增角色、未推送或发布。

- PostgreSQL 16 临时容器，数据库 `receipt_test`；新收款服务及 HTTP 套件各自创建 `receipt_case_*` 子数据库，结束后关闭连接并清理。
- 全量 E2E 使用仓库 `scripts/ci-postgres.mjs` 创建新的 `qianshu_ci` 数据库。
- 浏览器：独立 Web `http://127.0.0.1:9100`，Server `http://127.0.0.1:3100`；媒体位于系统临时目录，账户和订单均为合成夹具。
- 业务端口 9000/3000 与业务数据库不作为本次新增行为的测试目标。

## 先失败再实现

- 媒体引用测试新增“驳回申请保留凭证”，原实现返回 false，修复显式引用集合后通过。
- 数据库新表/延期约束测试先在原 43 条 migration 的隔离库运行：表不存在、触发器缺失；追加两条 migration 后通过。
- 资金新事务端口与非收入规则测试先观察能力缺失/未拒绝，再实现受控入口和规则约束。
- 销售换汇单元测试和 Web 菜单/申请 API 契约先验证旧行为，再实现。

## 已验证证据

| 验证 | 实测结果 |
| --- | --- |
| 资金模块单元测试 | 23 套、323 项通过 |
| 资金原真实 PostgreSQL 回归 | 全新库应用全部 45 条 migration 后，2 套、6 项通过 |
| 收款 schema、历史 migration、HTTP 权限与资金守卫 | 4 套、14 项通过 |
| 历史 migration | 存量收款金额保持，标记 LEGACY，原账户余额不变；新 LEGACY 插入被拒绝 |
| 数据库资金守卫 | 孤立入账、未作废直接冲正、追加原分录、多余冲正分录被拒绝；合法完整冲正通过 |
| HTTP 权限 | 未登录 401；销售/财务读取独立；撤销审核权限立即 403；旧 payment POST 明确 409；销售收款权限不能纠错 |
| 媒体与权限目录单元检查 | 4 套、18 项通过 |
| 真实浏览器审核 | 驳回→重提→通过，100 TWD / 4.8 = 20.83 CNY，用户 6.25，公司 14.58 |
| 收款服务真实 PostgreSQL | 13 项通过，覆盖并发申请、双审核、审核/驳回竞争、汇率更新竞争、四个写入点及审计故障回滚、0%/100% 冲正 |
| 真实浏览器负余额 | 用户入账 6.25 后以合成管理员调账支出 6.25；作废按原分录扣用户 6.25、公司 14.58，用户余额 -6.25，订单已收归零 |
| 真实浏览器布局与权限 | 390px 亮暗色无横向溢出；键盘、焦点正常；仅财务读取权限可查看待审申请，审核/驳回按钮不可见 |
| 根测试 | `node --run test:root`，693 项通过 |
| Server 检查 | `pnpm -C server check`，263 套、2799 项单元测试通过，schema、类型及 lint 通过 |
| Web 检查 | 1190 项测试通过，应用/脚本类型检查、eslint/stylelint 通过 |
| 契约 | Server/Web OpenAPI 同步，`contract:check` 通过 |
| 完整 Server E2E | `node --run ci:server-e2e` 退出 0；公共套件 57 套、351 项通过；默认跳过的 4 套、10 项媒体用例随后独立运行全部通过；总计 361 项 |
| 原有 Chrome 回归与构建 | `node --run ci:browser-auth-e2e` 退出 0；两端正式构建成功，认证、管理员、产品媒体、采购和销售 5 项全部通过 |
| Migration 重复执行 | 全新隔离库应用 45 条 migration；再次 deploy 无待执行项，status 显示 schema 最新 |

`node --run check` 首次运行在最后的管理员浏览器旧权限目录断言处失败；此前根测试、Server/Web 检查和契约均通过。修复该测试后完整重跑浏览器入口通过，未把首次根命令描述为退出 0。最后一次服务内部汇率锁序调整已由真实服务 13 项、Server lint、正式构建和最终全量数据库回归覆盖。

浏览器证据保存于本机临时目录 `/tmp/qianshu-receipt-test-CfNobx/`：`approval-preview-desktop.png`、`resubmitted-desktop.png`、`queue-light-390.png`、`queue-dark-390.png`、`void-result-dark-390.png`、`order-void-result-desktop.png`、`reader-pending-no-actions.png`、`browser-final-proof.json`。这些合成数据与截图不进入仓库。

浏览器仅财务读取账户未额外覆盖“尚未作废的已通过申请隐藏作废按钮”；对应 HTTP 作废权限阻断已实测，界面权限条件已检查。

## 失败与修复说明

- 一次测试命令 `pnpm test -- --runInBand` 将参数当作 Jest 匹配模式，未运行测试；改为 `pnpm exec jest --runInBand` 执行。
- 原测试固定权限目录与 Controller provider 未包含新领域，已随真实权限和依赖更新；保留原行为边界验证。
- 初次媒体夹具目录权限 0755 不符合安全存储契约，改为临时目录 0700、文件 0600；未降低应用安全检查。
- 首轮全量 E2E 发现新夹具污染共享初始账户/汇率/管理员状态；新收款服务及权限套件改为独立子数据库，不通过删除不可变账目清理。
- 并行生成 Prisma Client 与测试曾造成短暂生成文件缺失；后续生成与依赖其产物的测试串行。
- 根检查首次运行到管理员浏览器回归时，权限目录断言未包含三个新增财务权限；更新该测试期望，重新运行完整五项浏览器回归。
- 第二轮全量 E2E 出现编号生成测试 201→404、采购鉴权测试 403→401。原样定向分别 10/10、34/34 通过，未修改生产逻辑或放宽断言；最终完整重跑两项均通过。现有日志不足确认这两次偶发失败的根因，保留为测试稳定性观察项。

## 最终日志

- 根检查：`/tmp/qianshu-receipt-final-check.txt`（保留首次失败）、`/tmp/qianshu-receipt-root-final.txt`。
- 最终契约：`/tmp/qianshu-receipt-contract-final.txt`。
- 最终全量数据库：`/tmp/qianshu-receipt-e2e-recheck.txt`。
- 最终五项 Chrome：`/tmp/qianshu-receipt-browser-final.txt`。
- 资金/权限/数据库守卫：`/tmp/qianshu-receipt-boundaries.txt`。

## 启用前事项

- 业务库执行两条新增 migration 前备份数据库，并协调旧前端刷新；旧直接收款入口升级后明确拒绝。
- 核对 `ORDER_SETTLEMENT` 当前启用、规则为收入分账，开单人已有账户，币种已启用且具备有效汇率；不会自动开户或启用管理员停用的规则。
- 三项新权限仅默认授予系统管理员。新增岗位或用户角色分配另行操作。
- LEGACY 收款作废只影响原收款事实，不扣未曾入账的资金；新收款按原分录冲正，允许负余额。
