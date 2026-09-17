/**
 * 小游戏的**页面基类**：`class XxxPage extends GamePage` 就拿到「引擎 + 主题 + 画布尺寸」。
 *
 * ```ts
 * class BreakoutPage extends GamePage {
 *   constructor() {
 *     super();                             // 读 <canvas id="canvas">，自动处理 dpr
 *     const board = new ICEPanel({ ... });
 *     this.ice.addChild(board);
 *   }
 * }
 * ```
 *
 * 为什么是类而不是工厂：家族的应用层统一到「**一页 = 一个类**」（`ICEContainer` 契约 + 各仓
 * 的示例页都这么写）。游戏页也不例外 —— 玩法状态、外壳、输入、循环都是这一页的成员，
 * 调试句柄 `window.__game.page` 直接就是这个实例。
 *
 * 它替每个游戏做掉这几件必然会重复、且**做错了很难查**的事：
 *
 * - **dpr**：不按设备像素比放大 backing store，Retina 上文字与描边会发虚；
 * - **主题**：注册并切到街机深色主题（`ICE_ARCADE_THEME`），游戏与 HUD 用同一套 token
 *   （曾经的做法是页面里写死颜色 → 面板跟主题走、游戏美术不跟，一个页面两套配色来源）；
 * - **hover 管理器**：鼠标交互的悬停态；
 * - **不启动 focus manager**：它会用 Enter/Space 激活「有焦点的按钮」，正好和游戏按键打架
 *   （这是设计决定，不是遗漏 —— 游戏页把键盘完全留给自己）；
 * - **持续帧**：游戏每帧都要推进，所以打开 `setContinuousFrames`，否则引擎的空闲停帧
 *   会在没有动画时把 rAF 循环停掉（画面冻住，且不报错）。暂停时由 `kit/loop` 关掉它。
 */
import { ICE } from 'ice-render';
import { ICE_ARCADE_THEME, ICEHoverManager, iceUIManager } from 'ice-web-components';

/** 画布内矩形（世界坐标 = 相对画布左上角）。 */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class GamePage {
  /** 引擎实例。 */
  ice: any;
  /** 当前主题 token（街机主题）。 */
  /**
   * 构建期的主题快照 —— **只用于非颜色用途**（阴影、间距这类）。
   *
   * ⚠️ 颜色一律写**主题引用** `token('ui.colors.x')`：存下来的颜色会冻在构造那一刻，
   * 切主题时不重建页面就不会变（家族里实测过这个坑：图例整块 253 个节点一个颜色都没变）。
   */
  theme: any;
  canvas: HTMLCanvasElement;
  /** 画布设计宽（来自 `<canvas width>`）。 */
  width: number;
  /** 画布设计高。 */
  height: number;

  /**
   * 初始化游戏页面。
   *
   * ⚠️ 必须在 DOM 就绪后调用（脚本用 `defer` 注入，所以默认就是就绪的）。
   */
  constructor(options: CreatePageOptions = {}) {
    const canvasId = options.canvasId || 'canvas';
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) {
      throw new Error(`GamePage：找不到 <canvas id="${canvasId}">`);
    }

    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.ice = new ICE().init(canvasId, { dpr });

    // 街机主题是完整主题（token 组与内置 dark 一致，只换颜色），小游戏统一用它。
    // 第二个参数把主题也同步给引擎（选中框 / 手柄 / 插槽等外壳 token）。
    iceUIManager.registerTheme('arcade', ICE_ARCADE_THEME).setTheme('arcade', this.ice);
    this.theme = iceUIManager.getTheme();

    new ICEHoverManager(this.ice).start();

    if (options.continuousFrames !== false) {
      this.ice.setContinuousFrames(true);
    }

    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  /**
   * 取节点的**世界坐标**（沿 `parentNode` 累加 `left/top`）。
   *
   * 终止条件是 `cursor.state` 而不是 `cursor`：`ICE` 实例本身没有 `state`，
   * 写成 `while (cursor)` 会在根上读 `state.left` 直接崩。
   *
   * e2e 点画布控件必须用世界坐标 —— 背像素的测试会在换版面时静默失效。
   */
  worldRect(node: any): Rect {
    let left = 0;
    let top = 0;
    let cursor = node;
    while (cursor && cursor.state) {
      left += cursor.state.left || 0;
      top += cursor.state.top || 0;
      cursor = cursor.parentNode;
    }
    return {
      left,
      top,
      width: (node.state && node.state.width) || 0,
      height: (node.state && node.state.height) || 0,
    };
  }

  /** 深度优先按 `state.id` 找节点（侧栏/卡内控件都不是画布的直接子节点）。 */
  find(id: string): any {
    if (typeof this.ice.find === 'function') {
      const hit = this.ice.find(id);
      if (hit) return hit;
    }
    // 兜底：自己深度优先（`ice.find` 的行为随引擎版本有过变化，这里不依赖它）
    const walk = (nodes: any[]): any => {
      for (const node of nodes || []) {
        if (node.state && node.state.id === id) return node;
        const hit = walk(node.childNodes);
        if (hit) return hit;
      }
      return undefined;
    };
    return walk(this.ice.childNodes);
  }
}

export interface CreatePageOptions {
  /** canvas 元素 id，默认 `canvas`。 */
  canvasId?: string;
  /** 是否打开持续帧（默认 true；极少数纯静态页可以关掉省电）。 */
  continuousFrames?: boolean;
}
