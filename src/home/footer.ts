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
import { ICELabel, ICEPanel } from 'ice-web-components';
import { FAMILY_HOME, FAMILY_REPOS, SELF_REPO, reposInGroup } from '../domain/family-repos';
import { stats } from '../domain/catalog';
import type { GamePageHandle } from '../kit';
import { brandBadge, createLink, textWidth } from './chrome';

/* --------------------------------- 度量常量 --------------------------------- */

/** 页脚内部的纵向节奏：布局函数与渲染共用这几个数（改一处即可）。 */
const M = {
  /** 分隔线到内容顶部的距离。 */
  padTop: 30,
  /** 内容底部到页脚结束的距离。 */
  padBottom: 26,
  /** 左栏宽度（品牌 + 许可）。 */
  brandWidth: 340,
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

/** 纯布局：算每栏每行的坐标与页面底部小字的位置。 */
function layoutFooter() {
  const columns = footerColumns();
  const columnsHeight = Math.max(...columns.map((column) => column.height), M.brandMinHeight);
  const noteTop = M.padTop + columnsHeight + M.noteGap;
  return {
    columns,
    columnsHeight,
    noteTop,
    /** 分隔线到页脚内容底部的总高（即调用方需要预留的高度）。 */
    height: noteTop + M.noteHeight + M.padBottom,
  };
}

/** 页脚需要的高度（纯函数，**不依赖引擎** —— 首页先用它定画布高度）。 */
export function measureFooterHeight(): number {
  return layoutFooter().height;
}

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
}

export interface FooterHandle {
  /** 页脚占用的总高度（含上方的分隔线）—— 与 `measureFooterHeight()` 必然一致。 */
  height: number;
  /** 所有可点链接 —— e2e 拿它断言"链接都在、地址都对"。 */
  links: FooterLinkRef[];
}

export function buildFooter(options: FooterOptions): FooterHandle {
  const { page, left, top, width } = options;
  const theme = page.theme;
  const openLink = options.openLink || ((url: string) => window.open(url, '_blank', 'noopener,noreferrer'));
  const { columns, noteTop } = layoutFooter();
  const links: FooterLinkRef[] = [];
  const contentTop = top + M.padTop;

  const thinLine = (lineTop: number) =>
    page.ice.addChild(
      new ICEPanel({
        interactive: false,
        left,
        top: lineTop,
        width,
        height: 1,
        radius: 0,
        // 填色与描边同色：`ICEPanel` 内部把 `stroke` 写死为 `true`，
        // 而要"只有一条细线"就得让描边看不出来（`lineWidth: 0` 是非法值会被忽略）。
        style: {
          fillStyle: theme.colors.borderSecondary,
          strokeStyle: theme.colors.borderSecondary,
          shadowBlur: 0,
        },
      }),
    );

  /** 一条不参与交互的小字。 */
  const plainText = (text: string, x: number, y: number, w: number, fontSize: number, color: string) =>
    page.ice.addChild(
      new ICELabel({
        interactive: false,
        left: x,
        top: y,
        width: w,
        text,
        style: { fontSize, fillStyle: color },
      }),
    );

  /* ------------------------------ 顶部分隔线 ------------------------------ */
  thinLine(top);

  /* ------------------------------ 左侧：品牌与许可 ------------------------------ */

  brandBadge(page.ice, { left, top: contentTop, size: M.badgeSize, accent: theme.colors.primary });
  plainText('ICE GAME', left + M.badgeSize + 10, contentTop, M.brandWidth - M.badgeSize - 10, 16, theme.colors.text);
  plainText(
    '画布游戏厅 —— 用 ICE 家族的引擎与控件做的单页小游戏合集',
    left,
    contentTop + M.badgeSize + 14,
    M.brandWidth,
    12.5,
    theme.colors.textSecondary,
  );

  const { games, machines, features } = stats();
  plainText(
    `${games} 个小游戏 · ${machines} 台整机 · ${features} 项可玩 · 无服务端`,
    left,
    contentTop + M.badgeSize + 38,
    M.brandWidth,
    12,
    theme.colors.textTertiary,
  );
  plainText(
    'MIT License · 引擎与控件作者：大漠穷秋',
    left,
    contentTop + M.badgeSize + 60,
    M.brandWidth,
    12,
    theme.colors.textTertiary,
  );

  /* ------------------------------ 右侧：链接分栏 ------------------------------ */

  const colWidth = Math.floor(
    (width - M.brandWidth - M.colGap - M.colGap * (columns.length - 1)) / columns.length,
  );
  const colsLeft = left + M.brandWidth + M.colGap;

  columns.forEach((column, colIndex) => {
    const x = colsLeft + colIndex * (colWidth + M.colGap);
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

  return { height: measureFooterHeight(), links };
}

/** 页脚可能用到的全部外链（e2e 与自检用：断言它们都是 https 且可访问过）。 */
export function footerLinkUrls(): string[] {
  return [
    ...FAMILY_REPOS.map((repo) => repo.url),
    FAMILY_HOME,
    ...(SELF_REPO.url ? [SELF_REPO.url] : []),
  ];
}
