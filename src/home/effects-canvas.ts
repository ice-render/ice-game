/**
 * 首页**动态效果画布** —— 第三个"岛"（`#bg`），也是整页最"炫"的一层。
 *
 * ## 为什么要单独一块画布，而不是画在主体画布上
 *
 * 主体画布有 1180×1396 那么大，上面全是卡片与文字。**每帧重绘它**（背景要动就得每帧画）
 * 等于把"静态的整页内容"也一起重画几十遍 —— 而内容本身一帧都没变。
 * 所以把会动的部分隔离到一块**视口大小的固定画布**上：
 *
 * ```
 * body 背景（CSS 渐变）
 *   └── #bg       ← 本文件：position: fixed，视口大小，每帧重绘（网格 / 粒子 / 光斑）
 *        └── #canvas  ← 主体：卡片与文字，静态（只在交互时重绘）
 *             └── #navbar ← 吸顶导航，独立实例
 * ```
 *
 * 顺带得到一个很好看的副作用：粒子层是 `fixed` 而卡片层会滚动，
 * 滚动时"星星在玻璃后面不动、内容从前面滑过"—— 视差感是免费的。
 *
 * ## 粒子怎么画：自定义 ICE 组件
 *
 * 引擎的扩展点是**覆写 `doRender()`**（`ICEImage` / `ICERect` 都是这么做的），
 * 组件被绘制时 `ctx` 已经带上了它自己的世界变换，所以在方法里直接用**局部坐标**画即可。
 * 这里继承 `ICEComponent` 而不是 `ICERect`：只需要一块画布区域，不需要矩形路径。
 *
 * 每帧由 `loop`（复用 `src/kit/loop`）推进粒子位置，并置脏让引擎重绘。
 */
import { ICEComponent } from 'ice-render';
import { ICEPanel } from 'ice-web-components';
import { GamePage, startLoop, type LoopHandle } from '../kit';

/** 效果画布尺寸。宽度与页面主体同宽（左右对齐），高度跟随视口。 */
export const EFFECTS = {
  width: 1180,
  /** 粒子数量（实测这个量级在集显上也很稳；再多收益不明显，只是更费电）。 */
  particleCount: 64,
  /** 两个粒子近于此距离就画一条连线。 */
  linkDistance: 132,
  /** 网格步长（与旧的 CSS 网格一致）。 */
  grid: 34,
};

/** 一颗漂浮的光点。 */
interface Dot {
  x: number;
  y: number;
  /** 半径（px）。 */
  r: number;
  /** 速度（px/秒）。 */
  vx: number;
  vy: number;
  /** 基础亮度 0..1。 */
  alpha: number;
  /** 呼吸相位：让每颗点自己闪烁，而不是整齐划一。 */
  phase: number;
}

/** 一个缓慢移动的大光斑（制造纵深）。 */
interface Orb {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  color: string;
}

/**
 * 环境场：细网格 + 漂浮粒子 + 近距离连线 + 大光斑。
 *
 * 全部画在**一次** `doRender()` 里 —— 分几个组件也行，但同一块画布上多一个组件就多一次
 * 变换/状态切换，而且它们本来就该是同一层氛围。
 */
class AmbientField extends ICEComponent {
  private dots: Dot[] = [];
  private orbs: Orb[] = [];
  private fieldWidth = 0;
  private fieldHeight = 0;
  /** 累计时间（秒），用于闪烁与光斑呼吸。 */
  private time = 0;

  constructor(props: any = {}) {
    super({ fill: false, stroke: false, interactive: false, ...props });
    /*
     * 构造期**不要调 `setState`**：那时引擎还没把组件挂进实例，状态合并路径可能依赖
     * `this.ice`。所以这里只播撒粒子（纯内部字段），盒子尺寸由传入的 props 决定。
     */
    this.__seed(Number(this.state.width) || EFFECTS.width, Number(this.state.height) || 600);
  }

  /** 粒子数（e2e 断言用）。 */
  public particleCount(): number {
    return this.dots.length;
  }

  /** 尺寸变化时重建粒子（按面积给数量，窗口高时不会显得稀疏）。 */
  resize(width: number, height: number): void {
    this.__seed(width, height);
    // 尺寸要写回 state：a11y 树（版面体检）与命中测试读的都是 state
    this.setState({ width: this.fieldWidth, height: this.fieldHeight });
  }

  private __seed(width: number, height: number): void {
    this.fieldWidth = Math.max(1, width);
    this.fieldHeight = Math.max(1, height);

    // 粒子数按可视面积微调，但设上下限：太少没氛围、太多费电
    const scaled = Math.round((EFFECTS.particleCount * this.fieldHeight) / 900);
    const count = Math.max(28, Math.min(96, scaled));
    const random = (min: number, max: number) => min + Math.random() * (max - min);

    this.dots = Array.from({ length: count }, () => ({
      x: random(0, this.fieldWidth),
      y: random(0, this.fieldHeight),
      r: random(0.8, 2.3),
      // 慢：每秒几到十几像素。快了就成"雪花屏"，不是氛围
      vx: random(-9, 9),
      vy: random(-13, -3),
      alpha: random(0.18, 0.62),
      phase: random(0, Math.PI * 2),
    }));

    this.orbs = [
      {
        x: this.fieldWidth * 0.24,
        y: this.fieldHeight * 0.2,
        r: Math.max(220, this.fieldWidth * 0.3),
        vx: 7,
        vy: 4,
        color: 'rgba(13, 110, 253, 0.085)',
      },
      {
        x: this.fieldWidth * 0.78,
        y: this.fieldHeight * 0.62,
        r: Math.max(180, this.fieldWidth * 0.24),
        vx: -5,
        vy: -3,
        color: 'rgba(90, 200, 250, 0.06)',
      },
    ];
  }

  /**
   * 推进一帧。
   *
   * @param dtMs 距上一帧的毫秒数（`loop` 已经做过上限钳制，切标签页回来不会瞬移）
   */
  step(dtMs: number): void {
    const dt = dtMs / 1000;
    this.time += dt;
    const { fieldWidth: w, fieldHeight: h } = this;

    for (const dot of this.dots) {
      dot.x += dot.vx * dt;
      dot.y += dot.vy * dt;
      // 环绕而不是反弹：反弹会在边界堆一串点，环绕看起来像"无限星空"
      if (dot.y < -6) dot.y = h + 6;
      if (dot.y > h + 6) dot.y = -6;
      if (dot.x < -6) dot.x = w + 6;
      if (dot.x > w + 6) dot.x = -6;
    }

    for (const orb of this.orbs) {
      orb.x += orb.vx * dt;
      orb.y += orb.vy * dt;
      // 大光斑在边界来回折返（它们很大，环绕会突兀）
      if (orb.x < -orb.r * 0.4 || orb.x > w + orb.r * 0.4) orb.vx *= -1;
      if (orb.y < -orb.r * 0.4 || orb.y > h + orb.r * 0.4) orb.vy *= -1;
    }
  }

  protected doRender(): void {
    const ctx = this.ctx;
    const w = this.fieldWidth;
    const h = this.fieldHeight;

    // ① 大光斑：两层径向渐变，制造纵深（先画，垫在最底下）
    for (const orb of this.orbs) {
      const gradient = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r);
      gradient.addColorStop(0, orb.color);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(orb.x - orb.r, orb.y - orb.r, orb.r * 2, orb.r * 2);
    }

    // ② 细网格：整块画一次 Path，比逐线 stroke 省
    const step = EFFECTS.grid;
    ctx.beginPath();
    for (let x = 0.5; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = 0.5; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.strokeStyle = 'rgba(120, 165, 255, 0.055)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ③ 粒子之间的"星座"连线：只连足够近的，距离越近越亮
    const linkSq = EFFECTS.linkDistance * EFFECTS.linkDistance;
    ctx.lineWidth = 1;
    for (let i = 0; i < this.dots.length; i += 1) {
      const a = this.dots[i];
      for (let j = i + 1; j < this.dots.length; j += 1) {
        const b = this.dots[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > linkSq) continue;
        const fade = 1 - Math.sqrt(distSq) / EFFECTS.linkDistance;
        ctx.strokeStyle = `rgba(120, 180, 255, ${(fade * 0.22).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // ④ 粒子本体：亮度带正弦呼吸，让画面"活着"而不是一张静止的点阵
    for (const dot of this.dots) {
      const breathe = 0.72 + 0.28 * Math.sin(this.time * 1.6 + dot.phase);
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(186, 219, 255, ${(dot.alpha * breathe).toFixed(3)})`;
      ctx.fill();
    }

    // 父类只负责 min/max 调试框（默认关闭）；fill/stroke 都是 false，这里是空操作
    super.doRender();
  }
}

export interface EffectsLayer {
  page: GamePage;
  loop: LoopHandle;
  /** 跟随视口高度调整尺寸（已挂 window resize）。 */
  resize(): void;
  /** 运行状态（e2e 断言"粒子真的在动"用）。 */
  stats(): { canvas: string; particles: number; frames: number; paused: boolean; reducedMotion: boolean };
  destroy(): void;
}

/**
 * 挂载效果画布。
 *
 * 若用户开了"减少动态效果"（`prefers-reduced-motion`），**只画一帧静态画面**、不跑循环 ——
 * 无障碍偏好要被尊重，而不是"动画很好看所以照跑"。
 */
export function mountEffects(): EffectsLayer {
  const canvas = document.getElementById('bg') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('mountEffects：找不到 <canvas id="bg">');

  const height = Math.max(420, window.innerHeight);
  canvas.width = EFFECTS.width;
  canvas.height = height;

  const page = new GamePage({ canvasId: 'bg', continuousFrames: false });

  /** 底色：一层很淡的径向渐变，让背景不是纯平（画布自身透明，露出的还是 body 的底色）。 */
  const base = page.ice.createRadialGradient(
    EFFECTS.width * 0.5,
    height * 0.12,
    0,
    EFFECTS.width * 0.5,
    height * 0.12,
    EFFECTS.width * 0.72,
  );
  base.addColorStop(0, 'rgba(27, 33, 48, 0.85)');
  base.addColorStop(1, 'rgba(8, 10, 15, 0)');
  page.ice.addChild(
    new ICEPanel({
      id: 'bg-base',
      interactive: false,
      left: 0,
      top: 0,
      width: EFFECTS.width,
      height,
      radius: 0,
      style: { fillStyle: base, strokeStyle: 'rgba(0,0,0,0)', lineWidth: 0, shadowBlur: 0 },
    }),
  );

  const field = new AmbientField({
    id: 'bg-field',
    left: 0,
    top: 0,
    width: EFFECTS.width,
    height,
  });
  page.ice.addChild(field);

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const resize = () => {
    const next = Math.max(420, window.innerHeight);
    if (canvas.height === next) return;
    canvas.height = next;
    page.ice.refreshInputRect();
    field.resize(EFFECTS.width, next);
    page.ice.requestRepaint();
  };
  window.addEventListener('resize', resize);

  // 静态模式：画一帧就停（粒子仍在，只是不动），也算"尊重偏好"
  const loop = startLoop(page, (dt) => {
    field.step(dt);
  });
  if (reduceMotion) {
    loop.setPaused(true);
    field.step(0);
  }
  page.ice.requestRepaint();


  return {
    page,
    loop,
    resize,
    stats: () => ({
      canvas: `${canvas.width}×${canvas.height}`,
      particles: field.particleCount(),
      frames: loop.frames,
      paused: loop.paused,
      reducedMotion: reduceMotion,
    }),
    destroy() {
      window.removeEventListener('resize', resize);
      loop.stop();
    },
  };
}
