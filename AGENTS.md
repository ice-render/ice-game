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
├─ ported/<slug>/     ★ 上游移植的整机（arcade）
│  ├─ meta.json         ← 首次由 sync-upstream 生成，之后**手改**（文案）
│  ├─ index.html        ← 生成物，禁手改
│  └─ main.ts           ← 生成物，禁手改
├─ machines/<slug>/   ★ 自维护整机（windows-xp）：同样 `meta.json` + 自写 `index.html` + 自维护 `main.ts`。
│  画布固定 1440×900 内部坐标；`index.html` 用 CSS `min(100vw,100vh*1.6)` 把画布按 1.6 比例**占满视口**（比例
│  不符则占满较窄边、body flex 居中，黑色信箱边）——**不要**用 object-fit（会破坏点哪命中）。
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

### 应用层写法：一页 = 一个类（2026-09-17 确立）

家族的应用层统一到这个形状（库侧是 `ICEContainer` 契约，`ice-smart-water` 的 12 个页面、
各仓示例页都这么写），游戏页不例外：

- **页面基类是 `GamePage`**（`src/kit/page.ts`）：`class XxxPage extends GamePage`，
  构造期把存档 / 音效 / 模型 / 节点池 / 外壳 / 输入 / 循环一次建好；
- **刷新只有一个入口**：`render()` 负责"把 model 快照写到画面上"，
  外壳状态与覆盖层走 `syncShell()`（相位跳变时调）；不要在别处零散地改画面；
- **回调一律包箭头函数**：`onClick: () => this.togglePause()`、`worldRect: (n) => this.worldRect(n)` ——
  直接传方法会在回调里丢 `this`（改造时真踩了：暂停按钮与 e2e 句柄都会炸）；
- **文件末尾 `new XxxPage();`** 启动，脚本里不出现模块级的 `function` / `let`。

**迁移状态**：

- `src/games/breakout/main.ts` ✅、`src/home/main.ts` ✅（首页 = `class HomePage extends GamePage`）、
  `scripts/templates/game/main.ts` ✅（新游戏从第一天就合规，`npm run new:game` 生成出来就是类）——
  **本仓自研页面已全部迁完**，`PAGE_LEVEL_PENDING` 为空；
- `src/machines/arcade/main.ts`、`src/machines/windows-xp/main.ts` ⊘ **按政策排除**（2026-09-17 定）：
  它们是上游示例抽出来的 `// @ts-nocheck` 移植脚本，**继续跟上游同形**，不按本仓写法改 ——
  这几页的价值在于"能和上游示例对照"，改了就再也对不上。清单在
  `UPSTREAM_PARITY_EXCLUDED`，谁都看得出这是故意的；
- 上游移植分区 `src/ported/*` 是生成物，同样不在这个口径内。

回归闸门：`tests/games/convention.test.ts`（每个自研游戏必须"已迁 / 待迁"二选一，新增游戏
默默写成函数式会红）。

### 成员顺序（2026-09-17 定，全家族同口径）

页面类里的成员按这个顺序排 —— 棘轮里就是正则 `S*T*F*C*(A|M)*`：

```
static 常量/字段  →  static 方法  →  实例字段  →  构造函数  →  访问器 / 实例方法
```

**静态的都在最前**（类级的东西，跟实例无关），然后才是实例级的三段：字段 → 构造函数 → 方法。
本仓的游戏页 / 首页 / 脚手架模板本来就是这个形状（`HomePage` 的版面常量、`BreakoutPage`
的调参常量都在类首），所以这条棘轮现在只是把现状**钉住**。

**只到这一层**：不查 public/private 的先后，也不查同组内谁先谁后。Google Java Style §3.4.2
明确说成员顺序"**没有唯一正确的配方**"（要的是每种顺序都讲得通、维护者能解释），
Google 的 TypeScript 指南对顺序**完全沉默**（全文 "ordering" 出现 0 次）。

⚠️ **挪位置前先分清挪的是什么**：**方法随便挪**（类定义时方法就全部装好，与文本顺序无关）；
**字段的声明顺序有语义** —— 初始化按声明顺序执行，还影响 V8 的 class shape。所以挪
`static` 字段要确认它跟别的 `static` 字段/静态块没有顺序依赖，挪实例字段要确认初始化表达式
互不依赖。

棘轮：`tests/games/convention.test.ts` 的最后一条。**`src/machines/*` 与 `src/ported/*`
不在这个口径内**（上游同形 / 生成物，见下）。

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
  （`scripts/sync-upstream.mjs` 只读上游、只写自己 `src/ported/`；windows-xp 已迁出到 `src/machines/`，不再由它生成）；
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
| 构建入口 + HTML | `webpack.config.js` 扫 `src/games/*` 与 `src/ported/*` 与 `src/machines/*`（`scripts/lib/scan-games.cjs`） |
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
   XP 按开机/登录/桌面/开窗口四阶段查、首页查主体/导航/效果层三块画布。
3. 排 `stage` 高度要**倒推**：画布高 −（底部按钮行 40 + 帮助行×24 + 留白）−（顶部标题带 + 数值卡）。

写体检判据时踩过的坑（都写进了 `support.ts` 的注释）：

- **`box` 已经是相对画布的坐标**，不是相对视口 —— 再减一次画布偏移会得到满屏假越界；
- **ICE 实例必须与画布成对取**：首页有两块画布各一个 ICE 实例，
  拿主画布的 ICE 去比导航画布的 60px 高度 → 满屏假越界（`iceSource: 'main' | 'navbar'`）；
- **四层排除**别省：祖先-后代 / 不占地的透明容器 / 完全包含（背景板）/ ≤2px 的细分隔线；
- **跨窗口交叠是设计**（XP 的窗口可以互相遮挡），按 `window-*` 分属放行；
- **动画中间态**可能短暂越界（实测 XP 桌面淡入时见过一次），所以发现即重试一次再判失败；
- **有意的出血**要按数值放行：导航背景条上移 `radius` 让顶部方角，那是设计
  （数值从页面暴露的 `navbar.bleed` 读，不在测试里写死）；
- **裁剪视口里的溢出轨道是设计**：`ICECarousel` 的轨道宽 = 幻灯片数 × 视口宽，
  第 2 张起在画布坐标系里本来就落在视口右侧之外（由 `clipChildren` 裁掉）。
  所以幻灯片**一个 id 都不给**，整块用一个前缀（`featured-`）标记，
  测试侧从页面的 `auditAllowIdPrefixes` 读该排除哪些前缀 ——
  命名了就会报一串假越界（判据是"裁剪视口 + 溢出轨道"，不是版面算错）。

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

### 8. 首页有**三块**画布：导航与效果层都是「岛」，且 e2e 必须按 **id** 定位画布

首页 = `#navbar`（吸顶导航，`position: fixed`，独立 `ICE` 实例）
+ `#bg`（背景动态效果，`position: fixed` 视口大小，独立实例）
+ `#canvas`（主体，随窗口滚动）。

```
body 背景（CSS 渐变）
  └── #bg       fixed，视口大小 —— **会动的那一层**（网格 / 粒子星座 / 光斑），每帧重绘
       └── #canvas  static，内容高度 —— 卡片与文字，**静态**（只在交互时重绘）
            └── #navbar fixed 条状 —— 吸顶导航
```

- **为什么效果层要单独一块画布**：主体画布有 1180×2000 那么大，上面全是卡片与文字。
  "让背景动起来"如果画在主体上，就等于**每帧重绘整页静态内容**。
  隔离之后顺带得到一个好看的副作用：`#bg` 是 `fixed` 而主体会滚动，
  滚动时"星星在玻璃后面不动、内容从前面滑过"—— 视差感是免费的。
- 导航必须是独立画布：画在主体里会跟着内容滚走（要它不动就得每帧按 `scrollY` 重画）。
  库里 `ICEAffix` / `ICEAnchor` 服务的是画布内滚动容器（`ICEScrollPane`），**窗口滚动用不上**。
- **三块画布各置一次脏**：导航与效果层都是另一个 `ICE` 实例，给主体置脏不影响它们
  （`ice.dirty = true; navbar.page.ice.dirty = true; effects.page.ice.dirty = true;`）。
- ⚠️ **e2e / 截图脚本一律按 id 选画布**（`#canvas` / `#navbar` / `#bg`），
  不要用 `page.locator('canvas')` 或 `querySelectorAll('canvas')[i]`：
  前者在有多块画布时命中多个（strict mode 报错，或更糟——默默截到 64px 的导航条），
  后者会在将来往 DOM 里插画布时**静默错位**。
  `e2e/support.ts` 已改用 id（`MAIN_CANVAS` / `NAVBAR_CANVAS` / `EFFECTS_CANVAS`）。
- 视觉主体是**深色**的，所以效果层的粒子必须走**低 alpha 的冷色**（`rgba(186,219,255,·)`）。
  粒子要"少而慢"：实测 28~96 颗、每秒几到十几像素才有氛围；再多再快就成雪花屏。

#### ★ 导航栏的「背景层 / 内容层」必须分开

想要"顶部方角（贴住视口）+ 底部圆角"，最省事的是把背景面板**上移 `radius`**、
让上边越出画布被裁掉（`ICEPanel` 没有"只圆下面两个角"的 API）。但**子节点是相对父容器定位的**：
导航项挂在 `top: -radius` 的容器下，它们的 `top: 0` 就变成画布 `y = -radius` ——
整条导航内容被顶掉 `radius` 像素（实测症状：文字贴上边缘、徽标只剩半截，
当时还误以为是"垂直居中坏了"）。

正确结构是两个**兄弟层**：

```
#navbar
├── bar      top: -radius，只是背景（越出部分被裁 → 顶部方角、底部圆角）
└── content  top: 0，高度 = NAVBAR.height；**所有导航项挂这里**，坐标正常
```

配套一条：**导航高度只有一份真相**（`navbar.ts` 的 `NAVBAR.height`），
由首页 `setProperty('--navbar-height', …)` 写进 CSS —— CSS 与代码各写一个数字会悄悄错位 4px。
e2e 里也**不要把导航高度写死**（曾经写 `navBottom - 60`，高度改 64 后假失败）。

### 9. 视觉层次：画布没有的 CSS 能力，用"叠层"补

深色页面最缺的是层次 —— 一片纯暗底放文字就像"没做完"。引擎没有 `box-shadow` / `filter`，
所以这些效果一律靠**叠低透明度渐变面板**：

| 想要的 | 怎么叠 |
|---|---|
| 发光 / 光晕 | 外圈垫一层比主体大一圈、低 alpha 的渐变面板（`brandBadge` 的 `glow`） |
| 悬停"反光" | 封面之上叠一层斜向白色线性渐变（`buildSheen`），悬停时 `display: true` |
| 霓虹分隔线 | 两端透明的横向渐变细线（导航 `navbar-topline`、卡片顶沿） |
| 卡片质感 | 主色 → 派生暗色 的纵向渐变（按钮），派生用 `shade()` 而不是写死第二组颜色 |

渐变一律用 `ice.createLinearGradient / createRadialGradient`（引擎官方支持，会把停靠点一起记录，
导出器也认）。

**渐变坐标 = 使用它的那个组件的局部坐标**：`CanvasGradient` 的坐标在**绘制时**的坐标系里解释，
所以会被组件的世界变换带走。面板在 `(0,0)` 时局部坐标恰好等于画布坐标（所以
`home/main.ts` 里那些 `createRadialGradient(PAD+…, PAD+…)` 看着像绝对坐标，其实是因为容器在原点）；
一旦渐变面板要挂到非原点容器下，坐标就得按那个容器的局部坐标系给。

页面背景的细网格**曾经用 CSS**，现在也挪到 `#bg` 画布上（用画布画才能动：粒子漂移 + 网格呼吸）。
CSS 只留最底那层底色渐变（`body { background-image: radial-gradient(...) }`）。

### 10. 外链地址来自 `src/domain/family-repos.ts`，且**必须核实过**

页脚/导航里的 GitHub 地址集中在该文件（零依赖、可单测）。规矩：

- 地址必须**逐个核实可访问**（开发时用 HTTP 请求确认返回 200），
  不要按命名习惯推断 —— 家族里有 `ice-render-dsl` / `ice-chart-dsl` / `ice-entity-designer-dsl`
  三个 DSL 包，光看名字很容易写错。
- **本仓没开源就如实标"未开源"**，不要为了页脚好看编一个地址 —— 挂 404 比不挂更糟。
  `SELF_REPO.published` 控制这件事；建好远端后填 `url` + 置 `published: true` 即可。

### 11. 游戏规则必须是**零运行时依赖的纯逻辑**

`model.ts` 不 import 引擎、不碰 DOM。好处：规则能在 node 里单测（`npm test` 0.2 秒跑完），
不需要浏览器、不需要引擎产物。`main.ts` 只负责装配与画面 —— 这条分界是单测跑得快的前提。

### 12. 入口页优先用**家族组件**，不要手拼几何图形

`src/home/*` 的定位是"**展示家族控件本身**"，所以版面一律先找现成组件：

| 位置 | 组件 |
|---|---|
| hero 规模数字 | `ICEStatCard`（图标 + 标题 + 数值 + 趋势，带自持布局策略） |
| 精选展厅 | `ICECarousel`（自动播放 + 箭头 + 圆点） |
| 卡片本体 | `ICECard`（`title` 与 `extra` 两个插槽） |
| 类型徽标 | `ICEBadge`；内含物标签 `ICETag`；按钮 `ICEButton`；分组图标 `ICEIcon` |
| 分隔线 | `ICESeparator`；封面覆盖率 `ICEProgressBar` |

手拼 `ICEPanel` 只在组件真不合适时用（背景光晕、霓虹高光、卡片顶沿渐变小线）。
组件自带语义（徽标 `count > 99` 截断、标签 hover 提亮、按钮三态与焦点环），
手拼就要自己实现一遍，而且一定只实现一部分。

三条**用组件时才会踩到**的坑：

1. **`extra` 插槽要传工厂函数**，且尺寸必须**在卡片构造之前**算好 ——
   `ICECard` 构造期就会调它并把节点摆到右上角（`setExtra` 读 `node.state.width`）。
   给错宽度会被 `ICEBadge` 内部**静默截断**（"小游戏"在 56px 里显示成"小…"）。
2. **`ICECard` 的标题节点默认 `interactive: true`**（引擎里 `interactive` 默认就是 true）。
   `ICEHoverManager` 只把 hover 派发给**最上层**的交互节点、**不向祖先冒泡** ——
   标题可交互 = 鼠标停在标题上时卡片收不到 `hoverchange`、高亮框不出现。
   所以要用 `getTitleNode()` 显式关掉（我们就是靠`悬停`这条 e2e 抓到的）。
3. **轮播的箭头底色与圆点位置是组件为"铺满视口"的版面定的默认值**：
   箭头是浅色底（深色页上压在亮封面上看不见）、圆点在**视口底部居中**（本例的幻灯片是
   左文案 + 右封面，居中的圆点正好落在封面上）。用 `getPrevButton()` / `getNextButton()` /
   `getDotNode(i)` 这三个公开访问器改 —— 组件内部 `__updateControls()` 只改 `display`
   与圆点 `fillStyle`，不会把外观改回去。

`src/home/main.ts` 顶部的注释里有一张完整对照表。

### 13. 文本宽度**必须用 canvas 量**，不要按系数估

画布控件没有 DOM 的自动测量。`chrome.ts` 里的 `textWidth()` 是按 `中文 1em / ASCII 0.58em`
估的 —— 实测对长 ASCII（`ice-web-components`）**低估约 8%**，而它的唯一症状是
**被 `ICETag` / `ICEBadge` 静默截断**（显示成 `ice-web-compone…`，无报错、无省略号）。

所以：

- 要精确的地方用 `measureTextWidth(text, fontSize, fontWeight)`（离屏 canvas 的 `measureText`），
  控件宽度用 `fitControlWidth()`（= 真实字宽 + 2 × `spacing.sm`，与 `ICETag` 等内部的内边距一致）；
- **`ICELabel` 同样不换行、不加省略号，超宽直接被裁** —— 所有固定宽度的文案都要按测量值给，
  或者至少留足余量（页脚左栏就因此把"合集"二字裁掉过；现在 `brandColumnWidth()`
  与 `columnRequiredWidth()` 都改成按内容量了）。
- 排不下时**抛错**而不是截断：`layoutColumns()` 在三栏所需宽度超出可用空间时直接报错并
  说明该改哪里 —— 版面算不下是设计问题，不该在屏幕上表现成"少几个字"。

### 14. ⚠️ **视口外的 `mouse.move` 不生效**（而 `mouse.click` 生效）

实测（不同行为，别混）：

| 操作 | 目标在视口外时 |
|---|---|
| `page.mouse.move(x, y)` | **被浏览器忽略**，hover 永不触发 → 用例静默变"空门" |
| `page.mouse.click(x, y)` | **仍然生效**（文档 y=1377、视口仅 900 高时照样精确命中） |

所以"点击用例能过"**不能**当成"hover 用例也能过"的证据。

首页在 hero + 精选展厅之后，**第一张卡片的中心就已经在 `y≈1005`**（视口 900）——
"直接 hover 卡片中心"这种写法在本页天然是坏的，而且失败时没有任何报错
（本仓就吃过一次：换成 `ICECard` 后 hover 用例转红，一度以为是组件回归，
实测是目标点落在视口外）。

**做法**：指针类断言之前先调 `scrollCanvasPointIntoView(page, x, y)`
（`e2e/support.ts`）—— 它把目标滚到视口中间，**并断言目标真的进了视口**，
将来版面再变高会立刻报错而不是退回成假用例。点击用例也一并先滚，
理由不是"不滚会失败"（实测不会），而是真实用户只能点他看得见的东西。

### 15. SEO 注入在**构建期**做，且 icon 链接必须排在 head 最前面

本仓所有页面都是整屏画布，**爬虫与屏幕阅读器读不到任何内容** —— 所以每页都要注入
TDK / JSON-LD / **文字版**（`.ice-seo-sr`，视觉隐藏但含真实 `<a>` 链接）。
唯一实现在 `scripts/lib/seo.cjs`，注入点是 `webpack.config.js` 的 `SeoPlugin`。

**为什么必须在 webpack 层注入，而不是改模板**：`src/ported/<slug>/index.html` 是
**禁止手改**的生成物（会被 `npm run sync:upstream` 覆盖）。在产出之后统一注入，
顺带把小游戏模板与首页也覆盖了 —— 加新游戏自动有 SEO。

**为什么文字版不算"隐藏关键词"**：它的内容与画布**同源**（都从 `meta.json` / 目录数据生成），
且用 `clip-path` 隐藏而不是 `display:none`（后者会让辅助技术直接跳过）。
**要改这段内容，先改画布**；不要往里加画布上没有的东西。

三条踩出来的硬约束：

1. **`<link rel="icon">` 必须排在 head 最前面**（用 `injectHeadTop`，插在 `<meta charset>` 之后）。
   跟着其它 meta 一起插到 `</head>` 之前（= head 末尾）的话，Chrome 会在解析到它之前
   就认定"这页没图标"，自己去请求 `/favicon.ico` → **每个页面都多一条 404**。
   实测确认过 URL 就是 `/favicon.ico`。
   ⚠️ 这个失败**e2e 抓不住**：favicon 是**浏览器层**的隐式请求（`page.on('response')` 收不到），
   且 404 会被 Chrome 缓存 —— 把位置改回去重跑反而可能是绿的（做敏感度自检时发现的）。
   所以这条由**单测**确定性地守：断言产物里 `rel="icon"` 的位置 < `<title>` 的位置。
2. **模板里原有的内联 data URI 图标不要删**：它能挡住隐式的 /favicon.ico 请求；
   但**搜索引擎不认 data URI**，所以必须**再给一个可抓取的文件**（`favicon.svg`）。
   两者并存是对的（同一枚图标），e2e 断言"存在指向文件的 icon 链接"。
3. **没有站点根就不写绝对 URL**：`canonical` / `og:url` / `og:image` / `sitemap.xml`
   都要求绝对地址，而本仓没有域名 —— 配了 `ICE_GAME_SITE_URL` 就全补齐，
   没配就**一个都不写**（编个假域名比不写更糟，同铁律 10 的道理）。
   爬虫发现页面的主路径是**首页文字版里的真实链接**，那条不依赖域名。

**viewport 按每个页面自己的画布宽度**（`readCanvasWidth`），别写死 1180 ——
本仓画布宽度不统一（小游戏与首页 1180，Windows XP 桌面是 1440×900），
写死会让其中一个页面的移动端初始视口与画布不匹配（这条断言曾经假失败过）。

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
npm run screenshots   # 抓 README 用的截图（真 Chrome；改了版面就重跑，别手截）
```

**截图脚本的一条硬要求**：`shoot-screenshots.mjs` 抓首页前会先把轮播**按停并回到第 0 张** ——
它默认每 5.2s 自动切一张，不按停的话每次跑抓到的幻灯片都不同，
README 里那几张图会互相矛盾（动画本身有 e2e 专门验，截图只需要确定性）。

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

### `collectErrors` 报资源失败时会带上 **URL**

`e2e/support.ts` 的 `collectErrors` 同时收 `pageerror`、console error 与 4xx/5xx 响应，
并且**两条路都收**：

- console 的措辞（`Failed to load resource … 404`）**本身不含地址**，
  但 `consoleMessage.location().url` 会被 Chromium 填成**那个失败的资源** —— 用它把地址补进消息；
- `response` 事件再收一遍 4xx/5xx，兜住"没有 console 消息"的资源失败。

反过来也成立：**只看 `response` 会漏**。像 `/favicon.ico` 这种**浏览器层**发起的隐式请求
不经过页面的网络栈，`page.on('response')` **收不到**（实测：去掉图标链接后 console 报 404，
而 response 一条都没有）。这就是最初"404 是哪个资源"查不出来、只能靠猜的原因。

两者指向同一 URL 时**去重**（一次失败只报一条；去重必须两侧都做 —— 实测 response 有时先到）。
已知且可解释的 404 用 `collectErrors(page, { allowedNotFound: ['/gallery.html'] })` 按 **URL** 放行
（`windows-xp.spec.ts` 的 `ALLOWED_NOT_FOUND`），比早期"按措辞放行"精确得多。

### ⚠️ jest 的 `expect` 只收一个参数

`expect(value, '提示')` 是 **Playwright** 的用法；jest 会直接抛
`Expect takes at most one argument.`（本项目已踩两次 —— `tests/domain/family-repos.test.ts`
里早就写着这条，但写新单测时又犯了一次）。说明写进注释，或者用 matcher 自己的消息位置。

### 门禁必须做**敏感度自检**

写完任何判据，都要**故意改坏被测对象、确认门禁会红**，否则它可能是个空门
（本仓在"单份引擎"判据上两次绿着漏判；`windows-xp.spec.ts` 的 404 白名单也这样验过一次）。
配套经验：**有些问题确定性门禁抓不住**（如上面的 favicon 404 有竞态 + 缓存），
那就换一个**不依赖运行时行为**的判据（断言产物里的位置关系），而不是放着不管。

## 已知的上游现象（不是本仓缺陷，但要知道）

1. **XP 的 IE 程序会产生一个 404（`GET /gallery.html`）**。
   上游的 IE 演示会真 `fetch()` 一个演示页面，而本仓 `dist/` 里没有 `gallery.html`
   （文件在上游 `examples/`），所以 IE 显示"找不到页面"——**那正是它要演示的效果**。
   e2e 里**正面确认 404 的 URL 只有它**（`collectNotFoundUrls`），其余任何资源 404 都会红。
2. **XP 任务栏的任务按钮在移植页里没有被绘制出来**。
   实测：按钮位置像素与任务栏空白处完全相同（`48,114,229`），强制 `ice.dirty = true`
   与聚焦窗口后依旧；仓里既有的 `xp-desktop.png` 也没有这些按钮。
   而 a11y 树里它们存在，8 个窗口时最后一个会排到 x=1488（超出桌面 1440 约 48px）。
   因为 `src/machines/windows-xp/main.ts` 虽已收归本仓自维护（可直接改），但这属于上游示例的既有行为，
   本仓暂不做修，e2e 里按子树放行（`allowIdPrefixes: ['task-']`）并写清了依据 —— 上游修好后可删。
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
