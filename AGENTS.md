# AGENTS.md — ice-game

## 项目定位

ICE 家族的**游戏厅**：大量**单页小游戏**（无服务端、纯静态）+ 两台从上游移植的整机。
渲染与控件一律取自家族，本仓只写"游戏怎么装起来、规则怎么算"。

**一个页面 = 一个游戏 = 一个入口 = 一个 HTML**（不是单 HTML 里多个页签）：
每个游戏独占整屏与键盘、彼此零共享状态、各有自己的开场流程。
硬塞进一个页面只会让"切页要重建整个游戏"比"开个新页面"更贵。
（例外：`src/home/` 是游戏厅首页 —— 它不是游戏，是所有游戏的入口。）

## 目录结构（分区是物理隔离的，不是文档约定）

```
src/
├─ domain/            纯逻辑 + 目录（零运行时依赖，可单测）
│  ├─ catalog.ts        目录 API：分组、查询、统计
│  └─ catalog.generated.json  ← 生成物（npm run gen:catalog，勿手改）
├─ kit/               小游戏底座（★ 自研游戏共用，别再各写一遍）
│  ├─ page.ts           画布 + 引擎 + 主题 + dpr
│  ├─ shell.ts          标题/数值卡/按钮/帮助/暂停与结束覆盖层
│  ├─ loop.ts           帧循环（dt 上限、暂停即停帧）
│  ├─ input.ts          键盘 → 语义动作
│  ├─ storage.ts        localStorage 容错（零依赖）
│  ├─ high-scores.ts    最高分榜（复用 ICEHighScoreModel）
│  └─ audio.ts          WebAudio 合成音效
├─ games/<slug>/      ★ 自研单页小游戏（开发区，一个游戏一个目录）
│  ├─ meta.json         唯一配置：标题/说明/分组/尺寸/主色
│  ├─ main.ts           装配（kit 六件怎么接）
│  └─ model.ts          游戏规则（纯逻辑，可单测）
├─ ported/<slug>/     ★ 上游移植的整机（arcade / windows-xp）
│  ├─ meta.json         ← 首次由 sync-upstream 生成，之后**手改**（文案）
│  ├─ index.html        ← 生成物，禁手改
│  └─ main.ts           ← 生成物，禁手改
├─ templates/page.html  小游戏共用页面骨架（HTML 只写一份）
└─ home/               游戏厅首页
   ├─ main.ts            hero + 卡片网格 + 页脚（画布高度按内容算）
   ├─ navbar.ts          吸顶导航（独立画布 #navbar，position: fixed）
   ├─ footer.ts          页脚（家族仓库链接；布局是纯函数，量高与渲染共用）
   ├─ chrome.ts          导航/页脚共用的品牌徽标、链接、分隔线
   ├─ index.html         两块画布 + CSS（导航固定、主体滚动）
   └─ covers/<slug>.png  ← 生成物（npm run covers 自动抓，勿手改）
```

## 铁律

### 1. `games` 与 `ported` 的分工不许混

| 分区 | 能改吗 | 加东西的方式 |
|---|---|---|
| `src/games/<slug>/` | **就是要改** | `npm run new:game -- <slug>` |
| `src/ported/<slug>/` 的 `index.html` / `main.ts` | **禁止手改**（会被 `npm run sync:upstream` 覆盖） | 改上游页，然后 `npm run sync:upstream` |
| `src/ported/<slug>/meta.json` | 可以改（文案不属于上游产物） | 直接编辑 |

分区是**物理隔离**的：混在一个目录里只靠文档约束，迟早有人改错地方。
新增上游移植页面时在 `scripts/sync-upstream.mjs` 的 `PAGES` 里登记。

#### ★ 上游是**只读**的，永不删改

`../ice-web-components/examples/` 是**别人的仓库**，本仓对它是**只读消费**：

- 本仓任何脚本、任何命令都**不得**写入、重命名、删除上游的 `examples/*.html`
  （`scripts/sync-upstream.mjs` 只读上游、只写自己 `src/ported/`）；
- 上游的 9 个示例（`admin` / `algorithm-sandbox` / `arcade` / `custom-component` /
  `dos-terminal` / `gallery` / `pixel-editor` / `windows-xp` / `workbench`）
  **必须原样留在原处**：本仓只是"另外拷一份进来用"，不是"把示例搬走"。
  上游自己的演示页与 e2e（`npm run test:e2e`，端口 8093）继续依赖它们；
- 想改上游示例的玩法 → 改**上游**（那属于组件库仓的职责与门禁），再 `npm run sync:upstream` 同步过来；
- 验证方式（只读、随时可重跑）：`examples/*.html` 与上游 `git HEAD` 逐字节一致 +
  真 Chrome 打开 9 个页面均无报错且画布有内容。

### 2. 加游戏**不改构建配置、不改首页、不改 e2e**

三处都是**目录驱动**的，加了游戏自动生效：

| 环节 | 怎么自动跟上 |
|---|---|
| 构建入口 + HTML | `webpack.config.js` 扫 `src/games/*` 与 `src/ported/*`（`scripts/lib/scan-games.cjs`） |
| 首页卡片 | 读 `src/domain/catalog.ts`（数据来自生成的 `catalog.generated.json`） |
| e2e 冒烟 | `e2e/catalog.spec.ts` 遍历 `entryPages()`；小游戏还自动套"通用不变量" |

所以**不要**去 webpack 里手写 entry —— 那是回退到"每加一个游戏改一次配置"。

**`meta.json` 是"已注册"的标志**：没有它 = 半成品目录，不进构建、不进首页
（`gen-catalog` 会提醒你哪些目录没登记）。字段与校验规则见 `scripts/lib/scan-games.cjs`
（`slug` 必须等于目录名且全局唯一；`kind` 必须与分区一致；`tagline` ≤34 字）。

### 3. `ice.addChild(node, false)` 会**清掉** dirty —— 收尾必须补 `ice.dirty = true`

引擎源码是 `this.dirty = markDirty`，所以 `false` 不是"不置脏"，而是**把待渲染标记赋成 false**。
引擎又是"空闲停帧"的（dirty 被消费、又没动画就停 rAF），于是**最后一次挂载用了 `false`
就再也不会有帧**：画面停在空白，控制台一个错都不报，点击命中也不会建。

- 组件库容器里 `container.addChild(node, false)` 是常规写法（那儿的语义是"我自己统一置脏"）；
- 但**根上**的收尾必须是 `ice.addChild(x)`（默认 true）或显式 `ice.dirty = true`。

`src/home/main.ts` 与每个小游戏 `main.ts` 结尾那句 `ice.dirty = true` 就是为此存在，**别删**。
（`kit/page` 打开了 `setContinuousFrames(true)`——游戏每帧都要推进；但收尾这一句仍要留。）

### 4. 画布外的内容会被**静默裁掉**；构件互相压住更是连告警都没有

引擎没有"溢出报错"，两个构件叠在一起也照常绘制。所以这里有三道防线：

1. **构造期自检**：`kit/shell` 从 `stage` 倒推标题带/数值卡/按钮行/帮助的纵向位置，
   任何两条带重叠、或内容超出画布，**直接抛错**并报出"至少需要多少"。
   （实测价值：`breakout` 的 `stage.top = 170` 比需求的 175 少 5px，
   结果数值卡压住游戏区 18px —— 只有翻截图才看得出来。）
2. **通用 e2e 体检**：`e2e/support.ts` 的 `expectLayoutClean(page, …)` —— 用引擎的
   `getAccessibilityTree()` 查越界与"部分交叠"，**每个小游戏自动被覆盖**
   （见 `e2e/catalog.spec.ts` 的"小游戏通用不变量"）。掌机按 BIOS/卡带两阶段查、
   XP 按开机/登录/桌面/开窗口四阶段查、首页查主体与导航两块画布。
3. 排 `stage` 高度要**倒推**：画布高 −（底部按钮行 40 + 帮助行×24 + 留白）−（顶部标题带 + 数值卡）。

写体检判据时踩过的坑（都写进了 `support.ts` 的注释）：

- **`box` 已经是相对画布的坐标**，不是相对视口 —— 再减一次画布偏移会得到满屏假越界；
- **ICE 实例必须与画布成对取**：首页有两块画布各一个 ICE 实例，
  拿主画布的 ICE 去比导航画布的 60px 高度 → 满屏假越界（`iceSource: 'main' | 'navbar'`）；
- **四层排除**别省：祖先-后代 / 不占地的透明容器 / 完全包含（背景板）/ ≤2px 的细分隔线；
- **跨窗口交叠是设计**（XP 的窗口可以互相遮挡），按 `window-*` 分属放行；
- **动画中间态**可能短暂越界（实测 XP 桌面淡入时见过一次），所以发现即重试一次再判失败；
- **有意的出血**要按数值放行：导航背景条上移 `radius` 让顶部方角，那是设计
  （数值从页面暴露的 `navbar.bleed` 读，不在测试里写死）。

### 5. 坐标：容器内是局部坐标；世界坐标沿 `parentNode` 累加

- 节点加进舞台容器/卡片之后就是**该容器的局部坐标**，别再减一次父级偏移；
- 要拿世界坐标（e2e 点控件必须用）就沿 `parentNode` 累加 `state.left/top`；
- **终止条件是 `cursor.state` 而不是 `cursor`**：`ICE` 实例本身没有 `state`，
  `while (cursor)` 会在根上读 `state.left` 直接崩。`kit/page` 的 `worldRect()` 已封装好。

### 6. 画布内**不要用彩色 emoji**

引擎的文本渲染走 canvas `fillText`，彩色 emoji 会渲染成怪符号（实测一个方框加乱码）。
中英文、数字、`←→` 这类符号都没问题（`kit/shell` 的音效按钮就因为踩过这个，从 `🔊` 改成了文字）。

### 7. 事件载荷的形状**别猜**：`trigger(name, originalEvent, param)` → 读 `evt.param`

`ICEWidget.setHovered()` 调的是 `this.trigger('hoverchange', null, { hovered })`，
而 `trigger(eventName, originalEvent, param)` 把数据塞进 **`evt.param`**。
所以 handler 收到的是 `ICEEvent`，要读 `evt.param.hovered` ——
直接读 `payload.hovered` 恒为 `undefined`（实测：悬停高亮框永远不显示，**且没有任何报错**）。

凡是"注册了回调但看起来没触发"的情况，先确认载荷形状；`ICEEventTarget.trigger` 的签名是唯一依据。

### 8. 首页有两块画布：导航是「岛」，且 e2e 必须按 **id** 定位画布

首页 = `#navbar`（吸顶导航，`position: fixed`，独立 `ICE` 实例）+ `#canvas`（主体，随窗口滚动）。

- 导航必须是独立画布：画在主体里会跟着内容滚走（要它不动就得每帧按 `scrollY` 重画）。
  库里 `ICEAffix` / `ICEAnchor` 服务的是画布内滚动容器（`ICEScrollPane`），**窗口滚动用不上**。
- **两块画布各置一次脏**：导航是另一个 `ICE` 实例，给主体置脏不影响它
  （`page.ice.dirty = true; navbar.page.ice.dirty = true;`）。
- ⚠️ **e2e / 截图脚本一律按 id 选画布**（`#canvas` / `#navbar`），
  不要用 `page.locator('canvas')` 或 `querySelectorAll('canvas')[i]`：
  前者在有多块画布时命中多个（strict mode 报错，或更糟——默默截到 60px 的导航条），
  后者会在将来往 DOM 里插画布时**静默错位**。`e2e/support.ts` 已改用 id（`MAIN_CANVAS` / `NAVBAR_CANVAS`）。
- 看"用户实际看到什么"用**视口截图**，不要用 `fullPage: true` ——
  整页截图对 `position: fixed` 元素有渲染偏差（把导航画在内容之上，看着像"盖住了 hero"）。

### 9. 外链地址来自 `src/domain/family-repos.ts`，且**必须核实过**

页脚/导航里的 GitHub 地址集中在该文件（零依赖、可单测）。规矩：

- 地址必须**逐个核实可访问**（开发时用 HTTP 请求确认返回 200），
  不要按命名习惯推断 —— 家族里有 `ice-render-dsl` / `ice-chart-dsl` / `ice-entity-designer-dsl`
  三个 DSL 包，光看名字很容易写错。
- **本仓没开源就如实标"未开源"**，不要为了页脚好看编一个地址 —— 挂 404 比不挂更糟。
  `SELF_REPO.published` 控制这件事；建好远端后填 `url` + 置 `published: true` 即可。

### 10. 游戏规则必须是**零运行时依赖的纯逻辑**

`model.ts` 不 import 引擎、不碰 DOM。好处：规则能在 node 里单测（`npm test` 0.2 秒跑完），
不需要浏览器、不需要引擎产物。`main.ts` 只负责装配与画面 —— 这条分界是单测跑得快的前提。

## 门禁

```bash
npm run types:check   # tsc --noEmit（含 kit、games、e2e、跨包类型接线）
npm test              # jest：domain / kit / 各游戏的 model（不需要引擎产物、不需要 jsdom）
npm run check:wiring  # 家族三件套接线：真打一次包，断言每个包只进来一份
npm run check:catalog # 目录生成物是否最新（改了 meta.json 忘了生成会红）
npm run build         # 扫目录构建（自动 gen:catalog；顺带把封面拷进 dist/covers/）
npm run check:games   # 目录 ↔ 生成物 ↔ 构建产物 ↔ 封面 四者一致（build 之后跑）
npm run test:e2e      # 真 Chrome：像素 + 真鼠标真键盘 + 目录驱动逐页冒烟
npm run verify        # 上面除 e2e 外全部
npm run covers        # 抓首页卡片封面（真跑一遍游戏；改了画面就重跑）
```

e2e 的判据分三层（**缺一层就会出现"看起来通过其实没验证"**）：

1. **状态机**：直接断言 `model` 的相位/分数/命数（规则单测另有 `tests/games/`）；
2. **交互**：真鼠标点画布控件、真键盘驱动输入 —— 断言状态真的变了；
3. **像素**：`opaqueRatio` + `inkRatio` + 颜色数（只刷一层底色的空画布会在后两项露馅）。

⚠️ **断言要与版面形态匹配**：`opaqueRatio` 的默认下限 0.5 只适用于"铺满画布"的页面；
像首页那样"透明画布 + 卡片网格"的版面必须调低（`expectCanvasPainted` 的 `minOpaque`），
否则会因正常留白而误报（踩过）。

`channel: 'chrome'`：用系统 Chrome，绕开 Playwright 自带无头壳与本地缓存版本对不上的坑。
`reuseExistingServer: false`：端口被别的服务占着时**直接响亮失败**，而不是静默复用别人的目录。
**端口**：本仓 8098，可用 `ICE_GAME_PORT` 覆盖（本机 8096/8097 被无关常驻服务占着）。

## 已知的上游现象（不是本仓缺陷，但要知道）

1. **XP 的 IE 程序会产生一个 404（`GET /gallery.html`）**。
   上游的 IE 演示会真 `fetch()` 一个演示页面，而本仓 `dist/` 里没有 `gallery.html`
   （文件在上游 `examples/`），所以 IE 显示"找不到页面"——**那正是它要演示的效果**。
   e2e 里**正面确认 404 的 URL 只有它**（`collectNotFoundUrls`），其余任何资源 404 都会红。
2. **XP 任务栏的任务按钮在移植页里没有被绘制出来**。
   实测：按钮位置像素与任务栏空白处完全相同（`48,114,229`），强制 `ice.dirty = true`
   与聚焦窗口后依旧；仓里既有的 `xp-desktop.png` 也没有这些按钮。
   而 a11y 树里它们存在，8 个窗口时最后一个会排到 x=1488（超出桌面 1440 约 48px）。
   因为 `src/ported/windows-xp/main.ts` **禁止手改**，本仓不做修，
   但 e2e 里按子树放行（`allowIdPrefixes: ['task-']`）并写清了依据 —— 上游修好后可删。
3. **上游是只读的**（见铁律 1）。上述两条都属于上游示例的既有行为。

## 环境提醒：引擎仓正在被其他人并行重构

实测遇到过两次**瞬时失败**：`tsc` 报 `Cannot find module 'ice-render'`、
webpack 报 8 个错误 —— 都发生在另一个开发者重建引擎 `dist/` 的**写入窗口**内
（`ice-render/dist/types/index.d.ts` 的 mtime 恰好是那一刻）。
重跑即恢复，**不要为此改本仓代码**。真遇到持续失败，先看
`../ice-render` 的 `git status` 与 `dist/` 的 mtime，确认是不是上游产物正在被重写。

## 家族级事实来源

- 引擎仓 `../ice-render/AGENTS.md`：渲染/序列化/事件/i18n 边界；**本仓不得修改 `ice-render/` 源码**。
- 组件库 `../ice-web-components/AGENTS.md`：布局铁律、painter 契约、`UI*` → `ICE*` 迁移。
- 应用侧套路（岛/覆盖层/画布 e2e 配方、接线门禁的四种错法）见 skill `ice-family-app-dev`。

## 发布

家族铁律：开发在 `dev` 分支 → 合并到 `master` → 双推 gitee + github
（github 走 Clash 代理 `127.0.0.1:7890`）。本仓当前**只有本地 git**，远端待建。
