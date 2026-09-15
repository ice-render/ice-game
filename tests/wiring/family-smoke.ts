/**
 * 家族三件套「接线」冒烟 —— 本文件**只服务于门禁**，不属于任何页面，也不进 `dist`。
 *
 * 为什么需要它：`ice-chart` 是给接下来要做的游戏备的依赖，**当前没有任何页面 import 它**。
 * 未被使用的依赖 = 未被验证的依赖：等第一次真用的时候才发现接线是断的，白费一轮。
 *
 * 这个文件同时喂给两个门禁：
 *
 *  | 门禁 | 跑法 | 靠本文件的 |
 *  |---|---|---|
 *  | 类型层 | `npm run types:check` | 下面的 import 与函数体做**跨包类型断言** |
 *  | 打包层 | `npm run check:wiring` | 它被当作入口真的打一次包，断言每个包只进一份 |
 *
 * ### 它守的是三类"静默出错"
 *
 * 1. **两份引擎声明（dual .d.ts）**：兄弟包各自 `node_modules` 里有一份 npm 装的 `ice-render`，
 *    `tsconfig.json` 的 `paths` 漏了谁，tsc 就会同时看到两份声明。引擎的 `ICELayoutManager`
 *    带私有成员 → 两份声明是互不兼容的名义类型（报 `Types have separate declarations of a
 *    private property '__warnedConstraints'`）。下面 `panel.setLayout(new ICEBoxLayout(...))`
 *    就是这个调用。
 * 2. **依赖没装成软链 / 导出改名**：三条 import 任何一条不通都编译不过。
 * 3. **打进多份引擎**：由 `webpack.config.js` 的 `SingleEnginePlugin` 在打包时断言。
 *
 * ### ⚠️ 为什么末尾非得有那个 `globalThis` 赋值
 *
 * `ice-render` 与 `ice-chart` 的 package.json 都声明了 `"sideEffects": false`，于是
 * **纯粹的裸 import 会被整段消除**；同理，"只被类型引用、或只出现在未被调用的函数里"的绑定
 * 也会被消除。实测后果：产物只有 752 KiB —— ice-chart 那 281 KiB 整个不见了，
 * 于是"每个包只打一份"的断言**对它变成了空的**（门禁看起来绿，其实没验）。
 *
 * 顶层执行一次赋值是 webpack 认得的副作用，三个包的绑定因此都真的留下来。
 * 本文件不会被任何页面 import，所以这个全局赋值只发生在 `check:wiring` 的临时构建里。
 */
import { ICE, ICEBoxLayout } from 'ice-render';
import { ICEHoverManager, ICEPanel } from 'ice-web-components';
import { computeLayout, createChart, SNAPSHOT_VERSION, type ICEChart } from '@damoqiongqiu/ice-chart';

/* ------------------------------ ① 类型层断言 ------------------------------ */

/** 跨包传引擎类型：`ICEBoxLayout` 来自 ice-render，`panel` 来自 ice-web-components。 */
export function wiringTypeProbe(): void {
  const ice = new ICE();
  const panel = new ICEPanel({ width: 120, height: 80 });
  // ↓ 两份 .d.ts 存在时，这一行报 TS2345
  panel.setLayout(new ICEBoxLayout({ axis: 'y', gap: 4 }));
  new ICEHoverManager(ice);
}

/** ice-chart 的公开面：`createChart(target, optionOrSnapshot, chartOptions?)` → `ICEChart`。 */
export function wiringChartTypeProbe(target: HTMLCanvasElement): ICEChart {
  return createChart(target, { xAxis: {}, yAxis: {}, series: [] });
}

/* --------------------- ② 让三个包真的进 webpack 模块图 --------------------- */

/**
 * 顶层副作用：webpack 无法消除它，因此上面三个 import 的绑定全部被"用到"，
 * 三个家族包都会进模块图 —— `SingleEnginePlugin` 的"只一份"断言对每一个包都生效。
 */
const smokeBindings = { ICE, ICEBoxLayout, ICEPanel, ICEHoverManager, createChart, computeLayout, SNAPSHOT_VERSION };
(globalThis as unknown as Record<string, unknown>).__iceGameWiringSmoke = smokeBindings;
