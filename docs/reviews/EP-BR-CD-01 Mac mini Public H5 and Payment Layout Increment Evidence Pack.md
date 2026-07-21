# EP-BR-CD-01 Mac mini Public H5 and Payment Layout Increment Evidence Pack

## 范围与基线

- 基线修复提交：`9668561d1d47ca0c36a99ef8c24562b50948150e`
- 分支：`feat/ep-br-cd-01-customer-display-panel`
- 本证据包覆盖该基线之后的受控增量；它随本次独立增量提交一起归档。
- 本轮仅修复顾客 H5 二维码的公开入口，并作已批准的顾客屏视觉微调；未新增或修改 API、Schema、POS、实时协议、打印链或 Desktop Runtime。

## 阻塞问题与根因

顾客屏原先以当前浏览器页面的 `window.location.origin` 拼接 `/m/<storeCode>`。本地预验收时，这使左侧二维码编码为 `http://localhost:3000/m/ST169E7000`；手机扫描后其中的 `localhost` 指向手机自身，不能访问 Mac 上的服务。

## 邀请页公开链接来源与复用

- 邀请页面：`app/invite/page.tsx` 的 `CustomerCodeCard`。
- 既有公共 URL 基础规则：`lib/public-url.ts` 的 `publicUrl()` / `getPublicSiteUrl()`，优先使用公共站点配置，默认公共域名为 `https://elifekh.com`。
- 本轮在同一模块新增最小公共函数 `publicCustomerEntryUrl(storeCode)`：通过既有 `publicUrl()` 生成 `/m/${encodeURIComponent(storeCode)}`，并将公共默认域作为回退源，因此本地页面 origin 不会进入顾客二维码。
- 邀请页面和顾客屏均调用同一个 `publicCustomerEntryUrl()`；没有复制组件或创建第二套规则。

本地实际运行的二维码目标为：

`https://elifekh.com/m/ST169E7000`

该目标为 HTTPS，不含 `localhost`、`127.0.0.1` 或局域网 IP；`ST A/1` 的回归样例生成 `/m/ST%20A%2F1`。中文、英文和高棉语使用相同函数，因此不改变二维码目标。

## 顾客屏微调

- 右侧 KHQR：仅缩小白色容器内边距（7px 到 4px）、轻减外边距，并将图片最大宽度从 340px 调至 400px；仍使用原 `src`、`objectFit: contain` 和原始比例，没有 CSS `scale`、裁切或新请求。
- 左侧 H5：二维码承载卡的最大宽度从 178px 调至 158px（约缩小 11%），保留加入会员、查看商品、手机下单文字，且二维码仍仅在左栏。
- 支付提示：中文为“请核对金额后付款”与“付款完成后请告知店员”；英文和高棉语为同义简短顾客提示。没有暗示系统已自动确认收款。
- 商品清单：缩略图由 38px 调至 34px，商品行最小高度由 58px 调至 54px，并小幅收紧间距和垂直内边距；原四列信息结构、排序和金额计算未变。

## 浏览器与公开入口复验

- 本地顾客屏：`http://localhost:3000/desktop/display?storeCode=ST169E7000&lang=zh`
- 浏览器视口：1280 × 720，DPR 2。
- 顾客屏 DOM 检查：左栏顾客入口锚点为 `https://elifekh.com/m/ST169E7000`；左栏有 1 个 H5 SVG；右侧支付区有 1 张 KHQR 栅格图片、0 个 SVG，因此未混入顾客 H5 二维码。
- 中、英、高棉三种语言分别加载后，均得到完全相同的顾客入口 URL。
- 公共 H5 实测打开 `https://elifekh.com/m/ST169E7000`，页面显示 `Mino Pet Shop` 顾客入口且无构建错误。
- 本地开发控制台未见 `@prisma/client` 或 `Module not found` 错误；仅见既有开发态 React hydration 提示。

### 截图

- 修改前参考：`ep-br-cd-01-mac-mini-increment/screenshots/ep-br-cd-01-display-cash-1366.png`
- 修改前参考：`ep-br-cd-01-mac-mini-increment/screenshots/ep-br-cd-01-display-khqr-1366.png`
- 修改前窄视口参考：`ep-br-cd-01-mac-mini-increment/screenshots/ep-br-cd-01-display-khqr-800.png`
- 修改后静态状态：`ep-br-cd-01-mac-mini-increment/screenshots/ep-br-cd-01-display-after-static-1280x720.jpg`

前三张为前一轮验收中保存的基线截图；最后一张为本轮本地浏览器静态状态截图。因没有在真实 POS 流程中创建订单，本轮未将静态截图表述为 KHQR 强调态的真机扫描结论。

## 自动验证

以下命令在隔离 worktree 中执行并返回 0：

```bash
for test_file in \
  tests/customer-display-adapter.test.ts \
  tests/customer-display-cart-sync-static.test.ts \
  tests/customer-display-panel-state.test.ts \
  tests/customer-display-persistent-panel-static.test.ts \
  tests/customer-display-realtime-channel.test.ts \
  tests/customer-display-session-current-static.test.ts \
  tests/customer-display-public-entry-url.test.ts \
  tests/customer-landing-journey-static.test.ts; do
  npx tsx "$test_file" || exit 1
done

npx tsc --noEmit --incremental false
npm run build
```

测试覆盖：邀请页/顾客屏共用 URL 函数、本地 origin 不泄漏、URL 编码、三语稳定性、右侧不含 H5、KHQR `src` 稳定且无额外请求、B1 状态回归及既有顾客屏数据层行为。

## 仍需现场确认

- 使用真实手机网络扫描左栏二维码，并确认打开相同的公共 HTTPS 地址。
- 在真实 KHQR 和现金流程中再次确认二维码的可扫性、KHQR/CASH 切换不产生新图片请求、以及完成 5 秒后中栏清空。
- 本轮未引入响应式断点、动态 KHQR、广告轮播或任何此前列为后续项目的非阻塞项。
