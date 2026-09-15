/**
 * 首页「页面 chrome」的公共件：品牌徽标、可点链接、分隔线、文本宽度估算。
 *
 * 导航栏（`navbar.ts`）与页脚（`footer.ts`）都用这一份 —— 它们在视觉语言上必须一致
 * （链接的常态/悬停/激活三种状态、品牌徽标形状、分隔线粗细），各写一遍必然长歪。
 *
 * 这一层是**首页专用**，所以不放 `src/kit/`：kit 的定位是"每个游戏都会重复写的东西"，
 * 而导航栏/页脚是应用外壳，游戏里不会出现。
 */
import { ICEIsogon } from 'ice-render';
import { ICELabel, ICEPanel, ICEWidget } from 'ice-web-components';
import type { GamePageHandle } from '../kit';

/**
 * 文本宽度估算。
 *
 * 画布控件**没有** DOM 的自动测量：要排一行 chip/链接就得自己算宽度。
 * 中文按 1em、ASCII 按 0.58em 估（`ice-web-components` 内部对 CJK 也是这个量级），
 * 再加左右内边距。宁可估宽一点 —— 估窄了会挤压邻居（本仓已经踩过"列宽不够被挤出卡片"）。
 */
export function textWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) width += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.58;
  return Math.ceil(width);
}

/**
 * 品牌徽标：accent 色圆角方块 + 白色播放三角（与页面 favicon 同形）。
 *
 * 三角用引擎的 `ICEIsogon`（正多边形，`edges: 3`）画，**不用字符**：
 * 引擎的文本渲染走 canvas `fillText`，`▶` 这类"几何形状字符"在部分字体/平台下会走
 * 彩色 emoji 呈现，渲染成怪符号（AGENTS 铁律 6 已记录同类问题）。
 * 用图元拼出来的 mark 在任何字体环境下都稳定，也不依赖字体有没有这个字形。
 */
export function brandBadge(
  parent: any,
  options: { left: number; top: number; size?: number; accent: string; radius?: number },
): any {
  const size = options.size || 28;
  const badge = new ICEPanel({
    interactive: false,
    left: options.left,
    top: options.top,
    width: size,
    height: size,
    radius: options.radius ?? Math.round(size * 0.28),
    style: { fillStyle: options.accent, strokeStyle: options.accent, shadowBlur: 0, lineWidth: 0 },
  });
  parent.addChild(badge, false);

  /*
   * 播放三角：`startAngle: 0` 让一个顶点朝右（`dotPath` 的默认原点在 (0,0)，
   * 而正多边形的点是绕原点算的）—— 所以这里把它放在徽标中心，靠 `radius` 控制大小，
   * 再整体右移一点点，视觉上才是"居中"（三角形重心偏左）。
   */
  const radius = Math.round(size * 0.26);
  const triangle = new ICEIsogon({
    interactive: false,
    left: Math.round(size / 2 + radius * 0.18),
    top: Math.round(size / 2),
    radius,
    edges: 3,
    startAngle: 90,
    style: { fillStyle: '#ffffff', strokeStyle: '#ffffff', lineWidth: 0, shadowBlur: 0 },
  });
  badge.addChild(triangle, false);
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
  /** 悬停时是否显示下划线（导航项要，页脚列表不要）。 */
  underline?: boolean;
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
 * 可点链接：文字 + 悬停反馈 + 点击回调。
 *
 * 三种状态各自的作用（区分开才不会互相打架）：
 * - **常态**：次级色；
 * - **悬停**：正文色 + 可选下划线（`ICEHoverManager` 派发 `hoverchange`）；
 * - **激活**：accent 色（导航栏标记"当前所在区块"，滚动时自动切换）。
 *
 * ⚠️ 读 `hoverchange` 的载荷要用 **`evt.param`**：`ICEWidget.setHovered()` 调的是
 * `trigger('hoverchange', null, { hovered })`，而 `trigger(name, originalEvent, param)`
 * 把数据放进 `evt.param` —— 直接读 `payload.hovered` 恒为 `undefined` 且不报错（踩过）。
 */
export function createLink(parent: any, page: GamePageHandle, options: LinkOptions): LinkHandle {
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

  const label = new ICELabel({
    interactive: false,
    left: options.align === 'center' || options.align === 'right' ? 0 : paddingX,
    top: 0,
    width: options.align === 'left' ? width - paddingX * 2 : width,
    height: options.height,
    align: options.align || 'left',
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

  /** 状态的唯一出口：改颜色/下划线只在这里，避免多处 setState 互相覆盖。 */
  const apply = () => {
    label.setState({
      style: {
        ...label.state.style,
        fillStyle: active
          ? options.accent
          : hovered
            ? theme.colors.text
            : options.color || theme.colors.textSecondary,
      },
    });
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
