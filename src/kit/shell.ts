/**
 * 游戏外壳：标题 / 数值卡 / 按钮 / 帮助 / 暂停与结束覆盖层。
 *
 * 小游戏的界面骨架其实高度雷同（标题 + 分数 + 几个按钮 + 一行操作说明 + 暂停/结束遮罩），
 * 每个游戏抄一遍的话，「大量」很快就变成大量重复代码 —— 这个文件把那部分收成一处。
 *
 * 布局是**约定式**的：调用方只给"游戏区在哪"（`stage`），外壳自动在它的上方排标题与数值卡、
 * 下方排按钮与操作说明。之所以不让外壳自己猜游戏区大小：游戏版面是设计师定的，
 * 外壳只负责围着它排，两者职责不重叠。
 *
 * ```ts
 * const shell = new GameShell({
 *   page,
 *   title: '打砖块',
 *   stage: { left: 230, top: 170, width: 720, height: 460 },
 *   stats: [{ id: 'score', label: '分数' }, { id: 'best', label: '最高分' }],
 *   actions: [{ id: 'pause', text: '暂停 (P)', onClick: togglePause }],
 *   help: [['← →', '移动挡板'], ['空格', '发球']],
 *   sound: { on: true, onToggle: (on) => audio.setEnabled(on) },
 * });
 * shell.setStat('score', 120);
 * shell.showOverlay({ kind: 'over', title: '游戏结束', subtitle: '得分 120', hint: '按 R 重开' });
 * ```
 *
 * 所有节点坐标都是**画布绝对坐标**（外壳根容器固定在 0,0，所以容器内坐标 = 画布坐标）。
 */
import { ICEBoxLayout, token, type ICEThemeTokenRef } from 'ice-render';
import { ICEButton, ICELabel, ICEPanel, ICEWidget } from 'ice-web-components';
import type { GamePage } from './page';

export interface ShellStat {
  id: string;
  label: string;
  /** 初始值（默认空）。 */
  value?: string;
  /** 数值强调色（默认主题文本色）。 */
  /** 允许主题引用（`token('ui.colors.warning')` 这类）—— 引用是 paint 时解析的，热切换跟得上。 */
  accent?: string | ICEThemeTokenRef;
  /** 卡宽；不填则按可用宽度均分。 */
  width?: number;
}

export interface ShellAction {
  id: string;
  text: string;
  variant?: 'primary' | 'default' | 'text' | 'link';
  onClick: () => void;
}

export interface ShellSoundToggle {
  /** 初始是否开启。 */
  on: boolean;
  /** 用户点了音效按钮时回调（外部据此真正开关音频）。 */
  onToggle: (on: boolean) => void;
}

export interface ShellStage {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ShellOptions {
  page: GamePage;
  title: string;
  subtitle?: string;
  /** 游戏画面占的矩形（画布坐标）。外壳围着它排，默认居中 720×460。 */
  stage?: ShellStage;
  stats?: ShellStat[];
  actions?: ShellAction[];
  /** 操作说明：`[按键, 作用]`，每项一行。 */
  help?: [string, string][];
  sound?: ShellSoundToggle;
}

/** 覆盖层内容。 */
export interface OverlaySpec {
  kind: 'paused' | 'over' | 'win' | 'ready';
  title: string;
  subtitle?: string;
  hint?: string;
}

// `accent` 允许主题引用（四个状态强调色就是），所以类型不是 string。
const OVERLAY_STYLE: Record<OverlaySpec['kind'], { accent: string | ICEThemeTokenRef; glyph: string }> = {
  // 这四支是**语义状态色**（暂停 / 失败 / 胜利 / 就绪）——走主题引用，
  // 换主题（含街机主题）时它们跟着走，而不是钉在 Bootstrap 的默认色上。
  paused: { accent: token('ui.colors.warning'), glyph: '❚❚' },
  over: { accent: token('ui.colors.error'), glyph: '✕' },
  win: { accent: token('ui.colors.success'), glyph: '★' },
  ready: { accent: token('ui.colors.primary'), glyph: '▶' },
};

/** 数值卡高度、行距、帮助行高：外壳的纵向节奏由这几个数决定。 */
const STATS_HEIGHT = 68;
const STATS_GAP = 12;
const HELP_KEY_WIDTH = 110;
const HELP_ROW_HEIGHT = 24;
const ACTION_HEIGHT = 40;

/**
 * 纵向栈的间距（从 `stage` 倒推，见构造函数里的说明）。
 *
 * 这些数**互相独立不了**：改一个就要重新核对"上方/下方空间够不够"，
 * 所以统一放这里、并在构造时自检。要调版面节奏，改这一组数即可。
 */
/** 标题带高度（只有标题）。 */
const TITLE_BLOCK_HEIGHT = 34;
/** 标题带高度（标题 + 副标题）。 */
const TITLE_BLOCK_HEIGHT_WITH_SUBTITLE = 55;
/** 标题带 → 数值卡 的间距。 */
const TITLE_GAP_TO_STATS = 16;
/** 数值卡 → 游戏区 的间距。 */
const STATS_GAP_TO_STAGE = 20;
/** 画布顶部至少要留出的空白。 */
const MIN_TOP_PAD = 16;
/** 游戏区 → 按钮行 的间距。 */
const ACTIONS_GAP_TO_STAGE = 22;
/** 按钮行 → 操作说明 的间距。 */
const HELP_GAP_TO_ACTIONS = 12;

/**
 * 音效按钮的两个文案。
 *
 * ⚠️ **不要用 🔊 / 🔇 这类 emoji**：引擎的文本渲染走 canvas `fillText`，
 * 彩色 emoji 在这条路径下会渲染成怪符号（实测是一个方框加乱码）。
 * 画布内的文字一律当"普通字体里存在的字符"来用（中英文、数字、`←→` 这类符号都没问题）。
 */
const SOUND_ON_LABEL = '音效 开';
const SOUND_OFF_LABEL = '音效 关';

export class GameShell {
  readonly page: GamePage;
  readonly root: any;
  readonly overlayRoot: any;
  readonly stage: ShellStage;
  /**
   * 外壳内容的纵向布局（画布坐标）。
   *
   * `contentBottom` 是"最下面那一行内容的底边"。**它必须 ≤ 画布高度**，否则最后那行会被
   * 画布边缘静默裁掉（实测就是这样：帮助说明的第 4 行只露出半行，控制台一点提示都没有）。
   * 构造时会自己检查一次并告警；e2e 也拿它做通用断言（见 `e2e/catalog.spec.ts`）。
   */
  readonly layout: { titleTop: number; statsTop: number; actionsTop: number; helpTop: number; contentBottom: number };

  private statNodes = new Map<string, any>();
  private statusNode: any;
  private soundButton: any;
  private overlayNodes: { glyph: any; title: any; subtitle: any; hint: any };
  private overlayKind: OverlaySpec['kind'] | null = null;

  constructor(options: ShellOptions) {
    const page = options.page;
    this.page = page;
  
    const stage: ShellStage = options.stage || {
      left: Math.round((page.width - 720) / 2),
      top: 170,
      width: 720,
      height: 460,
    };
    this.stage = stage;

    /**
     * 各带子的纵向位置：**从 `stage` 向上/向下倒推**，不是各自写死。
     *
     * 为什么必须倒推：早先这里是一组互不相干的魔法数
     * （`titleTop = stage.top - 116`、`statsTop = max(titleTop + 66, stage.top - 88)`），
     * 它们**互相不一致** —— 当标题带够高时，`titleTop + 66` 这个约束会把数值卡顶到
     * 游戏区里去：实测 breakout 的数值卡与 stage 重叠了 **18px**（体检抓到的）。
     * 倒推之后，「标题 → 数值卡 → 游戏区」是一条栈，**结构上不可能重叠**。
     *
     * 顺带把"到底需要多少上边距"变成一个能算出来的数（见下面的自检），
     * 调用方一跑就知道该把 `stage.top` 改成多少 —— 而不是靠肉眼看截图。
     */
    const titleBlockHeight = options.subtitle ? TITLE_BLOCK_HEIGHT_WITH_SUBTITLE : TITLE_BLOCK_HEIGHT;
    const statsTop = stage.top - STATS_GAP_TO_STAGE - STATS_HEIGHT;
    const titleTop = statsTop - TITLE_GAP_TO_STATS - titleBlockHeight;
    const actionsTop = stage.top + stage.height + ACTIONS_GAP_TO_STAGE;
    const helpTop = actionsTop + ACTION_HEIGHT + HELP_GAP_TO_ACTIONS;

    // 自检 ①：上方空间不够时**立刻报错**并告诉需要多少（而不是静默压住游戏区）
    if (titleTop < MIN_TOP_PAD) {
      const needed = MIN_TOP_PAD + titleBlockHeight + TITLE_GAP_TO_STATS + STATS_HEIGHT + STATS_GAP_TO_STAGE;
      throw new Error(
        `[kit/shell] 外壳上方空间不足：stage.top = ${stage.top}，但至少需要 ${needed}。` +
          `（上边距 ${MIN_TOP_PAD} + 标题带 ${titleBlockHeight} + 间距 ${TITLE_GAP_TO_STATS} + ` +
          `数值卡 ${STATS_HEIGHT} + 间距 ${STATS_GAP_TO_STAGE}）` +
          `\n把 stage.top 调到 ≥ ${needed}，或把 meta.json 的 height 调大。`,
      );
    }

    this.root = new ICEWidget({
      id: 'game-shell',
      left: 0,
      top: 0,
      width: page.width,
      height: page.height,
      fill: false,
      stroke: false,
      interactive: false,
    });
    page.ice.addChild(this.root);

    /* ------------------------------- 标题带 ------------------------------- */

    this.root.addChild(
      new ICELabel({
        interactive: false,
        left: stage.left,
        top: titleTop,
        width: stage.width,
        text: options.title,
        style: { fontSize: 26, fontWeight: '700', fillStyle: token('ui.colors.text') },
      }),
      false,
    );
    if (options.subtitle) {
      this.root.addChild(
        new ICELabel({
          interactive: false,
          left: stage.left,
          top: titleTop + 36,
          width: stage.width,
          text: options.subtitle,
          style: { fontSize: 13, fillStyle: token('ui.colors.textSecondary') },
        }),
        false,
      );
    }
    /** 右上角状态文字（"进行中" / "已暂停"…） */
    this.statusNode = new ICELabel({
      interactive: false,
      left: stage.left + stage.width - 220,
      top: titleTop + 8,
      width: 220,
      align: 'right',
      text: '',
      style: { fontSize: 13, fillStyle: token('ui.colors.textTertiary') },
    });
    this.root.addChild(this.statusNode, false);

    /* ------------------------------ 数值卡行 ------------------------------ */

    const stats = options.stats || [];
    if (stats.length) {
      // 列宽按**实际张数**算：固定总数的死板写法会让第 5 张卡冲出画布被裁
      const fixedWidth = stats.reduce((sum, s) => sum + (s.width || 0), 0);
      const flexibleCount = stats.filter((s) => !s.width).length;
      const autoWidth = flexibleCount
        ? Math.floor((stage.width - STATS_GAP * (stats.length - 1) - fixedWidth) / flexibleCount)
        : 0;

      const row = new ICEWidget({
        id: 'game-shell-stats',
        left: stage.left,
        top: statsTop,
        width: stage.width,
        height: STATS_HEIGHT,
        fill: false,
        stroke: false,
        interactive: false,
      });
      row.setLayout(new ICEBoxLayout({ axis: 'x', gap: STATS_GAP }));
      this.root.addChild(row, false);

      stats.forEach((stat) => {
        const width = stat.width || autoWidth;
        const card = new ICEPanel({
          id: `game-stat-${stat.id}`,
          width,
          height: STATS_HEIGHT,
          radius: 10,
          interactive: false,
          style: {
            fillStyle: token('ui.colors.surface'),
            strokeStyle: token('ui.colors.borderSecondary'),
          },
        });
        const labelNode = new ICELabel({
          interactive: false,
          left: 14,
          top: 11,
          width: width - 28,
          text: stat.label,
          style: { fontSize: 12, fillStyle: token('ui.colors.textTertiary') },
        });
        const valueNode = new ICELabel({
          interactive: false,
          left: 14,
          top: 29,
          width: width - 28,
          text: stat.value || '',
          style: {
            fontSize: 22,
            fontWeight: '700',
            fillStyle: stat.accent || token('ui.colors.text'),
            fontFamily: '"Courier New", monospace',
          },
        });
        card.addChild(labelNode, false);
        card.addChild(valueNode, false);
        row.addChild(card, false);
        this.statNodes.set(stat.id, valueNode);
      });
    }

    /* ------------------------- 按钮行 + 操作说明 ------------------------- */

    const actions = options.actions || [];
    if (actions.length || options.sound) {
      const actionRow = new ICEWidget({
        id: 'game-shell-actions',
        left: stage.left,
        top: actionsTop,
        width: stage.width,
        height: ACTION_HEIGHT,
        fill: false,
        stroke: false,
        interactive: false,
      });
      actionRow.setLayout(new ICEBoxLayout({ axis: 'x', gap: 10 }));
      this.root.addChild(actionRow, false);

      actions.forEach((action) => {
        const button = new ICEButton({
          id: `game-action-${action.id}`,
          width: 120,
          height: ACTION_HEIGHT,
          variant: action.variant || 'default',
          text: action.text,
        });
        button.on('click', action.onClick);
        actionRow.addChild(button, false);
      });

      // 音效开关排在最后：它自己管自己的文字（点一下就地切换，不等外部回灌）
      if (options.sound) {
        let on = options.sound.on;
        const soundButton = new ICEButton({
          id: 'game-shell-sound',
          width: 120,
          height: ACTION_HEIGHT,
          variant: 'default',
          text: on ? SOUND_ON_LABEL : SOUND_OFF_LABEL,
        });
        soundButton.on('click', () => {
          on = !on;
          soundButton.setText(on ? SOUND_ON_LABEL : SOUND_OFF_LABEL);
          options.sound!.onToggle(on);
        });
        this.soundButton = soundButton;
        actionRow.addChild(soundButton, false);
      }
    }

    if (options.help && options.help.length) {
      // 一项一行：左边按键（等宽字体）右作用 —— 每行两个标签，行容器纵向排。
      const rows = new ICEWidget({
        id: 'game-shell-help',
        left: stage.left,
        top: helpTop,
        width: stage.width,
        height: HELP_ROW_HEIGHT * options.help.length,
        fill: false,
        stroke: false,
        interactive: false,
      });
      rows.setLayout(new ICEBoxLayout({ axis: 'y', gap: 0 }));
      this.root.addChild(rows, false);
      options.help.forEach(([keys, desc]) => {
        const row = new ICEWidget({
          width: stage.width,
          height: HELP_ROW_HEIGHT,
          fill: false,
          stroke: false,
          interactive: false,
        });
        row.setLayout(new ICEBoxLayout({ axis: 'x', gap: 10 }));
        row.addChild(
          new ICELabel({
            interactive: false,
            width: HELP_KEY_WIDTH,
            height: HELP_ROW_HEIGHT,
            text: keys,
            style: { fontSize: 13, fontFamily: '"Courier New", monospace', fillStyle: token('ui.colors.text') },
          }),
          false,
        );
        row.addChild(
          new ICELabel({
            interactive: false,
            width: stage.width - HELP_KEY_WIDTH - 10,
            height: HELP_ROW_HEIGHT,
            text: desc,
            style: { fontSize: 13, fillStyle: token('ui.colors.textSecondary') },
          }),
          false,
        );
        rows.addChild(row, false);
      });
    }

    /*
     * 内容底边 + **各带互不重叠**自检。
     *
     * 画布外的内容会被**静默裁掉**（引擎没有"溢出报错"这种东西），带子之间互相压住更是
     * 连告警都没有 —— 本文件就是因为这个才把纵向布局改成"从 stage 倒推"：
     * 实测 breakout 的数值卡曾压住游戏区 18px，靠人眼看截图才发现。
     *
     * 这里把各带算成矩形两两求交（覆盖层不算：它**设计上**就盖住游戏区），
     * 发现重叠就**抛错**并指出是哪两条带 —— 布局错乱应该在构造期就结束。
     */
    const helpHeight = options.help && options.help.length ? HELP_ROW_HEIGHT * options.help.length : 0;
    const hasActions = actions.length > 0 || Boolean(options.sound);
    const contentBottom = Math.max(
      stage.top + stage.height,
      hasActions ? actionsTop + ACTION_HEIGHT : 0,
      helpHeight ? helpTop + helpHeight : 0,
    );
    this.layout = { titleTop, statsTop, actionsTop, helpTop, contentBottom };

    const bands: { name: string; top: number; bottom: number }[] = [
      { name: '标题带', top: titleTop, bottom: titleTop + titleBlockHeight },
      ...(stats.length ? [{ name: '数值卡行', top: statsTop, bottom: statsTop + STATS_HEIGHT }] : []),
      { name: '游戏区', top: stage.top, bottom: stage.top + stage.height },
      ...(hasActions ? [{ name: '按钮行', top: actionsTop, bottom: actionsTop + ACTION_HEIGHT }] : []),
      ...(helpHeight ? [{ name: '操作说明', top: helpTop, bottom: helpTop + helpHeight }] : []),
    ];
    for (let i = 0; i < bands.length; i += 1) {
      for (let j = i + 1; j < bands.length; j += 1) {
        const a = bands[i];
        const b = bands[j];
        const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlap > 1) {
          throw new Error(
            `[kit/shell] 外壳的「${a.name}」与「${b.name}」重叠 ${overlap}px ` +
              `(a: ${a.top}~${a.bottom}, b: ${b.top}~${b.bottom})。` +
              `\n纵向布局是"从 stage 倒推"的，出现重叠说明 stage 的位置/高度与外壳预算不匹配：` +
              `\n  上方需要 ${MIN_TOP_PAD}+${titleBlockHeight}+${TITLE_GAP_TO_STATS}+${STATS_HEIGHT}+${STATS_GAP_TO_STAGE} ` +
              `= ${MIN_TOP_PAD + titleBlockHeight + TITLE_GAP_TO_STATS + STATS_HEIGHT + STATS_GAP_TO_STAGE}` +
              `（自 stage.top 起算），下方需要 ${ACTIONS_GAP_TO_STAGE}+${ACTION_HEIGHT}+${HELP_GAP_TO_ACTIONS}+${helpHeight}。`,
          );
        }
      }
    }

    if (contentBottom > page.height) {
      throw new Error(
        `[kit/shell] 外壳内容底边 ${contentBottom}px 超出画布高度 ${page.height}px —— ` +
          `最下面那行会被裁掉。调小 stage 的高度/位置，或把 meta.json 的 height 调大。`,
      );
    }

    /* ------------------------------ 覆盖层 ------------------------------ */

    // 覆盖层是最后挂到画布根上的，天然盖在其他节点之上（引擎按添加顺序绘制）
    this.overlayRoot = new ICEWidget({
      id: 'game-overlay',
      left: 0,
      top: 0,
      width: page.width,
      height: page.height,
      fill: false,
      stroke: false,
      interactive: false,
    });
    // 遮罩必须自己铺不透明底色：画布默认透明，不铺底会直接看到下面的游戏画面
    this.overlayRoot.addChild(
      new ICEPanel({
        interactive: false,
        left: 0,
        top: 0,
        width: page.width,
        height: page.height,
        radius: 0,
        style: { fillStyle: 'rgba(4, 6, 10, 0.74)', strokeStyle: 'rgba(0,0,0,0)' },
      }),
      false,
    );

    const cardWidth = 420;
    const cardHeight = 190;
    const card = new ICEPanel({
      id: 'game-overlay-card',
      left: Math.round(stage.left + (stage.width - cardWidth) / 2),
      top: Math.round(stage.top + (stage.height - cardHeight) / 2),
      width: cardWidth,
      height: cardHeight,
      radius: 14,
      interactive: false,
      style: { fillStyle: token('ui.colors.elevated'), strokeStyle: token('ui.colors.border') },
    });
    const glyph = new ICELabel({
      interactive: false,
      left: 0,
      top: 24,
      width: cardWidth,
      align: 'center',
      text: '',
      // 文字用 `link`（primary 是填充色；暗色下当文字只有 2.96:1）
      style: { fontSize: 26, fillStyle: token('ui.colors.link') },
    });
    const title = new ICELabel({
      interactive: false,
      left: 0,
      top: 66,
      width: cardWidth,
      align: 'center',
      text: '',
      style: { fontSize: 24, fontWeight: '700', fillStyle: token('ui.colors.text') },
    });
    const subtitle = new ICELabel({
      interactive: false,
      left: 0,
      top: 104,
      width: cardWidth,
      align: 'center',
      text: '',
      style: { fontSize: 14, fillStyle: token('ui.colors.textSecondary') },
    });
    const hint = new ICELabel({
      interactive: false,
      left: 0,
      top: 140,
      width: cardWidth,
      align: 'center',
      text: '',
      style: { fontSize: 13, fillStyle: token('ui.colors.textTertiary') },
    });
    card.addChild(glyph, false);
    card.addChild(title, false);
    card.addChild(subtitle, false);
    card.addChild(hint, false);
    this.overlayNodes = { glyph, title, subtitle, hint };
    this.overlayRoot.addChild(card, false);
    this.overlayRoot.setState({ display: false });
    page.ice.addChild(this.overlayRoot);
  }

  /** 更新数值卡。`id` 不存在时静默忽略（状态机分支里少写判断）。 */
  setStat(id: string, value: string | number): this {
    const node = this.statNodes.get(id);
    if (node) node.setText(String(value));
    return this;
  }

  /** 读回数值卡当前文字（e2e 断言用）。 */
  getStat(id: string): string {
    const node = this.statNodes.get(id);
    if (!node) return '';
    if (typeof node.getText === 'function') return String(node.getText());
    return String((node.state && node.state.text) || '');
  }

  /** 右上角状态文字。 */
  setStatus(text: string): this {
    this.statusNode.setText(text);
    return this;
  }

  /** 当前覆盖层种类（无覆盖层时为 `null`）。 */
  get overlay(): OverlaySpec['kind'] | null {
    return this.overlayKind;
  }

  /** 显示覆盖层（暂停 / 结束 / 胜利 / 就绪）。 */
  showOverlay(spec: OverlaySpec): this {
    const style = OVERLAY_STYLE[spec.kind];
    this.overlayKind = spec.kind;
    this.overlayNodes.glyph.setText(style.glyph);
    this.overlayNodes.glyph.setState({
      style: { ...this.overlayNodes.glyph.state.style, fillStyle: style.accent },
    });
    this.overlayNodes.title.setText(spec.title);
    this.overlayNodes.subtitle.setText(spec.subtitle || '');
    this.overlayNodes.hint.setText(spec.hint || '');
    this.overlayRoot.setState({ display: true });
    this.page.ice.requestRepaint();
    return this;
  }

  /** 隐藏覆盖层。 */
  hideOverlay(): this {
    this.overlayKind = null;
    this.overlayRoot.setState({ display: false });
    this.page.ice.requestRepaint();
    return this;
  }

  /** 外部切换了音效时同步按钮显示（比如快捷键静音）。 */
  setSoundLabel(on: boolean): this {
    if (this.soundButton) this.soundButton.setText(on ? '音效 开' : '音效 关');
    return this;
  }
}
