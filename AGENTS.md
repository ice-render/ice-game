# AGENTS.md — ice-game

## 项目定位

ICE 家族的**游戏厅**：把 `ice-web-components` 的画布控件拼成能玩的机器。
渲染与控件一律取自家族，本仓只写"怎么把它们装成一台游戏机"。

**三个入口 = 三个 HTML**（与 `ice-smart-water` 的单 HTML + 页签有意不同）：

| 入口 | 产物 | 来源 |
|---|---|---|
| 游戏厅首页 | `index.html` | 本仓自己写（`src/home/`） |
| ICE Arcade 掌机 | `arcade.html` | **从上游逐字抽取**（`src/games/arcade/`） |
| Windows XP 桌面 | `windows-xp.html` | **从上游逐字抽取**（`src/games/windows-xp/`） |

为什么不用一个 HTML 装三个页签：三台机器各自独占整屏、独占键盘，各自有"开机自检"这类一次性
流程，彼此没有共享状态。硬塞进一个页面里，"切页要重建整台机器"比"开个新页面"更贵。

## 铁律

### 1. `src/games/**` 是生成物，禁止手改

两个游戏页由 `scripts/sync-upstream.mjs` 从
`../ice-web-components/examples/{arcade,windows-xp}.html` **逐字**抽取：

- 要改玩法 / 版面 → **改上游页** → `npm run sync:upstream`；
- 直接改 `src/games/**` 的后果不是"下次同步被覆盖"这么轻 —— 它是"本仓与上游悄悄分叉，
  而抽取器的指纹打印变成了噪音"；
- 抽取器带逐字自校验（抽出正文必须是上游文件子串），并打印行数 / 字节 / sha256。
  同步后先看这三项，对上就是同一份代码。

`main.ts` 里 `@ts-nocheck` 是**有意**的：上游正文是 JS，"保持逐字"比"通过 strict 检查"重要。
本仓的类型门禁落在 `src/domain`（纯逻辑）与 `src/home`（自己写的画布首页）上。

### 2. 家族三件套的依赖与 alias —— 加依赖时按固定顺序，别漏 alias

`package.json` 的 dependencies 声明三个家族包（与 `ice-smart-water` 同模式）：

```jsonc
"@damoqiongqiu/ice-chart": "file:../ice-chart",      // 图表（做新游戏会用到）
"ice-render": "file:../ice-render",                  // 引擎
"ice-web-components": "file:../ice-web-components"   // 画布控件 + 游戏模型
```

它们在本机是**并列的兄弟仓库**，各自 `node_modules` 里还躺着一份自己装的引擎
（实测 ice-web-components 带 2.10.0、ice-chart 带 2.10.1）。所以：

**加一个新家族依赖的顺序固定为 ①→②→③，缺一个都不行：**

1. `package.json` → `"file:../<repo>"`（npm 装成软链；带 scope 的包写完整包名）
2. `webpack.config.js` → `family` alias（打包时只留一份引擎）
3. `tsconfig.json` → `paths` 指向 `../<repo>/dist/types/index.d.ts`（类型层同口径）

只配 ①② 会让 **tsc 报"类型不兼容"而 webpack 却构建成功**（两份 `.d.ts`，
`ICELayoutManager` 带私有成员 → 互不兼容的名义类型），这种不一致最费时间。

**门禁已经替你守着（三道，都在 `npm run verify` 里）：**

| 断言 | 在哪 | 抓什么 |
|---|---|---|
| 配置自检 | `webpack.config.js` 加载期 | ① 加了但 ② 漏了 → 直接抛错 |
| 单份引擎 | `SingleEnginePlugin`（每次构建都跑，零额外成本） | 某个包被打进 2 份以上 → 构建失败 |
| 接线冒烟 | `npm run check:wiring` | 未被页面 import 的依赖（如当前的 `ice-chart`）也要真的能打包 |

判据只有一份实现：`scripts/lib/family-guard.cjs`（插件与脚本共用）。
**改造它之前先看那个文件顶部的实测记录** —— 这条判据在开发中静默失效过（构建全绿、
画面空白），两个真实错法（守护名单从 alias 表推导、带 scope 的包只按包名匹配）都记在那里，
`check-wiring.cjs` 里有对应的回归自测（改坏了会红）。

⚠️ 判据类代码必须做**敏感度自检**：把它故意改坏（或喂合成路径），确认它真的会红。
"门禁是绿的"本身不构成证据 —— 今天这条判据两次绿着漏判。

### 3. `ice.addChild(node, false)` 会**清掉** dirty —— 收尾必须补 `ice.dirty = true`

引擎源码是 `this.dirty = markDirty`，所以传 `false` 不是"不置脏"，而是**把待渲染标记赋成 false**。
引擎又是"空闲停帧"的（dirty 被消费、又没动画，就停 rAF），于是**最后一次挂载用了 `false` 就再也
不会有帧**：画面停在空白，控制台一个错都不报，点击命中缓存也不会建。

- 组件库容器里 `container.addChild(node, false)` 是常规写法（`false` 的语义在那儿是"我自己统一置脏"）；
- 但**根上**的收尾必须是 `ice.addChild(x)`（默认 true）或显式 `ice.dirty = true`。

上游两个游戏页没踩这个坑，是因为它们最后一步总是 `ice.addChild(...)`。`src/home/main.ts`
结尾那句 `ice.dirty = true` 就是为此存在，**别删**。

### 4. 坐标：卡片内是局部坐标，世界坐标要沿 parentNode 累加

- 节点加进卡片之后就是**卡片的局部坐标**（卡片已在自己的绝对位置上），别再减一次父级偏移；
- 要拿世界坐标（e2e 点控件必须用）就沿 `parentNode` 累加 `state.left/top`；
- **终止条件是 `cursor.state`，不是 `cursor`**：`ICE` 实例本身没有 `state`，
  `while (cursor) { … }` 会在根上读 `state.left` 直接崩。

## 门禁

```bash
npm run types:check   # tsc --noEmit（含 e2e、首页、tests/wiring 的跨包类型断言）
npm test              # jest：只覆盖 src/domain 深逻辑，不需要引擎产物 / jsdom
npm run check:wiring  # 家族三件套接线：真打一次包，断言每个包只进来一份
npm run build         # webpack 三入口
npm run test:e2e      # 先自动 build，再真 Chrome 跑三个页面
npm run verify        # types:check + test + check:wiring + build
```

e2e 的判据分三层（**缺一层就会出现"看起来通过其实没验证"**）：

1. **像素**：`opaqueRatio` + `inkRatio`（与主色明显不同的占比）+ 颜色数 —— 只刷一层底色的
   空画布会在后两项露馅；
2. **目录**：掌机卡带数 / XP 程序数必须等于 `src/domain/game-catalog.ts` 里写的；
3. **交互**：真鼠标切卡带、真键盘掰方向键、真双击图标开扫雷 —— 断言模型状态真的变了。

`channel: 'chrome'`：用系统 Chrome，绕开 Playwright 自带无头壳与本地缓存版本对不上的坑。
`reuseExistingServer: false`：端口被别的服务占着时**直接响亮失败**，而不是静默复用别人的目录。

## 家族级事实来源

- 引擎仓 `../ice-render/AGENTS.md`：渲染 / 序列化 / 事件 / i18n 边界；
  **本仓不得修改 `ice-render/` 源码**。
- 组件库 `../ice-web-components/AGENTS.md`：布局铁律（容器排布走 `ICELayoutManager`）、
  painter 契约、`UI*` → `ICE*` 迁移。
- 应用侧套路（岛 / 覆盖层 / 画布 e2e 配方）见 skill `ice-family-app-dev` 与
  `../ice-smart-water/AGENTS.md`。

## 端口

家族端口分配：ice-render 8090 / ice-entity-designer 8091 / ice-smart-water 8092 /
ice-web-components 8093 / ice-render-dsl 8094 / react-demo 8095 / ice-chart 5177。
**本仓 8097**（8096 在本机被一个无关的 python 服务长期占着）。

## 发布

家族铁律：开发在 `dev` 分支 → 合并到 `master` → 双推 gitee + github
（github 走 Clash 代理 `127.0.0.1:7890`）。本仓当前**只有本地 git**，远端待建。
