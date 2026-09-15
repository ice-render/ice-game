/**
 * 首页**页脚** —— 画在页面画布的最底部（随内容滚入视野），列出 ICE 家族的仓库链接。
 *
 * 与导航栏的分工：导航栏负责"在本页内走动"，页脚负责"走出去"——
 * 家族各仓、文档站、许可信息。所以这里用**列式列表**（信息密度高、可扫读），
 * 而不是导航那种横向条。
 *
 * 链接地址来自 `src/domain/family-repos.ts`（每个都核实过可访问）；本仓 `ice-game`
 * 还没建 GitHub 远端，所以如实标成"未开源"的纯文本，**不编地址** —— 页脚挂 404 比不挂更糟。
 *
 * ## 为什么"先算布局、再渲染"
 *
 * 页脚要贴在画布底部，所以**必须先知道它有多高**才能定画布高度；
 * 而定画布高度又必须在创建引擎之前（引擎初始化时读的就是 canvas 的宽高）。
 * 于是这里把布局做成**纯函数**（`layoutFooter()` 只算坐标，不碰任何组件），
 * `measureFooterHeight()` 与 `buildFooter()` 共用同一份布局 ——
 * 两者不可能算得不一样，也就不存在"量高少了几个像素、页脚被裁掉"这种事。
 */
import { ICELabel, ICEProgressBar, ICESeparator } from 'ice-web-components';
import { FAMILY_HOME, FAMILY_REPOS, SELF_REPO, reposInGroup } from '../domain/family-repos';
import { stats } from '../domain/catalog';
import type { GamePageHandle } from '../kit';
import { brandBadge, createLink, measureTextWidth, textWidth } from './chrome';

/* --------------------------------- 度量常量 --------------------------------- */

/** 页脚内部的纵向节奏：布局函数与渲染共用这几个数（改一处即可）。 */
const M = {
  /** 分隔线到内容顶部的距离。 */
  padTop: 30,
  /** 内容底部到页脚结束的距离。 */
  padBottom: 26,
  /**
   * 左栏宽度（品牌 + 许可 + 封面覆盖率）。
   *
   * ⚠️ 这个数**必须够放下左栏最长的那行文案**：`ICELabel` 不会自动换行，
   * 超出的部分直接被画布裁掉（实测：340 时 "画布游戏厅 —— 用 ICE 家族的引擎与控件
   * 做的单页小游戏**合集**" 的"合集"两字看不见了，而屏幕上看起来只是"文案短"）。
   * 值是按 `measureTextWidth()` 量出来的（见下方 `brandColumnWidth()`）。
   */
  brandWidth: 380,
  /** 栏间距。 */
  colGap: 28,
  /** 栏标题高度。 */
  colTitle: 26,
  /** 一个链接行高。 */
  rowLink: 22,
  /** 链接下方那行小字的高度。 */
  rowRole: 20,
  /** 条目之间的气口。 */
  rowGap: 8,
  /** 底部小字之前的额外留白。 */
  noteGap: 22,
  /** 底部小字之前的细线到文字的距离。 */
  noteLineGap: 16,
  /** 底部小字行高。 */
  noteHeight: 24,
  /** 左栏最少高度（右栏条目少时，页脚别塌下去）。 */
  brandMinHeight: 150,
  badgeSize: 26,
  /** 左栏底部「封面覆盖率」那一行距左栏内容顶的偏移。 */
  progressTop: 112,
  /** 链接栏压缩时的下限宽度（保证栏不至于被压成一条缝）。 */
  minColWidth: 150,
  /** 进度条高度。 */
  progressBarHeight: 8,
  /** 进度条左侧文字宽度 / 右侧计数宽度。 */
  progressLabelWidth: 76,
  progressCountWidth: 56,
};

export interface FooterLinkRef {
  id: string;
  text: string;
  url: string;
}

/** 一条页脚条目（算好的坐标）。 */
interface FooterRow {
  kind: 'link' | 'plain';
  id?: string;
  text: string;
  role?: string;
  url: string | null;
  /** 行内相对栏顶的偏移。 */
  offsetY: number;
}

interface FooterColumn {
  title: string;
  rows: FooterRow[];
  /** 该栏内容总高（相对 contentTop）。 */
  height: number;
}

/** 栏目定义（顺序 = 显示顺序）。数据来自 `family-repos`，不在这里写地址。 */
function footerColumns(): FooterColumn[] {
  const build = (title: string, items: { id: string; text: string; role?: string; url: string | null }[]): FooterColumn => {
    let offsetY = M.colTitle;
    const rows: FooterRow[] = items.map((item) => {
      const row: FooterRow = {
        kind: item.url ? 'link' : 'plain',
        id: item.id,
        text: item.text,
        role: item.role,
        url: item.url,
        offsetY,
      };
      offsetY += M.rowLink + (item.role ? M.rowRole : 0) + M.rowGap;
      return row;
    });
    return { title, rows, height: offsetY };
  };

  return [
    build(
      '核心库',
      reposInGroup('core').map((repo) => ({ id: `footer-${repo.name}`, text: repo.name, role: repo.role, url: repo.url })),
    ),
    build(
      '应用与文档',
      [...reposInGroup('app'), ...reposInGroup('tooling')].map((repo) => ({
        id: `footer-${repo.name}`,
        text: repo.name,
        role: repo.role,
        url: repo.url,
      })),
    ),
    build('本仓', [
      {
        id: 'footer-self',
        text: SELF_REPO.name,
        role: SELF_REPO.published ? SELF_REPO.role : '本仓：尚未开源（仅本地 git）',
        url: SELF_REPO.url,
      },
      { id: 'footer-family', text: 'ICE 家族主页', role: 'GitHub 上的全部仓库', url: FAMILY_HOME },
    ]),
  ];
}

/**
 * 左栏的几行文案。
 *
 * **渲染与量宽共用这一份** —— 这是本文件的核心约定（`layoutFooter` 与 `buildFooter`
 * 共用同一份布局的同一思路）：如果量宽那边自己写一份文案，改文案时宽度就悄悄不对了。
 *
 * `colorKey` 指向 `theme.colors` 里的键，渲染时再解析成真实色值
 * （量宽不需要颜色，所以这里不持有主题引用）。
 */
function brandLines(): { text: string; top: number; fontSize: number; colorKey: string }[] {
  const { games, machines, features } = stats();
  const base = M.badgeSize + 14;
  return [
    {
      text: '画布游戏厅 —— 用 ICE 家族的引擎与控件做的单页小游戏合集',
      top: base,
      fontSize: 12.5,
      colorKey: 'textSecondary',
    },
    {
      text: `${games} 个小游戏 · ${machines} 台整机 · ${features} 项可玩 · 无服务端`,
      top: base + 24,
      fontSize: 12,
      colorKey: 'textTertiary',
    },
    {
      text: 'MIT License · 引擎与控件作者：大漠穷秋',
      top: base + 46,
      fontSize: 12,
      colorKey: 'textTertiary',
    },
  ];
}

/**
 * 左栏宽度：按左栏最长那行的**真实字宽**算出来。
 *
 * ⚠️ 为什么不能写死：`ICELabel` **不换行**，超出宽度的字会被画布直接裁掉 ——
 * 实测 340px 时"…单页小游戏**合集**"的"合集"两字看不见了，而屏幕上看起来
 * 只是"这句话本来就短"（没有任何报错、也没有省略号）。
 * 按测量值给宽度，改文案就不会悄悄截断。
 *
 * `M.brandWidth` 作为**下限**：文案很短时左栏也不能塌掉（右侧三栏的列宽由它推出）。
 */
function brandColumnWidth(): number {
  const widest = Math.max(...brandLines().map((line) => measureTextWidth(line.text, line.fontSize)));
  return Math.max(M.brandWidth, Math.ceil(widest) + 4);
}

/**
 * 一个链接栏需要的宽度 = 栏里最长的那一行（标题 / 链接名 / 角色说明）的真实字宽。
 *
 * ⚠️ 必须按内容算：`ICELabel` **不换行也不加省略号**，宽度不够就直接被画布裁掉 ——
 * 实测硬性三等分时 `领域设计器（ER / 流程图 / BPMN / 状态机…）` 显示成
 * `…BPMN / 状态`，看起来只像"这句文案本来就短"。
 */
function columnRequiredWidth(column: FooterColumn): number {
  const widths: number[] = [measureTextWidth(column.title, 12)];
  for (const row of column.rows) {
    const text = row.kind === 'link' ? row.text : `${row.text}（未开源）`;
    widths.push(measureTextWidth(text, 13));
    if (row.role) widths.push(measureTextWidth(row.role, 11));
  }
  return Math.ceil(Math.max(...widths)) + 2;
}

/**
 * 各链接栏的宽度与左边缘（相对 `left`）。
 *
 * 每栏先拿"自己需要的宽度"，余量按**比例**摊回去（栏与栏之间不至于挤成一条）。
 *
 * ⚠️ **排不下时不再抛错** —— 早期版本在 `needed > available` 时直接 `throw`，
 * 这个错误会一路冒泡到首页 `build()`，把**整页画布弄成空白**（代价远大于"少几个字"）。
 * 现在改为：**按比例压缩到可用宽度内**，最长的 role 行可能被画布裁掉，但页面照常渲染；
 * 同时用 `console.warn` 暴露出来，便于本地 `verify` / `test:e2e` 时发现，
 * 然后去精简 `family-repos.ts` 的 role 文案或加大 `main.ts` 的 `CANVAS_WIDTH`。
 */
function layoutColumns(available: number): { widths: number[]; lefts: number[] } {
  const columns = footerColumns();
  const required = columns.map(columnRequiredWidth);
  const needed = required.reduce((sum, value) => sum + value, 0);

  let widths: number[];
  if (needed > available) {
    // 版面算不下：压缩而非崩溃（整页空白比裁字严重得多）。
    console.warn(
      `首页页脚略窄：三栏至少需要 ${needed}px，可用只有 ${available}px，` +
        `已按比例压缩（可能裁字）。建议精简 family-repos.ts 的 role 文案，或加大 main.ts 的 CANVAS_WIDTH。`,
    );
    const scale = available / needed;
    widths = required.map((value) => Math.max(M.minColWidth, Math.floor(value * scale)));
  } else {
    const slack = available - needed;
    widths = required.map((value) => value + Math.floor((slack * value) / needed));
  }
  // 取整会剩下几像素，补给最后一栏（否则右侧会露出一小段空白）
  widths[widths.length - 1] += available - widths.reduce((sum, value) => sum + value, 0);

  const lefts: number[] = [];
  let cursor = 0;
  for (const width of widths) {
    lefts.push(cursor);
    cursor += width + M.colGap;
  }
  return { widths, lefts };
}

/** 纯布局：算每栏每行的坐标与页面底部小字的位置。 */
function layoutFooter(width: number) {
  const columns = footerColumns();
  const brandWidth = brandColumnWidth();
  const columnsHeight = Math.max(...columns.map((column) => column.height), M.brandMinHeight);
  // 链接栏的可用宽度 = 总宽 − 左栏 − 「左栏与第一栏的间距」− 栏间距×(栏数−1)
  const available = width - brandWidth - M.colGap - M.colGap * (columns.length - 1);
  const layout = layoutColumns(available);
  const noteTop = M.padTop + columnsHeight + M.noteGap;
  return {
    columns,
    brandWidth,
    colWidths: layout.widths,
    colLefts: layout.lefts,
    columnsHeight,
    noteTop,
    /** 分隔线到页脚内容底部的总高（即调用方需要预留的高度）。 */
    height: noteTop + M.noteHeight + M.padBottom,
  };
}

/**
 * 页脚需要的高度与宽度预算（纯函数，**不依赖引擎** —— 首页先用它定画布高度）。
 *
 * `width` 传页脚的内容总宽（首页给的是 `CANVAS_WIDTH - PAD * 2`）。
 */
export function measureFooterHeight(width = CANVAS_CONTENT_WIDTH): number {
  return layoutFooter(width).height;
}

/**
 * 布局用的默认内容宽度。
 *
 * 与 `main.ts` 的 `CANVAS_WIDTH - PAD * 2` 是同一个数 —— 但这里**不 import main**
 * （会形成循环依赖），所以写成常量并留一道跨文件校验：main.ts 的自检会断言
 * 自己传进去的宽度与它一致，改了一处而忘了另一处会立刻报错。
 */
export const CANVAS_CONTENT_WIDTH = 1180 - 44 * 2;

export interface FooterOptions {
  page: GamePageHandle;
  /** 左边缘（画布坐标）。 */
  left: number;
  /** 上边缘（分隔线所在位置，画布坐标）。 */
  top: number;
  /** 内容总宽。 */
  width: number;
  /** 打开外链（默认新标签页；测试可注入以便断言）。 */
  openLink?: (url: string) => void;
  /**
   * 左栏底部的「封面覆盖率」进度条（`ICEProgressBar`）。
   *
   * 这不是装饰：本仓的卡片封面是 `npm run covers` **自动抓取**的产物，
   * 加了一个游戏却忘了跑那个脚本时，界面上原本只有首页底部一行小字会提。
   * 一根进度条把这件事变成一眼可见的状态（未满 = 红，满 = 绿）。
   * 不传就不画 —— 页脚在别的页面复用时不必关心封面。
   */
  coverProgress?: { done: number; total: number };
}

export interface FooterHandle {
  /** 页脚占用的总高度（含上方的分隔线）—— 与 `measureFooterHeight()` 必然一致。 */
  height: number;
  /** 所有可点链接 —— e2e 拿它断言"链接都在、地址都对"。 */
  links: FooterLinkRef[];
  /** 封面覆盖率进度条的状态（没画则 `null`）。 */
  coverProgress: { done: number; total: number } | null;
}

export function buildFooter(options: FooterOptions): FooterHandle {
  const { page, left, top, width } = options;
  const theme = page.theme;
  const openLink = options.openLink || ((url: string) => window.open(url, '_blank', 'noopener,noreferrer'));
  const { columns, noteTop, brandWidth, colWidths, colLefts } = layoutFooter(width);
  const links: FooterLinkRef[] = [];
  const contentTop = top + M.padTop;

  /**
   * 一条通栏细线。
   *
   * 用 `ICESeparator`（而不是自己拼一个 1px 的 `ICEPanel`）：它只有"一条线"这一个语义，
   * 颜色跟着主题的 `colors.border` 走，将来换主题不会漏掉页脚这两根线。
   */
  const thinLine = (lineTop: number) =>
    page.ice.addChild(
      new ICESeparator({
        interactive: false,
        left,
        top: lineTop,
        width,
        height: 1,
      }),
    );

  /** 一条不参与交互的小字（`extra` 可覆盖对齐等属性）。 */
  const plainText = (
    text: string,
    x: number,
    y: number,
    w: number,
    fontSize: number,
    color: string,
    extra: { align?: 'left' | 'center' | 'right' } = {},
  ) =>
    page.ice.addChild(
      new ICELabel({
        interactive: false,
        left: x,
        top: y,
        width: w,
        text,
        style: { fontSize, fillStyle: color },
        ...extra,
      }),
    );

  /* ------------------------------ 顶部分隔线 ------------------------------ */
  thinLine(top);

  /* ------------------------------ 左侧：品牌与许可 ------------------------------ */

  brandBadge(page.ice, { left, top: contentTop, size: M.badgeSize, accent: theme.colors.primary });
  plainText('ICE GAME', left + M.badgeSize + 10, contentTop, brandWidth - M.badgeSize - 10, 16, theme.colors.text);
  // 左栏的说明文字来自 `brandLines()` —— 与量宽用的是同一份文案（否则改文案就悄悄截断）
  for (const line of brandLines()) {
    plainText(line.text, left, contentTop + line.top, brandWidth, line.fontSize, theme.colors[line.colorKey]);
  }

  /* 封面覆盖率：加了游戏却忘了跑 `npm run covers` 时，这里一眼看得出来。 */
  let coverProgress: FooterHandle['coverProgress'] = null;
  if (options.coverProgress && options.coverProgress.total > 0) {
    const { done, total } = options.coverProgress;
    coverProgress = { done, total };
    const progressTop = contentTop + M.progressTop;
    plainText('封面覆盖率', left, progressTop - 2, M.progressLabelWidth, 11, theme.colors.textTertiary);
    const barLeft = left + M.progressLabelWidth;
    const barWidth = Math.max(40, brandWidth - M.progressLabelWidth - M.progressCountWidth);
    page.ice.addChild(
      new ICEProgressBar({
        id: 'footer-cover-progress',
        interactive: false,
        left: barLeft,
        top: progressTop + 2,
        width: barWidth,
        height: M.progressBarHeight,
        value: done,
        min: 0,
        max: total,
        // 满 = 成功色（这件事完成了）；没满 = 错误色，因为"缺封面"是需要动作的状态
        status: done >= total ? 'success' : 'error',
      }),
    );
    plainText(
      `${done} / ${total}`,
      left + brandWidth - M.progressCountWidth,
      progressTop - 2,
      M.progressCountWidth,
      11,
      done >= total ? theme.colors.success : theme.colors.error,
      { align: 'right' },
    );
  }

  /* ------------------------------ 右侧：链接分栏 ------------------------------ */

  // 列宽与左边缘都来自 `layoutFooter()`（按内容算的），这里只管把内容填进去
  const colsLeft = left + brandWidth + M.colGap;

  columns.forEach((column, colIndex) => {
    const x = colsLeft + colLefts[colIndex];
    const colWidth = colWidths[colIndex];
    plainText(column.title, x, contentTop, colWidth, 12, theme.colors.textTertiary);

    for (const row of column.rows) {
      const y = contentTop + row.offsetY;
      if (row.kind === 'link' && row.url) {
        createLink(page.ice, page, {
          id: row.id as string,
          left: x,
          top: y,
          width: colWidth,
          height: M.rowLink,
          text: row.text,
          fontSize: 13,
          paddingX: 0,
          align: 'left',
          accent: theme.colors.primary,
          onClick: () => openLink(row.url as string),
        });
        links.push({ id: row.id as string, text: row.text, url: row.url });
      } else {
        // 没有地址 → 如实渲染成纯文本（不编链接），一眼看得出"待发布"
        plainText(`${row.text}（未开源）`, x, y, colWidth, 13, theme.colors.textSecondary);
      }
      if (row.role) {
        plainText(row.role, x, y + M.rowLink, colWidth, 11, theme.colors.textTertiary);
      }
    }
  });

  /* ------------------------------- 底部小字 ------------------------------- */

  const noteY = top + noteTop;
  thinLine(noteY - M.noteLineGap);
  const rightText = 'github.com/ice-render';
  const rightWidth = textWidth(rightText, 12) + 20;
  plainText(
    '由 ice-render 引擎驱动 · 画面里没有一个位图资源（卡片封面是按真实画面另行生成的）',
    left,
    noteY,
    width - rightWidth - 20,
    12,
    theme.colors.textTertiary,
  );
  page.ice.addChild(
    new ICELabel({
      interactive: false,
      left: left + width - rightWidth,
      top: noteY,
      width: rightWidth,
      align: 'right',
      text: rightText,
      style: { fontSize: 12, fillStyle: theme.colors.textTertiary },
    }),
  );

  return { height: measureFooterHeight(width), links, coverProgress };
}

/** 页脚可能用到的全部外链（e2e 与自检用：断言它们都是 https 且可访问过）。 */
export function footerLinkUrls(): string[] {
  return [
    ...FAMILY_REPOS.map((repo) => repo.url),
    FAMILY_HOME,
    ...(SELF_REPO.url ? [SELF_REPO.url] : []),
  ];
}
