# 店小二开发工作流 Skill v1

> 本文档是店小二项目内部开发工作流 SOP，用于规范后续需求从想法、审查、开发、验收、上线到冻结的完整路径。它不替代具体需求文档、架构文档、开发记录或冻结记录。
>
> 当前执行入口为 [Workflow V2](E_SHOP_FOUNDER_GATED_AGENT_DEVELOPMENT_WORKFLOW_V2.md)、AGENTS 及适用的发布规则。本次仅替代已过时的串行分工、main 自动部署和仅 STRICT 开线说明；原文字保留在 Git 历史 `833aabe1`。以下能力回归、安全、迁移及真实验收要求继续适用，不形成第二条串行审批链。

## 1. 当前适用范围

适用于店小二（Light Ops Assistant）项目的商户端、顾客端、电脑收银台、离线收银、会员系统、支付、AI Photo、AI Support、Dashboard、Records、Products、Home、Sale、Invite、Desktop、Menu、Cashier 等模块的后续开发。

当前项目状态基线：

- 会员系统 V1 已完成并真机通过，后续会员相关改动必须保护已通过链路。
- Browser-Setup-01 已完成，后续涉及关键页面变更时应优先使用 Browser / Playwright 做基础验收。
- Member-TG-01A 后端底座已冻结，后续 Telegram 会员能力必须在冻结底座上小步追加。
- /cashier PWA、离线收银 Offline-01/02/03D/03E-1 等阶段已形成冻结链路，后续不可随意改核心逻辑。
- CASH / KHQR / Records / OfflineSaleSyncMap / Telegram auth / 顾客 H5 下单属于保护链路。

## 2. 核心原则

1. 小步推进，不做大而全重构。
2. 每次任务只改用户明确要求的范围。
3. 重要改动必须先留 Obsidian 记录，再进入开发。
4. 涉及架构、数据库、支付、主链路、权限、Telegram 绑定、安全边界的任务，必须先审查。
5. Codex 负责小步落地、验证、提交、部署与同步记录。
6. Browser smoke 是线上基础验收，不替代真机测试。
7. 真机测试通过后才能冻结。
8. 不能只说 done，必须给可复核的验收结果。
9. 生产 migration 必须单独执行、单独验证，不允许依赖 Vercel build。
10. Obsidian 是最终知识沉淀入口，重要开发、故障、冻结都必须同步。
11. 任何新开发线路必须先通过 Production/Mainline Lineage Gate；“origin/main 最新”不能替代血统检查。
12. FIELD VERIFIED 只代表真实环境验收通过，不等于 CLOSED。
13. Production Release 前不得跳过已有 FIELD VERIFIED capability regression tests。

## 3. 标准工作流总览

标准路径：

```text
获取 Current Production SHA
→ git fetch origin
→ 获取 origin/main HEAD
→ ./scripts/check-release-lineage.sh <production_sha>
→ Lineage Gate PASS
→ 检查 working tree CLEAN
→ 创建独立 feature branch / worktree
→ 按 Workflow V2 判级、核验适用授权和最终交付目标
→ 授权内自主实施、相关测试及必要独立审查
→ 本地 commit
→ 按明确授权完成 main 准入及受保护发布准备
→ 获准发布后读回实际 Production SHA / READY
→ production migration（如有）
→ Browser / Playwright 验收
→ 真机测试
→ Release Closure Lineage Check
→ Obsidian 冻结 / CLOSED
```

按 Workflow V2、Risk-Based Delivery 和 UI Fast Path 选择实际适用步骤。数据库、主链路、支付、权限、会员余额、离线订单及 Telegram 绑定保留全部适用高风险门禁；普通进度、证据整理和授权内审查交接不另交 Founder 或 ChatGPT 中转。

## 4. 阶段职责边界

### 4.0 新开发线路 Release Lineage Gate

新 feature branch / worktree 创建前，必须按以下顺序执行：

1. 从现有可靠 deployment metadata 或人工确认取得 Current Production SHA。
2. 执行 `git fetch origin`。
3. 取得 `origin/main` HEAD。
4. 在准备作为开发基线的干净 worktree 中执行：

   ```bash
   ./scripts/check-release-lineage.sh <production_sha>
   ```

5. 以当前脚本的 `RESULT: PASS` 和 `Safe Development Base: YES` 为准。`STRICT` 是默认；仅在其因祖先分叉失败且工作树干净时，按 [Selective Release §2](../governance/ES-RELEASE-SELECTIVE-LINEAGE-GOVERNANCE-01.md) 使用脚本验证的 `CONTENT_SUBSET`。

脚本参数缺失、Production SHA 不存在、`origin/main` 不存在、血统无法判断或 working tree DIRTY 时，一律不得默认 PASS。

不能仅因祖先分叉否认已由现行脚本验证的开发来源证明；也不能把 `CONTENT_SUBSET` 当成语义等价、发布授权或 Closure 证明。脚本不能证明安全基线时仍停止，不得用“main 已更新”绕过门禁。

新开发线路回报必须包含：

```text
Production SHA:
origin/main SHA:
Production Is Ancestor Of origin/main: YES / NO
Lineage Mode: STRICT / CONTENT_SUBSET
Working Tree: CLEAN / DIRTY
Safe Development Base: YES / NO
```

### 4.1 Obsidian 记录范围

用途：先把目标、边界、禁止事项、风险和批次写清楚。

必须记录：

- 当前背景
- 本轮目标
- 明确不做内容
- 保护链路
- 数据库是否涉及
- 计划批次
- 风险点
- 验收标准

适用：会员系统 V1、Member-TG、离线收银、支付、AI、Dashboard 统计口径、重大 UI 风格统一。

### 4.2 Claude 审查

用途：架构审查、风险审查、数据库变更审查、主链路改动审查。

Claude 不直接大改代码。Claude 输出：

- 风险等级
- 是否允许进入 Codex 小步开发
- 必须保护的文件/链路
- 可执行收口建议
- 必须暂停的条件

### 4.3 ChatGPT 收口

用途：CTO 提供目标、边界和必要决策建议。日常任务由执行者按 Workflow V2 自主收口、协调审查；本节是任务信息提示，不要求每轮等待 ChatGPT 转发。

必须输出：

- 当前背景
- 本轮目标
- 修改范围
- 明确不做什么
- 验收点
- 执行命令
- 回报格式

### 4.4 Codex 小步开发

用途：最小改动落地。

Codex 必须：

- 优先 grep 精准定位
- 不长时间 architecting
- 不全量重构
- 不扩大范围
- 发现需要大改时先停下汇报
- 用 apply_patch 或合理工具改文件
- build/test/smoke 通过后再 commit
- 发生获准部署后确认实际候选 SHA 和 Vercel READY；普通 push 或 main 合并不等于生产部署
- 同步 Obsidian

### 4.5 build / smoke / 部署

基础命令：

```bash
npx prisma generate   # schema 变更后必须跑
npm run build         # 所有开发任务必须跑
npm run test:smoke:prod # Browser-Setup-01 后关键页面任务优先跑
```

Production Release 前必须先执行仓库中与本次影响范围及既有 FIELD VERIFIED 能力对应的专项 regression tests。已有测试不得跳过；任一相关测试 FAIL，Production Release 必须 BLOCKED。当前至少保护：

- Product Discount
- OWNER Multi-Store Hub
- Customer Display
- Printing / Tray
- 仓库中其他已经存在专项 regression tests 的 FIELD VERIFIED capability

V1.0 只复用现有测试，不建设新测试平台。

main 准入与生产部署是不同受控动作。按当前受保护发布分支、Selective Release validator 及 Founder 本次授权执行；`git push origin main` 不是部署命令，也不自动授权更新 release。部署后可用 `npm run vercel:current` 核对实际结果。

### 4.6 production migration

只在以下条件满足时执行：

- migration 文件已 commit/push
- Vercel Production 已部署到目标 commit 或用户明确要求先迁移
- 已确认 DATABASE_URL / DIRECT_URL 指向生产库
- 已确认 migration 文件存在
- 已确认没有待处理失败 migration

执行：

```bash
npm run migrate:prod
DATABASE_URL=$DIRECT_URL npx prisma migrate status
```

注意：`DATABASE_URL` 运行时用 6543 pooler，migration 必须使用 `DIRECT_URL` 5432 直连。

### 4.7 Browser 验收

Browser-Setup-01 已完成。后续涉及 /home、/members、/cashier、/records 等关键页面时，优先运行：

```bash
npm run test:smoke:prod
```

当前覆盖：

- /home
- /members
- /cashier?storeCode=ST169E7000
- /records

检查：

- 页面能打开
- 非 404 / 500
- 不白屏
- body 有内容
- 捕获 pageerror
- 捕获 console error 并留报告
- 检查常见故障文案
- 保存截图

Browser smoke 不替代 Telegram 真机测试。

### 4.8 真机测试

用于最终确认 Telegram Mini App、手机浏览器、扫码、收银、会员、顾客下单等真实体验。

真机测试包括：

- iPhone Telegram WebView
- Android Telegram WebView（如可用）
- OWNER / STAFF
- 顾客 H5
- /sale 搜索、扫码、AI、CASH、KHQR
- /cashier CASH、KHQR、会员余额、离线提示/同步
- /members 列表、详情、导入、充值、调整
- /records 记录生成与展示

### 4.9 Obsidian 冻结

正式定义：

- **FIELD VERIFIED**：真实设备 / 真实环境验收通过。
- **CLOSED**：FIELD VERIFIED + 对应代码已进入 `origin/main` + Production Git SHA 与 main 血统一致 + Known Capability Regression 为 NO。
- `FIELD VERIFIED ≠ CLOSED`。

真机验收通过后还必须执行最终 Closure Check：

```text
Production SHA:
origin/main HEAD:
Release Lineage / authorized selective mapping: <按当前发布规则核验；不能用开发 CONTENT_SUBSET 代替>
Capability Field Verification: PASS
Known Regression: NO
Final Status: CLOSED
```

冻结条件：

- build 通过
- smoke 通过（如适用）
- Vercel READY
- production migration 已执行并验证（如有）
- Browser 验收通过（如适用）
- 真机测试通过
- 关键禁止事项未违反
- Obsidian 开发记录已同步
- Release Closure Lineage Check 已通过

冻结记录必须写：

- 冻结结论
- 冻结 commit
- 修改文件
- 是否改数据库
- migration 状态
- Vercel 状态
- Browser 验收结果
- 真机测试结果
- 未做事项
- 后续禁止事项

## 5. 任务分级

### P0：必须立即处理

例：生产 500、收银失败、会员余额扣错、CASH/KHQR 主链路断、数据库 migration 漏执行、严重安全问题。

要求：先取证，再修复；必要时可跳过规划，但必须记录 Obsidian。

### P1：重要收口

例：已上线功能真机问题、页面关键入口不可用、API 上下文失败、Browser smoke 发现关键错误。

要求：小步修复，build/smoke，push/READY，记录。

### P2：计划内增强

例：Member-TG-01B、Dashboard 提示、记录页标签、页面 UI 优化。

要求：先收口范围，必要时 Claude 审查，再 Codex 小步开发。

### P3：探索和增值层

例：Mino Runtime、复杂 AI 自动化、会员营销、积分等级、自动发券、顾客会员中心。

要求：先写设计，不直接开发。

## 6. Codex 可直接执行的任务

Codex 可直接执行：

- 明确范围的小 UI 修复
- 明确 API bug 修复
- 文档同步
- Obsidian 记录
- Browser smoke 搭建和运行
- 已审查通过的小 migration
- 已明确的后端 API 小步开发
- 只读检查和状态确认

前提：不越界、不改受保护主链路。

## 7. 必须先交给 Claude 审查的任务

以下任务先交 Claude：

- 数据库结构设计或唯一约束设计
- 支付、余额、会员账务、离线同步
- Telegram 绑定、安全 token、身份合并
- CASH / KHQR / records 统计口径
- Dashboard 财务口径
- 权限系统、身份上下文、auth-session
- 大范围页面架构或导航规则
- 顾客端和商户端状态机

## 8. 必须暂停并汇报的高风险情况

Codex 遇到以下情况必须暂停：

- 需要 reset / drop / db push
- 需要删除生产数据
- migration 已部分失败
- 表存在但 migration 记录不存在
- 发现生产数据冲突会导致唯一约束失败
- 需要改 CASH / KHQR / /sale / /cashier 主流程
- 需要改 OfflineSaleSyncMap 或离线同步幂等
- 需要改变 records/dashboard 统计口径
- 需要引入新第三方服务或 token
- 发现需求需要大改架构

## 9. 数据库 migration 规则

1. schema 变更必须新增 Prisma migration。
2. 不允许手工改历史 migration。
3. 不允许生产 db push。
4. 不允许 reset。
5. 所有新增字段优先 nullable，除非完全确定历史数据安全。
6. 唯一约束前必须检查生产数据冲突。
7. build 不执行 migration。
8. production migration 单独执行并记录。

## 10. Browser / Playwright 验收规则

Browser smoke 当前是最小线上验收能力。关键页面改动后必须优先运行：

```bash
npm run test:smoke:prod
```

如果失败：

- 先看截图
- 再看 console error JSON
- 再看 pageerror / trace
- 不要只根据 HTTP 200 判断成功

当前 smoke 不做：

- 真实 Telegram 登录态
- 创建会员
- 下单
- KHQR 真支付
- 会员余额扣款

这些进入真机验收。

## 11. 真机测试规则

真机测试只在 Production READY 后进行。

测试前必须确认：

- 固定待验 Product Candidate / tree 与实际部署一致，另记当前 Governance Head
- Production commit = 目标 commit
- 满足当前 Release Lineage 或获准选择性发布的精确来源映射及正式 validator 要求
- Deployment State = READY
- production migration 完成（如有）

真机结果必须回写 Obsidian。

## 12. 回报模板

通用回报：

1. 修改结论
2. 修改文件
3. 是否改业务逻辑
4. 是否改数据库
5. migration 名称 / 状态
6. build 结果
7. smoke 结果
8. commit hash
9. 是否已 push
10. Vercel Production commit
11. Deployment State
12. Obsidian 是否同步
13. 需要验证的点

不能只回：done / 已完成。

## 13. 冻结标准

一个阶段可冻结必须满足：

- 功能达到本阶段目标
- 明确未做事项
- build 通过
- smoke 通过（如适用）
- production migration 已验证（如有）
- 真机通过
- 未破坏保护链路
- Obsidian 冻结记录已写

冻结后：除严重 bug，不继续顺手优化。

## 14. 常用 prompt 模板索引

模板目录：`docs/prompts/store-assistant-workflow/`

- `01_CLAUDE_REVIEW_PROMPT.md`：Claude 架构 / 风险审查
- `02_CHATGPT_CLOSING_PROMPT.md`：ChatGPT 收口成 Codex 任务
- `03_CODEX_SMALL_STEP_DEV_PROMPT.md`：Codex 小步开发
- `04_CODEX_DOCS_ONLY_PROMPT.md`：Codex 只改文档
- `05_BROWSER_SMOKE_PROMPT.md`：Browser / Playwright 验收
- `06_REAL_DEVICE_TEST_PROMPT.md`：Telegram / 手机真机测试
- `07_OBSIDIAN_FREEZE_PROMPT.md`：Obsidian 冻结记录
- `08_PRODUCTION_MIGRATION_PROMPT.md`：生产 migration 执行与验证
