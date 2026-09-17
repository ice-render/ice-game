/**
 * 首页「页面 chrome」的公共件：品牌徽标、可点链接、分隔线、文本宽度估算。
 *
 * 导航栏（`navbar.ts`）与页脚（`footer.ts`）都用这一份 —— 它们在视觉语言上必须一致
 * （链接的常态/悬停/激活三种状态、品牌徽标形状、分隔线粗细），各写一遍必然长歪。
 *
 * 这一层是**首页专用**，所以不放 `src/kit/`：kit 的定位是"每个游戏都会重复写的东西"，
 * 而导航栏/页脚是应用外壳，游戏里不会出现。
 */
import { ICEImage } from 'ice-render';
import { ICELabel, ICEPanel, ICEWidget } from 'ice-web-components';
import type { GamePage } from '../kit';

/**
 * 文本宽度估算。
 *
 * 画布控件**没有** DOM 的自动测量：要排一行 chip/链接就得自己算宽度。
 * 中文按 1em、ASCII 按 0.58em 估（`ice-web-components` 内部对 CJK 也是这个量级），
 * 再加左右内边距。宁可估宽一点 —— 估窄了会挤压邻居（本仓已经踩过"列宽不够被挤出卡片"）。
 *
 * ⚠️ 这只是**兜底**（拿不到 canvas 时用）。需要精确的地方请用 `measureTextWidth` ——
 * 实测这个估法对长 ASCII（如 `ice-web-components`）会低估约 8%，
 * 结果是被 `ICETag` / `ICEBadge` **静默截断**成 `ice-web-compone…`（截图里抓到过）。
 */
export function textWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) width += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.58;
  return Math.ceil(width);
}

/**
 * 离屏 2D 上下文（惰性创建，只建一次）。
 *
 * 用途：用 `measureText` 拿**真实的**文字宽度，而不是按系数估算。
 * 家族控件（`ICETag` / `ICEBadge`）的文字区是 `width - 2 × 内边距`，
 * 所以给它们的宽度必须与真实字宽一致 —— 估窄了就截断，估宽了标签显得松垮。
 */
let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    measureCtx = null;
    return measureCtx;
  }
  const canvas = document.createElement('canvas');
  measureCtx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  return measureCtx;
}

/** 默认字体族：与 `ICEThemeTokens.font.family` 的首选一致（测量结果才与绘制对得上）。 */
const MEASURE_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * 真实文字宽度（`canvas.measureText`）。
 *
 * 拿不到 2D 上下文时回退到 `textWidth()` 的估算 —— 宁愿稍微截断，也不能让调用方崩。
 *
 * @param fontWeight 只影响测量精度（粗体略宽）。传字符串形式的字重，如 `'600'`。
 */
export function measureTextWidth(text: string, fontSize: number, fontWeight: string = 'normal'): number {
  const ctx = getMeasureContext();
  if (!ctx) return textWidth(text, fontSize);
  ctx.font = `${fontWeight} ${fontSize}px ${MEASURE_FONT_FAMILY}`;
  const width = ctx.measureText(text).width;
  // 向上取整并留 1px 余量：不同平台的字体渲染有小差异，宁可宽一点点
  return Number.isFinite(width) && width > 0 ? Math.ceil(width) + 1 : textWidth(text, fontSize);
}

/**
 * 家族控件（`ICETag` / `ICEBadge` / `ICEButton` 那一类）适配的宽度。
 *
 * 这些控件内部都按 `padX = theme.spacing.sm`（12）左右各留内边距，
 * 所以"刚好放下这段文字"的宽度 = 真实字宽 + 24。
 * 本函数把这件事收在一处 —— 之前每个调用点各写一个 `+26` / 固定 56，
 * 长了就截断（`小游戏` 三字在 56px 宽里显示成 `小…`）。
 */
export function fitControlWidth(text: string, fontSize: number, fontWeight: string = 'normal'): number {
  return measureTextWidth(text, fontSize, fontWeight) + 24;
}

/**
 * 品牌徽标：**一块冰（等距视角的 3D 冰块）**。
 *
 * 原先是"圆角蓝方块 + 白色播放三角"，看起来像个视频播放按钮，用户觉得太丑。
 * 改成一块冰块 —— 用引擎的 `ICEImage` 直接画一张**开源风格的冰块 SVG**
 * （自绘、CC0 无版权风险），画布里矢量缩放，任意尺寸都清晰。
 *
 * 为什么用 `ICEImage` 而不是 `ICEIsogon`/`ICEPanel` 拼：
 * 冰块的"三面体 + 高光"是自由多边形，ICE 的基础图元（正多边形 / 圆角矩形）拼不出
 * 这种等距三面体的立体感；而 `ICEImage` 由引擎的 imageCache 加载并 `drawImage`
 * 缩放绘制到组件框，等于把一张真·冰块 SVG 当贴图用，最稳也最好看。
 *
 * ⚠️ `ICEImage` 是**异步**加载：图片没下载完那一帧 `doRender` 直接跳过（画不出）。
 * 首页主画布没有常驻动画循环（背景动效在另一个 `#bg` 实例上），所以静态的
 * 导航栏 / 页脚徽标在图片加载完之后**不会自动重绘**——这里用一张 `new Image()`
 * _probe 同地址，加载完成就把引擎置脏，强制补一帧。
 *
 * @param options.glow   是否在底下垫一圈低透明度的蓝色外发光（导航栏 / hero 用）。
 * @param options.fillStyle / radius 旧签名保留但不再使用（颜色由冰块 SVG 自带）。
 */
const ICE_CUBE_RAW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="22 22 84 84">
  <path d="M79 44 L79 98 L101 82 L101 28 Z" fill="#79d0ec" stroke="#36b0d4" stroke-width="3" stroke-linejoin="round"/>
  <path d="M27 44 L79 44 L79 98 L27 98 Z" fill="#a6e3f5" stroke="#36b0d4" stroke-width="3" stroke-linejoin="round"/>
  <path d="M27 44 L79 44 L101 28 L49 28 Z" fill="#e6fbff" stroke="#36b0d4" stroke-width="3" stroke-linejoin="round"/>
  <path d="M54 36 L96 36" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
  <circle cx="40" cy="54" r="3" fill="#ffffff" opacity="0.8"/>
</svg>`;
/** `data:` URI（URL 编码，避免 base64 体积）：`ICEImage` 与 favicon 共用同款造型。 */
export const ICE_CUBE_SVG = `data:image/svg+xml,${encodeURIComponent(ICE_CUBE_RAW)}`;

export function brandBadge(
  parent: any,
  options: { left: number; top: number; size?: number; accent: string; radius?: number; fillStyle?: any; glow?: boolean },
): any {
  const size = options.size || 28;

  // 外发光：一枚比徽标大一圈、低透明度的方块垫在底下（画布里没有 CSS box-shadow，
  // 想要"发光"就得自己叠一层。alpha 压得很低，只做氛围）
  if (options.glow) {
    const spread = Math.round(size * 0.34);
    parent.addChild(
      new ICEPanel({
        interactive: false,
        left: options.left - spread,
        top: options.top - spread,
        width: size + spread * 2,
        height: size + spread * 2,
        radius: Math.round((size + spread * 2) * 0.34),
        style: { fillStyle: 'rgba(13, 110, 253, 0.16)', strokeStyle: 'rgba(13, 110, 253, 0)', shadowBlur: 0 },
      }),
      false,
    );
  }

  const badge = new ICEImage({
    interactive: false,
    left: options.left,
    top: options.top,
    width: size,
    height: size,
    src: ICE_CUBE_SVG,
  });
  parent.addChild(badge, false);

  /*
   * 异步加载补帧：图片下载完时主动把引擎置脏。
   * `parent` 可能是节点（导航栏的 content widget，用 `parent.ice`）也可能是引擎实例
   * 本身（页脚传 `page.ice`、hero 传 `ice`），统一兜底到 `parent.ice || parent`。
   */
  const iceRef = parent && parent.ice ? parent.ice : parent;
  const probe = new Image();
  probe.onload = () => {
    if (iceRef && typeof iceRef.dirty === 'boolean') iceRef.dirty = true;
  };
  probe.onerror = () => {};
  probe.src = ICE_CUBE_SVG;

  return badge;
}

/** 一条 1px 分隔线（横/竖）。 */
export function divider(parent: any, options: { left: number; top: number; width?: number; height?: number; color: string }): any {
  const line = new ICEPanel({
    interactive: false,
    left: options.left,
    top: options.top,
    width: options.width ?? 1,
    height: options.height ?? 1,
    radius: 0,
    style: { fillStyle: options.color, strokeStyle: options.color, shadowBlur: 0, lineWidth: 0 },
  });
  parent.addChild(line, false);
  return line;
}

export interface LinkOptions {
  id: string;
  left: number;
  top: number;
  /** 命中区宽高（不传宽度则按文字 +2×padding 估）。 */
  width?: number;
  height: number;
  text: string;
  fontSize?: number;
  /** 水平内边距（用于估宽与文字起点）。 */
  paddingX?: number;
  /** 文字对齐（列式布局里常用左对齐 + 固定列宽）。 */
  align?: 'left' | 'center' | 'right';
  accent: string;
  /** 点击回调（外链由调用方决定 window.open / location）。 */
  onClick: () => void;
  /**
   * 悬停/激活时显示一条下划线（纯文字链接用；胶囊形态请用 `pill`）。
   */
  underline?: boolean;
  /**
   * 是否渲染成**胶囊**（导航项、按钮用）。
   *
   * 胶囊是导航"能看出可以点、也能看出当前在哪"的关键：
   * 纯文字链接在深色条上很难分辨可点性，也很难表达激活态。
   * 胶囊的状态色由 `setActive` / 悬停驱动（见下方 `apply()`）。
   */
  pill?: boolean;
  /** 胶囊的圆角（默认取高度一半，即全圆角）。 */
  pillRadius?: number;
  /** 激活时是否用 accent **实心**填充（按钮用）而不是"淡色底 + accent 字"。 */
  solid?: boolean;
  /** 常态文字色（默认主题次级色）。 */
  color?: string;
}

export interface LinkHandle {
  /** 命中区（`worldRect` 可用它拿世界坐标）。 */
  node: any;
  label: any;
  /** 设为"当前所在区块"（导航高亮用）。 */
  setActive(active: boolean): void;
  /** 当前是否激活（e2e 断言用）。 */
  isActive(): boolean;
  /** 当前是否悬停。 */
  isHovered(): boolean;
}

/**
 * 可点链接：文字 + 悬停反馈 + 点击回调（可选胶囊底）。
 *
 * 三种状态各自的作用（区分开才不会互相打架）：
 * - **常态**：次级色（胶囊时是极淡的底，几乎看不见）；
 * - **悬停**：正文色 + 底变亮（`ICEHoverManager` 派发 `hoverchange`）；
 * - **激活**：accent 色 —— 导航栏标记"当前所在区块"，滚动时自动切换。
 *
 * ⚠️ 读 `hoverchange` 的载荷要用 **`evt.param`**：`ICEWidget.setHovered()` 调的是
 * `trigger('hoverchange', null, { hovered })`，而 `trigger(name, originalEvent, param)`
 * 把数据放进 `evt.param` —— 直接读 `payload.hovered` 恒为 `undefined` 且不报错（踩过）。
 */
export function createLink(parent: any, page: GamePage, options: LinkOptions): LinkHandle {
  const theme = page.theme;
  const fontSize = options.fontSize || 13;
  const paddingX = options.paddingX ?? 10;
  const width = options.width || textWidth(options.text, fontSize) + paddingX * 2;

  const node = new ICEWidget({
    id: options.id,
    interactive: true,
    left: options.left,
    top: options.top,
    width,
    height: options.height,
    fill: false,
    stroke: false,
  });
  parent.addChild(node, false);

  /*
   * 胶囊底必须先挂：挂载顺序 = 绘制顺序，后挂的盖在上面。
   * （曾经试过先挂内容再往 `childNodes` 里 unshift —— 那是绕过引擎的挂载逻辑，
   * 不设 `parentNode`、不走置脏，不能用。）
   */
  let pillNode: any = null;
  if (options.pill) {
    pillNode = new ICEPanel({
      interactive: false,
      left: 0,
      top: 0,
      width,
      height: options.height,
      radius: options.pillRadius ?? Math.round(options.height / 2),
      style: { fillStyle: 'rgba(255,255,255,0.04)', strokeStyle: 'rgba(255,255,255,0)' },
    });
    node.addChild(pillNode, false);
  }

  const label = new ICELabel({
    interactive: false,
    left: options.align === 'left' ? paddingX : 0,
    top: 0,
    width: options.align === 'left' ? width - paddingX * 2 : width,
    height: options.height,
    align: options.align || 'center',
    verticalAlign: 'middle',
    text: options.text,
    style: { fontSize, fillStyle: options.color || theme.colors.textSecondary },
  });
  node.addChild(label, false);

  let underlineNode: any = null;
  if (options.underline) {
    const lineWidth = Math.max(16, textWidth(options.text, fontSize));
    const lineLeft =
      options.align === 'center'
        ? Math.round((width - lineWidth) / 2)
        : options.align === 'right'
          ? width - lineWidth - paddingX
          : paddingX;
    underlineNode = new ICEPanel({
      interactive: false,
      left: lineLeft,
      top: options.height - 2,
      width: lineWidth,
      height: 2,
      radius: 1,
      style: { fillStyle: options.accent, strokeStyle: options.accent, shadowBlur: 0, lineWidth: 0 },
    });
    underlineNode.setState({ display: false });
    node.addChild(underlineNode, false);
  }

  let hovered = false;
  let active = false;

  /** 状态的唯一出口：改色只在这里，避免多处 setState 互相覆盖。 */
  const apply = () => {
    label.setState({
      style: {
        ...label.state.style,
        fillStyle: options.solid
          ? // 实心按钮：文字只随悬停微微变化，激活与否都是浅色字（底已经足够明确）
            hovered
            ? '#ffffff'
            : 'rgba(255,255,255,0.94)'
          : active
            ? options.accent
            : hovered
              ? theme.colors.text
              : options.color || theme.colors.textSecondary,
      },
    });

    if (pillNode) {
      const fill = options.solid
        ? hovered
          ? 'rgba(13,110,253,1)'
          : 'rgba(13,110,253,0.86)'
        : active
          ? 'rgba(13,110,253,0.20)'
          : hovered
            ? 'rgba(255,255,255,0.10)'
            : 'rgba(255,255,255,0.04)';
      const stroke = options.solid
        ? 'rgba(122,178,255,0.85)'
        : active
          ? 'rgba(13,110,253,0.55)'
          : 'rgba(255,255,255,0)';
      pillNode.setState({ style: { ...pillNode.state.style, fillStyle: fill, strokeStyle: stroke } });
    }

    if (underlineNode) underlineNode.setState({ display: hovered || active });
    page.ice.dirty = true;
  };

  node.on('hoverchange', (evt: any) => {
    hovered = Boolean(evt && evt.param && evt.param.hovered);
    apply();
  });
  node.on('click', () => options.onClick());

  return {
    node,
    label,
    setActive(next: boolean) {
      if (active === next) return;
      active = next;
      apply();
    },
    isActive: () => active,
    isHovered: () => hovered,
  };
}
