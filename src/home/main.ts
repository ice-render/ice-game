/**
 * 游戏厅首页 —— 本工程唯一"自己写的非游戏页面"。
 *
 * 版面自上而下：**吸顶导航**（独立画布 `#navbar`）→ hero（品牌 + 规模卡）→
 * **精选展厅**（`ICECarousel`，大幅封面自动轮播）→ 分组卡片网格 → 页脚（家族仓库链接）。
 * 背后还有一层**动态效果画布**（`#bg`，见 `effects-canvas.ts`）：光斑 + 粒子星座 + 呼吸。
 *
 * ## 这一版的定位：**整页由 ICE 家族组件搭出来**
 *
 * 上一版是一堆 `ICEPanel` + `ICELabel` 手工拼的几何图形。现在换成家族组件：
 *
 * | 位置 | 用的组件 |
 * |---|---|
 * | hero 规模数字 | `ICEStatCard`（图标 + 标题 + 数值 + 趋势，自带自持布局策略） |
 * | hero 右侧技术栈 | `ICETag`（`variant: 'soft'`） |
 * | 精选展厅 | `ICECarousel`（自动播放 + 箭头 + 圆点） |
 * | 卡片本体 | `ICECard`（`title` 与 `extra` 两个插槽） |
 * | 卡片类型徽标 | `ICEBadge`（放在 `ICECard` 的 `extra` 插槽里） |
 * | 卡片内含物 chip | `ICETag` |
 * | 卡片/轮播按钮 | `ICEButton` |
 * | 分组标题图标 | `ICEIcon` |
 * | 所有分隔线 | `ICESeparator` |
 * | 封面覆盖率 | `ICEProgressBar`（页脚） |
 *
 * 换来的不只是"少写代码"，而是这些控件自带的**语义**：徽标会做 `count > 99` 截断，
 * 标签有 hover 提亮，按钮有 primary/default/text 三态与焦点环，分隔线跟着主题走。
 * 手搭的版本这些都要自己实现（而且一定只实现一部分）。
 *
 * ## 两条必须遵守的顺序
 *
 * ① **画布高度必须在创建引擎之前写进 `<canvas>` 属性** —— 引擎初始化时读的就是这个尺寸。
 *    所以版面是**纯函数** `layoutHome()`：`measureCanvasHeight` 与渲染共用同一份坐标，
 *    不存在"预留高度与渲染坐标算得不一样 → 页脚被画布底边静默裁掉"这种事。
 * ② **组件必须在 `new GamePage()` 之后创建** —— 它们都在构造期读 `iceUIManager.getTheme()`，
 *    早于主题注册就会拿到浅色主题（白底白字，且不报任何错）。
 *
 * ## 圆角是烘在 PNG 里的
 *
 * 引擎的 `ICEImage` 不支持圆角裁剪（`clipType` 只有 `circle`），所以封面圆角只能在生成时
 * 用离屏画布的 `clip()` 裁好（`npm run covers`）。
 */
import { ICEImage } from 'ice-render';
import {
  ICEBadge,
  ICEButton,
  ICECard,
  ICECarousel,
  ICEIcon,
  ICELabel,
  ICEPanel,
  ICEProgressBar,
  ICESeparator,
  ICEStatCard,
  ICETag,
} from 'ice-web-components';
import { GROUPS, PAGES, coverUrl, pagesMissingCover, stats, type CatalogPage, type PageKind } from '../domain/catalog';
import { GamePage } from '../kit';
import { brandBadge, fitControlWidth, measureTextWidth } from './chrome';
import { mountEffects, type EffectsLayer } from './effects-canvas';
import { buildFooter, measureFooterHeight, CANVAS_CONTENT_WIDTH } from './footer';
import { mountNavbar, NAVBAR, type NavbarHandle } from './navbar';

/* ================================ 纯布局 ================================ */

interface SectionHeader {
  kind: PageKind;
  label: string;
  blurb: string;
  headerTop: number;
  gridTop: number;
  rows: number;
}

interface HomeLayout {
  height: number;
  heroSeparatorTop: number;
  statsTop: number;
  statsHeight: number;
  statWidth: number;
  featured: { headerTop: number; carouselTop: number; carouselHeight: number; slides: CatalogPage[] } | null;
  sections: SectionHeader[];
  noteTop: number;
  footerTop: number;
  footerHeight: number;
}

/* ================================= 卡片 ================================= */

interface CardNodes {
  card: any;
  button: any;
  /** 悬停时高亮的外框（平时隐藏，鼠标上来才显示）。 */
  frame: any;
  /** 类型徽标（挂在 `ICECard` 的 `extra` 插槽里）。 */
  badge: any;
  /** 封面节点（没封面时为 `null`）。 */
  cover: any;
}

/** 游戏厅首页（一页一个类；装配流程见构造期，纯常量见 static 字段）。 */
class HomePage extends GamePage {

/** 导航栏高度（引用 `navbar.ts` 的常量，避免两处各写一个数）。 */
  private static readonly NAVBAR_HEIGHT = NAVBAR.height;


/* ================================ 版面常量 ================================ */

  private static readonly CANVAS_WIDTH = 1180;

  private static readonly PAD = 44;

  private static readonly CONTENT_WIDTH = HomePage.CANVAS_WIDTH - HomePage.PAD * 2;

  private static readonly COLS = 3;

  private static readonly GAP = 22;


  private static readonly CARD_WIDTH = Math.floor((HomePage.CONTENT_WIDTH - HomePage.GAP * (HomePage.COLS - 1)) / HomePage.COLS);

  private static readonly CARD_RADIUS = 14;

/** 封面按 16:9 显示（生成时也是 16:9，所以绘制不会拉伸变形）。 */
  private static readonly COVER_INSET = 14;

  private static readonly COVER_WIDTH = HomePage.CARD_WIDTH - HomePage.COVER_INSET * 2;

  private static readonly COVER_HEIGHT = Math.round((HomePage.COVER_WIDTH * 9) / 16);


/**
 * 卡片内各行的纵向偏移：全部由封面高度推出。
 *
 * 这样改封面尺寸时下面几行跟着走，不会出现"改了封面高、标题压在封面上"。
 * `title` 是 `ICECard` 的 `paddingTop` —— 标题节点由 `ICECard` 自己创建，
 * 我们只能通过这个参数告诉它放在哪（而不是自己去改它的节点）。
 */
  private static readonly CARD_ROW = {
    cover: HomePage.COVER_INSET,
    title: HomePage.COVER_INSET + HomePage.COVER_HEIGHT + 8,
    tagline: HomePage.COVER_INSET + HomePage.COVER_HEIGHT + 38,
    tags: HomePage.COVER_INSET + HomePage.COVER_HEIGHT + 64,
    actions: HomePage.COVER_INSET + HomePage.COVER_HEIGHT + 96,
  };

  private static readonly CARD_TAG_HEIGHT = 22;

  private static readonly CARD_BUTTON = { width: 112, height: 38 };

  private static readonly CARD_HEIGHT = HomePage.CARD_ROW.actions + HomePage.CARD_BUTTON.height + 15;


/** hero：品牌徽标 + 标题 + 右侧技术栈，下面一排规模卡。 */
  private static readonly HERO = {
    top: HomePage.PAD,
    badgeSize: 46,
    /** 规模卡顶 / 高（`ICEStatCard` 内部按 72px 的内容块居中，84~96 都好看）。 */
    statsTop: HomePage.PAD + 106,
    statsHeight: 88,
    /** 规模卡与分隔线之间的留白。 */
    separatorGap: 30,
  };

  private static readonly STAT_WIDTH = Math.floor((HomePage.CONTENT_WIDTH - HomePage.GAP * 2) / 3);


/** 精选展厅（`ICECarousel`）与分组标题共用的纵向节奏。 */
  private static readonly FEATURED = {
    height: 320,
    maxSlides: 5,
    /** 幻灯片内文案列的左内边距（箭头与圆点也要与它对齐，所以提到这里共用一份）。 */
    padLeft: 40,
  };

  private static readonly SECTION_HEADER_HEIGHT = 46;

  private static readonly SECTION_GAP = 34;


  private static readonly NOTE_HEIGHT = 22;

/** 最后一段内容 → 页脚分隔线的间距（预留与渲染共用同一个数）。 */
  private static readonly FOOTER_GAP = 26;

/** 最小画布高度：内容少时不至于挤成一条，也不至于留下大片空白。 */
  private static readonly MIN_CANVAS_HEIGHT = 760;


/** 家族控件的文字度量：`ICETag` / `ICEBadge` 内部字号固定为 `theme.font.sizeSmall`。 */
  private static readonly TAG_FONT_SIZE = 12;

  private static readonly TAG_FONT_WEIGHT = '500';

  private static readonly BADGE_FONT_WEIGHT = '600';

/** 类型徽标（整机 / 小游戏）的文案 —— 宽度由它算，别写死。 */
  private static readonly kindBadgeText = (kind: PageKind): string => (kind === 'machine' ? '整机' : '小游戏');


  private static readonly TITLE_LEFT = HomePage.PAD + HomePage.HERO.badgeSize + 18;

  private layout: any;
  private page: any;
  private goto: any;
  private openLinkOutside: any;
  private badgeGradient: any;
  private nodes: any;
  private sectionAnchors: any;
  private carousel: any;
  private missing: any;
  private footer: any;
  private navbar: any;
  private effects: any;

  constructor() {
    super({ continuousFrames: false });

    /*
     * 把导航高度**写进 CSS 变量**。
     *
     * 页面的 `padding-top` 依赖这个值（要给固定的导航留出位置）。早先 CSS 与代码里各写了一个
     * 数字（60 / 64），改了一处就错位 4px —— 而这类错位**肉眼几乎看不出来**，
     * 只会在"内容被导航压住"时以几像素的偏差出现。
     * 所以真相只有一份：代码里的 `NAVBAR.height`，CSS 变量由它写入
     * （HTML 里那个值只是 JS 执行前的兜底）。
     */
    document.documentElement.style.setProperty('--navbar-height', `${HomePage.NAVBAR_HEIGHT}px`);

    this.layout = this.layoutHome();

    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.canvas.width = HomePage.CANVAS_WIDTH;
    this.canvas.height = this.layout.height;
    this.theme = this.theme;
    this.ice = this.ice;

    this.goto = (target: string) => {
      window.location.href = target;
    };

    /**
     * 打开外部链接（新标签页）。
     *
     * 抽成一处而不是各链接自己 `window.open`：`noopener,noreferrer` 这类安全参数只写一遍，
     * 将来要改成"先在站内确认页中转"也只动这里。
     */
    this.openLinkOutside = (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    };

    /* ================================== hero ================================== */

    const { games, machines, features } = stats();

    /*
     * hero 背后的"光晕"：两层很淡的径向渐变（左上主色、右侧青色）。
     *
     * 深色页面最缺的是**层次**：一片纯暗底上放文字，看起来就像"没做完"。
     * 画布里没有 CSS `box-shadow` / `filter`，所以"发光"就是叠一层低透明度的渐变面板。
     *
     * ⚠️ 渐变坐标 = **使用它的那个组件的局部坐标**（引擎的 `createLinearGradient` 是命令式的，
     * 返回原生 `CanvasGradient`，坐标在**绘制时**的坐标系里解释，因此会被组件的世界变换带走）。
     * 这块面板在 (0,0)，所以局部坐标恰好等于画布坐标 —— 换到别处就不能这么写。
     */
    {
      const glowPanel = new ICEPanel({
        id: 'hero-glow',
        interactive: false,
        left: 0,
        top: 0,
        width: HomePage.CANVAS_WIDTH,
        height: this.layout.heroSeparatorTop,
        radius: 0,
        style: { fillStyle: 'rgba(0,0,0,0)', strokeStyle: 'rgba(0,0,0,0)', lineWidth: 0, shadowBlur: 0 },
      });
      this.ice.addChild(glowPanel, false);

      const primaryGlow = this.ice.createRadialGradient(HomePage.PAD + 250, HomePage.PAD + 20, 10, HomePage.PAD + 250, HomePage.PAD + 20, 560);
      primaryGlow.addColorStop(0, 'rgba(13, 110, 253, 0.22)');
      primaryGlow.addColorStop(0.45, 'rgba(13, 110, 253, 0.07)');
      primaryGlow.addColorStop(1, 'rgba(13, 110, 253, 0)');
      glowPanel.addChild(
        new ICEPanel({
          interactive: false,
          left: 0,
          top: 0,
          width: HomePage.CANVAS_WIDTH,
          height: this.layout.heroSeparatorTop,
          radius: 0,
          style: { fillStyle: primaryGlow, strokeStyle: 'rgba(0,0,0,0)', lineWidth: 0, shadowBlur: 0 },
        }),
        false,
      );

      const cyanGlow = this.ice.createRadialGradient(HomePage.CANVAS_WIDTH * 0.82, HomePage.PAD + 60, 10, HomePage.CANVAS_WIDTH * 0.82, HomePage.PAD + 60, 420);
      cyanGlow.addColorStop(0, 'rgba(90, 200, 250, 0.10)');
      cyanGlow.addColorStop(1, 'rgba(90, 200, 250, 0)');
      glowPanel.addChild(
        new ICEPanel({
          interactive: false,
          left: 0,
          top: 0,
          width: HomePage.CANVAS_WIDTH,
          height: this.layout.heroSeparatorTop,
          radius: 0,
          style: { fillStyle: cyanGlow, strokeStyle: 'rgba(0,0,0,0)', lineWidth: 0, shadowBlur: 0 },
        }),
        false,
      );
    }

    /* 品牌徽标：渐变方块 + 播放三角（`brandBadge` 用 `ICEIsogon` 画三角，不依赖字体字形）。 */
    this.badgeGradient = this.ice.createLinearGradient(HomePage.HERO.top, HomePage.HERO.top + 2, HomePage.HERO.top + HomePage.HERO.badgeSize, HomePage.HERO.top + 2 + HomePage.HERO.badgeSize);
    this.badgeGradient.addColorStop(0, '#4d94ff');
    this.badgeGradient.addColorStop(1, '#0b5ed7');
    brandBadge(this.ice, {
      left: HomePage.PAD,
      top: HomePage.HERO.top + 2,
      size: HomePage.HERO.badgeSize,
      accent: this.theme.colors.primary,
      fillStyle: this.badgeGradient,
      glow: true,
    });

    this.ice.addChild(
      new ICELabel({
        interactive: false,
        left: HomePage.TITLE_LEFT,
        top: HomePage.HERO.top,
        width: HomePage.CONTENT_WIDTH - (HomePage.TITLE_LEFT - HomePage.PAD) - 380,
        height: 46,
        verticalAlign: 'middle',
        text: '画布游戏厅',
        style: { fontSize: 34, fontWeight: '700', fillStyle: this.theme.colors.text },
      }),
    );

    /**
     * 副标题里点明"整页由家族组件驱动" —— 这正是这一版想让人看到的东西。
     */
    this.ice.addChild(
      new ICELabel({
        interactive: false,
        left: HomePage.TITLE_LEFT,
        top: HomePage.HERO.top + 48,
        width: HomePage.CONTENT_WIDTH - (HomePage.TITLE_LEFT - HomePage.PAD) - 380,
        height: 24,
        verticalAlign: 'middle',
        text: '入口页本身也是 ICE 组件搭的：统计卡 / 轮播 / 标签 / 徽标 / 按钮 —— 连背景的粒子都在 Canvas 里跑',
        style: { fontSize: 13, fillStyle: this.theme.colors.textSecondary },
      }),
    );

    /* 右侧：这一页用了家族里哪几个包（`ICETag` 的 soft 变体，跟着主题走）。 */
    {
      const stack: [string, any][] = [
        ['ice-render', 'primary'],
        ['ice-web-components', 'success'],
        ['ice-chart', 'warning'],
      ];
      let right = HomePage.PAD + HomePage.CONTENT_WIDTH;
      // 从右往左摆，右端对齐 —— 标签宽度是**真实测量**出来的，加长标签不用改坐标也不会截断
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        const [text, status] = stack[i];
        const size = this.tagSize(text);
        right -= size.width;
        this.ice.addChild(
          new ICETag({
            interactive: false,
            left: right,
            top: HomePage.HERO.top + 12,
            width: size.width,
            height: size.height,
            text,
            status,
            variant: 'soft',
          }),
          false,
        );
        right -= 8;
      }
    }

    /* hero 规模卡：`ICEStatCard`（图标 + 标题 + 数值 + 趋势），三列等分。 */
    {
      const cards: { id: string; icon: string; iconColor: string; iconBg: string; title: string; value: number; trend: string }[] = [
        {
          id: 'stat-games',
          icon: '▶',
          iconColor: '#5ac8fa',
          iconBg: 'rgba(13, 110, 253, 0.16)',
          title: '小游戏',
          value: games,
          trend: '每个页面一个游戏',
        },
        {
          id: 'stat-machines',
          icon: '■',
          iconColor: '#a370f7',
          iconBg: 'rgba(163, 112, 247, 0.16)',
          title: '整机展厅',
          value: machines,
          trend: '从上游示例移植',
        },
        {
          id: 'stat-features',
          icon: '★',
          iconColor: '#20c997',
          iconBg: 'rgba(32, 201, 151, 0.16)',
          title: '可玩内容',
          value: features,
          trend: '掌机卡带 + 桌面程序',
        },
      ];

      cards.forEach((card, index) => {
        this.ice.addChild(
          new ICEStatCard({
            id: card.id,
            // 规模卡不是交互目标：不设 false 的话，鼠标划过会把 hover 从卡片/导航那里抢走
            interactive: false,
            left: HomePage.PAD + index * (this.layout.statWidth + HomePage.GAP),
            top: this.layout.statsTop,
            width: this.layout.statWidth,
            height: this.layout.statsHeight,
            icon: card.icon,
            iconColor: card.iconColor,
            iconBg: card.iconBg,
            title: card.title,
            value: card.value,
            trend: card.trend,
            trendType: 'info',
            style: { fillStyle: this.theme.colors.surface, strokeStyle: this.theme.colors.border, shadowBlur: 0 },
          }),
        );
      });
    }

    /* hero 与正文之间的分隔线。 */
    this.trailLine(HomePage.PAD, this.layout.heroSeparatorTop);

    this.nodes = {};

    /* ============================== 铺整页 ============================== */

    /**
     * 各分组的纵向位置（页面画布坐标）—— 吸顶导航的锚点链接要滚到这里。
     * 直接复用 `layoutHome()` 算好的坐标，不重新累计一遍。
     */
    this.sectionAnchors = this.layout.sections.map((section) => ({
      key: section.kind,
      label: section.label,
      canvasY: section.headerTop,
    }));

    this.carousel = this.layout.featured ? this.buildFeatured(this.layout.featured) : null;

    this.layout.sections.forEach((section, index) => {
      const group = GROUPS[index];
      this.buildSectionHeader({
        icon: section.kind === 'game' ? '▶' : '■',
        iconColor: section.kind === 'game' ? this.theme.colors.primary : '#a370f7',
        label: section.label,
        blurb: `${section.blurb}　·　${group.items.length} 个`,
        top: section.headerTop,
      });

      group.items.forEach((game, itemIndex) => {
        const col = itemIndex % HomePage.COLS;
        const row = Math.floor(itemIndex / HomePage.COLS);
        this.nodes[game.slug] = this.buildCard(game, HomePage.PAD + col * (HomePage.CARD_WIDTH + HomePage.GAP), section.gridTop + row * (HomePage.CARD_HEIGHT + HomePage.GAP));
      });
    });

    /** 底部提示：缺封面时直接点名（这是"该跑 covers 了"的唯一提醒处）。 */
    this.missing = pagesMissingCover();
    this.ice.addChild(
      new ICELabel({
        interactive: false,
        left: HomePage.PAD,
        top: this.layout.noteTop,
        width: HomePage.CONTENT_WIDTH,
        height: HomePage.NOTE_HEIGHT,
        verticalAlign: 'middle',
        text:
          this.missing.length > 0
            ? `有 ${this.missing.length} 个页面还没抓封面（${this.missing.join('、')}）—— 跑 npm run covers`
            : '每个页面各自独占整屏与键盘：进去之后按浏览器「后退」回到这里',
        style: { fontSize: 12, fillStyle: this.theme.colors.textTertiary },
      }),
    );

    /* --------------------------------- 页脚 --------------------------------- */

    this.footer = buildFooter({
      page: this,
      left: HomePage.PAD,
      top: this.layout.footerTop,
      width: HomePage.CONTENT_WIDTH,
      openLink: this.openLinkOutside,
      // 封面覆盖率：加了游戏忘了跑 `npm run covers` 时，这根进度条一眼就能看出来
      coverProgress: { done: PAGES.length - this.missing.length, total: PAGES.length },
    });

    /**
     * 自检：页脚必须落在画布内。
     *
     * 预留值是 `layout.footerTop + layout.footerHeight`（与 `layoutHome()` 同一份坐标），
     * 而 `canvas.height` 也是从它算出来的，所以**正常情况下必然够用**。
     * 留着这道断言是为了"将来有人改了页脚布局、却忘了同步度量"时**立刻报错** ——
     * 否则症状是"页脚被画布底边静默裁掉"，只有翻截图才发现。
     */
    {
      const footerBottom = this.layout.footerTop + this.footer.height;
      if (footerBottom > this.canvas.height) {
        throw new Error(
          `首页页脚越出画布：页脚底部 ${footerBottom}px > 画布高 ${this.canvas.height}px。` +
            `检查 this.footer.ts 的 measureFooterHeight() 与 buildFooter() 是否共用同一份布局。`,
        );
      }
      if (this.footer.height !== this.layout.footerHeight) {
        throw new Error(
          `页脚高度与预留不一致：渲染 ${this.footer.height}px vs 预留 ${this.layout.footerHeight}px` +
            `（两者必须共用 measureFooterHeight()）。`,
        );
      }
      /*
       * 跨文件校验：页脚内部有个 `CANVAS_CONTENT_WIDTH` 常量用来做"不传宽度时"的兜底，
       * 而真相是这里的 `CONTENT_WIDTH = CANVAS_WIDTH - PAD * 2`。
       * 两处各写一个数、改了一处忘了另一处的话，页脚列宽会按错的可用空间去分配
       * （症状是右栏文字被裁掉几字）—— 所以这里显式对一次，不一致就报错。
       */
      if (HomePage.CONTENT_WIDTH !== CANVAS_CONTENT_WIDTH) {
        throw new Error(
          `页脚的内容宽度不一致：main.ts 的 ${HomePage.CONTENT_WIDTH}px vs this.footer.ts 默认的 ${CANVAS_CONTENT_WIDTH}px。` +
            `改 HomePage.CANVAS_WIDTH/HomePage.PAD 时请同步 this.footer.ts 的 CANVAS_CONTENT_WIDTH。`,
        );
      }
    }

    /* --------------------------------- 吸顶导航 --------------------------------- */

    /**
     * 导航栏是**独立画布**（`#navbar`，CSS `position: fixed`）—— 详见 `navbar.ts` 顶部的说明。
     *
     * 它需要"页面画布坐标 → 文档坐标"的换算来定位锚点，所以把 `toDocumentY` 交给它，
     * 导航栏自己不去猜页面版面（两者职责分开，改版面不用动导航）。
     */
    this.navbar = mountNavbar({
      sections: this.sectionAnchors,
      toDocumentY: (canvasY) => this.canvas.getBoundingClientRect().top + window.scrollY + canvasY,
      openLink: this.openLinkOutside,
    });

    /* ------------------------------ 动态效果层 ------------------------------ */

    /**
     * 背景效果是**第三块画布**（`#bg`，`position: fixed` 视口大小）。
     *
     * 单独一块的理由见 `effects-canvas.ts`：会动的部分必须与静态内容分开，
     * 否则"让背景动起来"就等于每帧重绘整页 1180×1900 的内容。
     */
    this.effects = mountEffects();

    /**
     * 组装完毕，显式画一帧。
     *
     * ⚠️ 不能删：引擎的 `addChild(component, markDirty)` 里是 `this.dirty = markDirty` ——
     * 传 `false` 不是"不置脏"，而是**把 dirty 赋成 false**，会清掉前面挂卡片时置上的待渲染标记。
     * 引擎又是"空闲停帧"的（dirty 被消费、又没有动画，就停掉 rAF），
     * 于是最后一次挂载之后不会再有帧：画面停在空白，控制台一个错都不报，点击命中也不会建。
     *
     * **三块画布各置一次**：导航栏与效果层都是另一个 ICE 实例，互相不影响。
     */
    this.ice.dirty = true;
    this.navbar.page.ice.dirty = true;
    this.effects.page.ice.dirty = true;

    /**
     * 调试 / e2e 句柄。
     * 给的是**世界坐标**而不是卡片局部坐标 —— e2e 点卡片必须点画布真实位置，
     * 背像素的测试会在换版面时静默失效。
     */
    (window as any).__gameHome = {
      ice: this.ice,
      groups: GROUPS,
      pages: PAGES,
      nodes: this.nodes,
      worldRect: this.worldRect,
      find: this.find,
      goto: this.goto,
      size: { width: HomePage.CANVAS_WIDTH, height: this.canvas.height },
      cardHeight: HomePage.CARD_HEIGHT,
      missingCovers: this.missing,
      /** 版面体检要**点名排除**的 id 前缀（裁剪视口的轮播、kit 的遮罩层）。 */
      auditAllowIdPrefixes: ['featured-'],
      /** 精选展厅（`ICECarousel`）：e2e 拿它验自动播放与切换。 */
      carousel: this.carousel
        ? {
            handle: this.carousel,
            count: this.carousel.getCount(),
            index: () => this.carousel.getIndex(),
            goTo: (index: number) => this.carousel.goTo(index),
            isPlaying: () => this.carousel.isPlaying(),
          }
        : null,
      /** 背景效果层（独立画布 `#bg`）：e2e 断言"粒子真的在动"。 */
      effects: {
        handle: this.effects,
        canvasId: 'bg',
        size: () => this.effects.stats().canvas,
        particles: () => this.effects.stats().particles,
        frames: () => this.effects.stats().frames,
        paused: () => this.effects.stats().paused,
        reducedMotion: () => this.effects.stats().reducedMotion,
      },
      /** 吸顶导航（独立画布）：e2e 拿它断言锚点、外链与高亮。 */
      navbar: {
        handle: this.navbar,
        size: { width: this.navbar.width, height: this.navbar.height },
        /**
         * **有意的画布出血量**（= 导航条的圆角半径）。
         *
         * 背景条故意上移 `radius` 像素，让顶部两个角变成方角（圆角部分被画布裁掉）、
         * 底部保持圆角 —— `ICEPanel` 只支持整体圆角，这是最省事的做法。
         * e2e 的版面体检要按这个数放行这块出血，所以**从页面暴露出来**，
         * 而不是让测试里写死一个 16（改导航圆角时会两边不一致）。
         */
        bleed: NAVBAR.radius,
        links: this.navbar.links,
        sections: this.navbar.sections,
        activeKey: () => this.navbar.activeKey,
        scrollToSection: (key: string) => this.navbar.scrollToSection(key),
        worldRect: (node: any) => this.navbar.page.worldRect(node),
        find: (id: string) => this.navbar.page.find(id),
        /** 把导航项滚到视野里（点它之前要保证它在视口内）。 */
        canvasTop: () => document.getElementById('navbar')!.getBoundingClientRect().top,
      },
      /** 页脚：链接清单供 e2e 断言"都在、地址都对"。 */
      footer: { links: this.footer.links, height: this.footer.height, coverProgress: this.footer.coverProgress },
    };
  }


/** 进精选展厅的页面：**有封面的**（没封面就展示不了，硬上会开天窗）。 */
  featuredSlides(): CatalogPage[] {
    return PAGES.filter((entry) => Boolean(coverUrl(entry))).slice(0, HomePage.FEATURED.maxSlides);
    }


/**
 * 整页的纵向布局（纯函数，**不依赖引擎**）。
 *
 * 之所以要纯函数：画布高度必须在建引擎之前定下来，而"页脚多高"又得问 `footer.ts`
 * 的布局函数。把整页算成一份坐标表，`measureCanvasHeight()` 与渲染各取所需 ——
 * 两者不可能算得不一样（这正是 `footer.ts` 已经用过的套路，这里推广到整页）。
 */
  layoutHome(): HomeLayout {
    const statsTop = HomePage.HERO.statsTop;
    const heroSeparatorTop = statsTop + HomePage.HERO.statsHeight + HomePage.HERO.separatorGap;

    // 第一个分区从分隔线往下 `SECTION_GAP` 开始
    let cursor = heroSeparatorTop + 1 + HomePage.SECTION_GAP;

    const slides = this.featuredSlides();
    let featured: HomeLayout['featured'] = null;
    if (slides.length >= 2) {
      const headerTop = cursor;
      const carouselTop = headerTop + HomePage.SECTION_HEADER_HEIGHT;
      featured = { headerTop, carouselTop, carouselHeight: HomePage.FEATURED.height, slides };
      cursor = carouselTop + featured.carouselHeight + HomePage.SECTION_GAP;
    }

    const sections: SectionHeader[] = GROUPS.map((group) => {
      const headerTop = cursor;
      const gridTop = headerTop + HomePage.SECTION_HEADER_HEIGHT;
      const rows = Math.ceil(group.items.length / HomePage.COLS);
      cursor = gridTop + rows * HomePage.CARD_HEIGHT + (rows - 1) * HomePage.GAP + HomePage.SECTION_GAP;
      return { kind: group.kind, label: group.label, blurb: group.blurb, headerTop, gridTop, rows };
    });

    const noteTop = cursor;
    const footerTop = noteTop + HomePage.NOTE_HEIGHT + HomePage.FOOTER_GAP;
    const footerHeight = measureFooterHeight(HomePage.CONTENT_WIDTH);

    return {
      height: Math.max(HomePage.MIN_CANVAS_HEIGHT, footerTop + footerHeight + HomePage.PAD),
      heroSeparatorTop,
      statsTop,
      statsHeight: HomePage.HERO.statsHeight,
      statWidth: HomePage.STAT_WIDTH,
      featured,
      sections,
      noteTop,
      footerTop,
      footerHeight,
    };
    }


/* ------------------------------- 小工具 ------------------------------- */

/**
 * 把 `#rrggbb` 调亮/调暗（`amount` 为负则变暗）。
 *
 * 用途：按钮用"主色 → 略暗主色"的渐变比纯色更有体积感，而各游戏的主色是数据里给的，
 * 得能在运行期派生出第二个色 —— 手写死一组颜色就失去"加了游戏自动适配"的意义。
 * 只处理 `#rrggbb`（数据层已保证是这个格式）；其它形式原样返回。
 */
  shade(hex: string, amount: number): string {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const num = parseInt(m[1], 16);
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    const r = clamp(((num >> 16) & 0xff) * (1 + amount));
    const g = clamp(((num >> 8) & 0xff) * (1 + amount));
    const b = clamp((num & 0xff) * (1 + amount));
    return `rgb(${r}, ${g}, ${b})`;
    }


/** 一条横向标签的尺寸（`ICETag` 的默认高度是 24，这里压到 22 让卡片更紧凑）。 */
  tagSize(text: string): { width: number; height: number } {
    return { width: fitControlWidth(text, HomePage.TAG_FONT_SIZE, HomePage.TAG_FONT_WEIGHT), height: HomePage.CARD_TAG_HEIGHT };
    }


/** 类型徽标尺寸（`ICEBadge` 的 `variant: 'soft'`）。 */
  badgeSizeFor(text: string): { width: number; height: number } {
    return { width: fitControlWidth(text, HomePage.TAG_FONT_SIZE, HomePage.BADGE_FONT_WEIGHT), height: 22 };
    }


/**
 * 一条横贯到右边缘的分隔线（分组标题右侧的那条"尾巴"）。
 *
 * ⚠️ `ICESeparator` 的**线宽取自 props.width/height**（它内部那个 `ICERect` 跟着走），
 * 所以横线要显式给 `height: 1`，否则它会按默认的 1×1 变成一个小点。
 *
 * 线色**不能**用 `style` 覆盖：`ICESeparator` 内部把 `theme.colors.border` 写死在子节点上
 * （这是它的设计 —— 分隔线只该跟着主题走）。所以这里不传颜色，免得留下一个不生效的参数。
 */
  trailLine(left: number, top: number): any {
    return this.ice.addChild(
      new ICESeparator({
        interactive: false,
        left,
        top,
        width: Math.max(0, HomePage.PAD + HomePage.CONTENT_WIDTH - left),
        height: 1,
      }),
    );
    }


/* ============================== 分区标题 ============================== */

/**
 * 分区标题：`ICEIcon` + 标题 + 说明 + 一条贯到右边缘的细线。
 *
 * 细线用 `ICESeparator`（而不是自己画 `ICEPanel`）：它跟着主题的 `colors.border` 走，
 * 换主题时不会漏掉这一处。
 */
  buildSectionHeader(options: {
    icon: string;
    iconColor: string;
    label: string;
    blurb: string;
    top: number;
    }): void {
    const { icon, iconColor, label, blurb, top } = options;
    const iconSize = 18;

    this.ice.addChild(
      new ICEIcon({
        interactive: false,
        left: HomePage.PAD,
        top: top + Math.round((HomePage.SECTION_HEADER_HEIGHT - iconSize) / 2),
        size: iconSize,
        icon,
        color: iconColor,
      }),
    );

    const labelLeft = HomePage.PAD + iconSize + 12;
    // 分组标题的宽度按真实字宽给（`fontWeight: '700'` 会略微变宽，测量时要一致）
    const labelWidth = measureTextWidth(label, 18, '700');
    this.ice.addChild(
      new ICELabel({
        interactive: false,
        left: labelLeft,
        top,
        width: labelWidth + 8,
        height: HomePage.SECTION_HEADER_HEIGHT,
        verticalAlign: 'middle',
        text: label,
        style: { fontSize: 18, fontWeight: '700', fillStyle: this.theme.colors.text },
      }),
    );

    const blurbLeft = labelLeft + labelWidth + 18;
    this.ice.addChild(
      new ICELabel({
        interactive: false,
        left: blurbLeft,
        top,
        width: Math.max(80, HomePage.PAD + HomePage.CONTENT_WIDTH - blurbLeft - 40),
        height: HomePage.SECTION_HEADER_HEIGHT,
        verticalAlign: 'middle',
        text: blurb,
        style: { fontSize: 12, fillStyle: this.theme.colors.textTertiary },
      }),
    );

    // 说明之后隔一段再起线，线尾到右边缘；Y 取标题块的中线
    const lineLeft = blurbLeft + measureTextWidth(blurb, 12) + 20;
    this.trailLine(lineLeft, top + Math.round(HomePage.SECTION_HEADER_HEIGHT / 2));
    }


/* ============================== 精选展厅 ============================== */

/**
 * 精选展厅 —— `ICECarousel`，大幅封面自动轮播。
 *
 * ## 为什么幻灯片里**一个 id 都不给**
 *
 * 轮播的可视区是 `clipChildren` 的裁剪视口，轨道宽度 = 幻灯片数 × 视口宽 ——
 * 也就是说第 2 张往后的幻灯片在**画布坐标系里本来就落在视口右侧之外**（x > 1180）。
 * 版面体检（`e2e/support.ts` 的 `auditLayout`）会遍历**全部**节点做越界检查，
 * 给它们命名就会报一串"越界"。
 *
 * 所以这一块整体用一个 id 前缀（`featured-`）标记，体检时**点名排除整棵子树**：
 * 裁剪视口里的轨道越出视口是组件的设计，不是版面错乱。
 */
  buildFeatured(spec: NonNullable<HomeLayout['featured']>): ICECarousel {
    const slides = spec.slides.map((game) => this.buildFeaturedSlide(game, spec.carouselHeight));
    this.carousel = new ICECarousel({
      id: 'featured-carousel',
      left: HomePage.PAD,
      top: spec.carouselTop,
      width: HomePage.CONTENT_WIDTH,
      height: spec.carouselHeight,
      slides,
      autoplay: 5200,
      duration: 320,
      arrows: true,
      dots: true,
      loop: true,
    });
    this.ice.addChild(this.carousel);

    /*
     * 箭头与圆点的外观/位置**按自己的版面**摆好。
     *
     * 组件的默认值是"幻灯片铺满视口"那种布局：箭头用浅色底（浅色主题下的合理默认），
     * 圆点排在**视口底部居中**。而这一页的幻灯片是"左文案 + 右封面"：
     *
     *  · 浅色底箭头压在亮色封面上几乎看不见 —— 改成深色半透明药丸；
     *  · 居中的圆点正好落在**封面下半部**（截图里能看到几个小点压在游戏画面上），
     *    所以要挪到左侧文案列的下缘。圆点尺寸是 8×8、间距 10（组件的常量），
     *    这里按同样的节奏重排，不去改组件内部实现。
     *
     * 两个访问器（`getPrevButton` / `getNextButton` / `getDotNode`）都是公开 API，
     * 而且组件内部 `__updateControls()` 只改 `display` 与圆点的 `fillStyle`，
     * 不会把这里设的底色 / 坐标改回去。
     */
    for (const arrow of [this.carousel.getPrevButton(), this.carousel.getNextButton()]) {
      if (arrow) {
        arrow.setState({ style: { ...arrow.state.style, fillStyle: 'rgba(8, 10, 15, 0.66)' } });
      }
    }

    // 圆点距底 24px：正好落在文案列「进入游戏」按钮的下方，不再压到右侧封面
    const DOT = { size: 8, gap: 10, bottom: 22 };
    for (let index = 0; index < this.carousel.getCount(); index += 1) {
      const dot = this.carousel.getDotNode(index);
      if (!dot) continue;
      dot.setState({
        left: HomePage.FEATURED.padLeft + index * (DOT.size + DOT.gap),
        top: spec.carouselHeight - DOT.size - DOT.bottom,
      });
    }

    return this.carousel;
    }


/**
 * 一张幻灯片：左边文案、右边大幅封面。
 *
 * 幻灯片尺寸由 `ICECarousel.__render()` 强制写成"视口宽 × 视口高"，
 * 所以这里的子节点坐标就按那个尺寸算，不用自己管尺寸。
 */
  buildFeaturedSlide(game: CatalogPage, height: number): any {
    const width = HomePage.CONTENT_WIDTH;
    const inset = 14;
    const coverHeight = height - inset * 2;
    const coverWidth = Math.round((coverHeight * 16) / 9);
    const coverLeft = width - inset - coverWidth;

    const slide = new ICEPanel({
      // ⚠️ 有意不给 id：见 buildFeatured 的说明（裁剪视口里第 2 张起会越过画布右边界）
      interactive: false,
      left: 0,
      top: 0,
      width,
      height,
      style: {
        fillStyle: this.theme.colors.surface,
        strokeStyle: 'rgba(0,0,0,0)',
        lineWidth: 0,
        shadowBlur: 0,
      },
    });

    // 主色晕染：铺在封面那一侧，让大图与底色之间有过渡而不是硬切
    const tint = this.ice.createRadialGradient(
      coverLeft + coverWidth * 0.2,
      height * 0.5,
      10,
      coverLeft + coverWidth * 0.2,
      height * 0.5,
      coverWidth * 0.9,
    );
    tint.addColorStop(0, `${game.accent}2e`);
    tint.addColorStop(1, 'rgba(0,0,0,0)');
    slide.addChild(
      new ICEPanel({
        interactive: false,
        left: 0,
        top: 0,
        width,
        height,
        style: { fillStyle: tint, strokeStyle: 'rgba(0,0,0,0)', lineWidth: 0, shadowBlur: 0 },
      }),
      false,
    );

    /* 右侧大幅封面 */
    const cover = coverUrl(game);
    if (cover) {
      slide.addChild(
        new ICEImage({
          interactive: false,
          left: coverLeft,
          top: inset,
          width: coverWidth,
          height: coverHeight,
          src: cover,
        }),
        false,
      );
    }

    /* 左侧文案列 */
    const textLeft = HomePage.FEATURED.padLeft;
    const textColWidth = coverLeft - textLeft - 26;

    const kindText = HomePage.kindBadgeText(game.kind);
    const kindBadge = this.badgeSizeFor(kindText);
    slide.addChild(
      new ICEBadge({
        interactive: false,
        left: textLeft,
        top: 52,
        width: kindBadge.width,
        height: kindBadge.height,
        text: kindText,
        status: game.kind === 'machine' ? 'primary' : 'info',
        variant: 'soft',
      }),
      false,
    );

    // 品牌竖条：亮 accent → 暗 accent 的竖向渐变，与卡片顶沿的 accent 线呼应
    const barGradient = this.ice.createLinearGradient(0, 0, 0, 34);
    barGradient.addColorStop(0, game.accent);
    barGradient.addColorStop(1, this.shade(game.accent, -0.3));
    slide.addChild(
      new ICEPanel({
        interactive: false,
        left: textLeft,
        top: 98,
        width: 4,
        height: 34,
        radius: 2,
        style: { fillStyle: barGradient, strokeStyle: 'rgba(0,0,0,0)', lineWidth: 0, shadowBlur: 0 },
      }),
      false,
    );

    slide.addChild(
      new ICELabel({
        interactive: false,
        left: textLeft + 16,
        top: 94,
        width: textColWidth - 16,
        height: 42,
        verticalAlign: 'middle',
        text: game.title,
        style: { fontSize: 26, fontWeight: '700', fillStyle: this.theme.colors.text },
      }),
      false,
    );

    slide.addChild(
      new ICELabel({
        interactive: false,
        left: textLeft,
        top: 144,
        width: textColWidth,
        height: 22,
        verticalAlign: 'middle',
        text: game.tagline,
        style: { fontSize: 13.5, fillStyle: this.theme.colors.textSecondary },
      }),
      false,
    );

    /* 内含物 / 按键标签：与卡片用同一套取数规则 */
    const chipSource = game.features.length > 0 ? game.features.slice(0, 5) : game.controls.slice(0, 4).map(([keys]) => keys);
    const CHIP_STATUS = ['primary', 'success', 'warning', 'info', 'default'];
    let chipLeft = textLeft;
    for (let i = 0; i < chipSource.length; i += 1) {
      const text = chipSource[i];
      const size = this.tagSize(text);
      if (chipLeft + size.width > textLeft + textColWidth) break;
      slide.addChild(
        new ICETag({
          interactive: false,
          left: chipLeft,
          top: 182,
          width: size.width,
          height: size.height,
          text,
          status: CHIP_STATUS[i % CHIP_STATUS.length],
          variant: 'soft',
        }),
        false,
      );
      chipLeft += size.width + 8;
    }

    /* 「进入」按钮：accent 渐变（比纯色更有"可点"的暗示），文字用白色保证对比度 */
    const btnGradient = this.ice.createLinearGradient(0, 0, 138, 42);
    btnGradient.addColorStop(0, game.accent);
    btnGradient.addColorStop(1, this.shade(game.accent, -0.24));
    const button = new ICEButton({
      interactive: true,
      left: textLeft,
      top: 236,
      width: 138,
      height: 42,
      radius: 10,
      text: '进入游戏',
      style: { fillStyle: btnGradient, strokeStyle: 'rgba(255,255,255,0.24)' },
    });
    button.on('click', () => this.goto(game.page));
    slide.addChild(button, false);

    slide.addChild(
      new ICELabel({
        interactive: false,
        left: textLeft + 152,
        top: 236,
        width: textColWidth - 152,
        height: 42,
        verticalAlign: 'middle',
        text: '占满整屏，键盘独占 —— 按浏览器「后退」回来',
        style: { fontSize: 12, fillStyle: this.theme.colors.textTertiary },
      }),
      false,
    );

    return slide;
    }


/**
 * 悬停时显示的反光层。
 *
 * 画布上没有 CSS 的 `filter: brightness()`，所以"悬停变亮"要自己铺一层。
 * 用**线性渐变 + 低 alpha** 比整体提高亮度更耐看：只提亮一部分，像玻璃反光。
 */
  buildSheen(parent: any, left: number, top: number, width: number, height: number): any {
    const sheen = this.ice.createLinearGradient(0, 0, width, height);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.42, 'rgba(255,255,255,0.10)');
    sheen.addColorStop(0.58, 'rgba(255,255,255,0.14)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    const node = new ICEPanel({
      interactive: false,
      left,
      top,
      width,
      height,
      radius: 10,
      style: { fillStyle: sheen, strokeStyle: 'rgba(0,0,0,0)', lineWidth: 0, shadowBlur: 0 },
    });
    node.setState({ display: false });
    parent.addChild(node, false);
    return node;
    }


/** 没有封面时的占位块：accent 大号首字，看起来是"有意留白"而不是漏了图。 */
  renderCoverPlaceholder(card: any, game: CatalogPage): void {
    card.addChild(
      new ICEPanel({
        interactive: false,
        left: HomePage.COVER_INSET,
        top: HomePage.CARD_ROW.cover,
        width: HomePage.COVER_WIDTH,
        height: HomePage.COVER_HEIGHT,
        radius: 10,
        style: { fillStyle: this.theme.colors.elevated, strokeStyle: this.theme.colors.borderSecondary },
      }),
      false,
    );
    card.addChild(
      new ICELabel({
        interactive: false,
        left: HomePage.COVER_INSET,
        top: HomePage.CARD_ROW.cover + Math.round(HomePage.COVER_HEIGHT / 2) - 30,
        width: HomePage.COVER_WIDTH,
        align: 'center',
        text: game.title.slice(0, 1),
        style: { fontSize: 52, fontWeight: '700', fillStyle: game.accent },
      }),
      false,
    );
    card.addChild(
      new ICELabel({
        interactive: false,
        left: HomePage.COVER_INSET,
        top: HomePage.CARD_ROW.cover + Math.round(HomePage.COVER_HEIGHT / 2) + 32,
        width: HomePage.COVER_WIDTH,
        align: 'center',
        text: '封面待抓取 · npm run covers',
        style: { fontSize: 11, fillStyle: this.theme.colors.textTertiary },
      }),
      false,
    );
    }


/**
 * 构建一张游戏卡。
 *
 * 本体是 `ICECard`（= `ICEPanel` + 标题插槽 + `extra` 插槽 + 卡片级阴影）：
 *
 * - `title` / `paddingTop` / `paddingLeft` → 标题由 `ICECard` 自己创建并放在封面下方；
 * - `extra` → 类型徽标（`ICEBadge`）。**传工厂函数**是官方推荐用法：
 *   直接传现成节点的话，节点是先于卡片创建的，会被卡片底色盖住（组件内部会兜底抬 zIndex，
 *   但工厂函数更干净）；它落在右上角、与标题同一行，宽度由 `ICECard` 算好。
 *
 * ⚠️ `ICECard` 的标题节点默认 `interactive: true`（引擎里 `interactive` 默认就是 true）。
 * 而 `ICEHoverManager` 只把 hover 派发给**最上层**的那个交互节点、**不向祖先冒泡** ——
 * 标题可交互就意味着"鼠标停在标题上时卡片收不到 hoverchange，高亮框不出现"。
 * 所以这里显式把它关掉（`getTitleNode()` 是公开访问器）。
 */
  buildCard(game: CatalogPage, left: number, top: number): CardNodes {
    /*
     * 类型徽标的文案与尺寸在 `ICECard` 构造**之前**算好。
     *
     * 因为 `extra` 是工厂函数，卡片构造期就会调用它并把节点摆到右上角
     * （`setExtra` 读的是 `node.state.width`）—— 那时再算宽度就来不及了，
     * 而给错了宽度会被 `ICEBadge` 内部**静默截断**（"小游戏" 在 56px 里显示成 "小…"）。
     */
    const kindText = HomePage.kindBadgeText(game.kind);
    const kindBadge = this.badgeSizeFor(kindText);

    const card = new ICECard({
      id: `game-card-${game.slug}`,
      left,
      top,
      width: HomePage.CARD_WIDTH,
      height: HomePage.CARD_HEIGHT,
      radius: HomePage.CARD_RADIUS,
      title: game.title,
      paddingLeft: HomePage.COVER_INSET,
      paddingTop: HomePage.CARD_ROW.title,
      style: { fillStyle: this.theme.colors.surface, strokeStyle: this.theme.colors.border },
      extra: () =>
        new ICEBadge({
          interactive: false,
          left: 0,
          top: 0,
          width: kindBadge.width,
          height: kindBadge.height,
          text: kindText,
          status: game.kind === 'machine' ? 'primary' : 'info',
          variant: 'soft',
        }),
    });
    // 整张卡片可点（不只按钮）—— 卡片是最自然的点击目标
    card.on('click', () => this.goto(game.page));
    this.ice.addChild(card);

    const titleNode = card.getTitleNode();
    if (titleNode) {
      titleNode.setState({
        interactive: false,
        style: { ...titleNode.state.style, fontSize: 19, fontWeight: '700' },
      });
    }
    const badge = card.getExtraNode();

    /**
     * 悬停高亮框：与卡片同尺寸叠一层，用该游戏的 accent 色描边，平时 `display: false`。
     *
     * 为什么不直接改卡片自己的描边：卡片是 `ICECard`（`ICEPanel` 的子类），它内部把
     * `stroke` 写死为 `true`，直接改 `strokeStyle` 会让"常态外观"与"悬停外观"耦合在一处；
     * 叠一层专门的高亮框更干净，也让"悬停"只有一个实现点。
     * 事件来自 `ICEHoverManager`（它按 `interactive` + 命中测试派发 `hoverchange`）。
     */
    const frame = new ICEPanel({
      id: `game-hover-${game.slug}`,
      interactive: false,
      left: 0,
      top: 0,
      width: HomePage.CARD_WIDTH,
      height: HomePage.CARD_HEIGHT,
      radius: HomePage.CARD_RADIUS,
      style: { fillStyle: 'rgba(0,0,0,0)', strokeStyle: game.accent, lineWidth: 2 },
    });
    frame.setState({ display: false });
    card.addChild(frame, false);

    /*
     * 卡片顶部一条 accent 渐变小线（与吸顶导航的"霓虹线"呼应）。
     * 两端收窄成透明，看起来像一道高光扫过卡片上沿，而不是给卡片加了个边框。
     */
    const cardTop = this.ice.createLinearGradient(0, 0, HomePage.CARD_WIDTH, 0);
    cardTop.addColorStop(0, 'rgba(0,0,0,0)');
    cardTop.addColorStop(0.2, game.accent);
    cardTop.addColorStop(0.8, game.accent);
    cardTop.addColorStop(1, 'rgba(0,0,0,0)');
    card.addChild(
      new ICEPanel({
        interactive: false,
        left: 0,
        top: 0,
        width: HomePage.CARD_WIDTH,
        height: 2,
        radius: 1,
        style: { fillStyle: cardTop, strokeStyle: 'rgba(0,0,0,0)', lineWidth: 0, shadowBlur: 0 },
      }),
      false,
    );

    /* 封面图：路径稳定（`covers/<slug>.png`），加载完引擎会自己置脏重绘。 */
    const cover = coverUrl(game);
    let coverNode: any = null;
    if (cover) {
      coverNode = new ICEImage({
        id: `game-cover-${game.slug}`,
        interactive: false,
        left: HomePage.COVER_INSET,
        top: HomePage.CARD_ROW.cover,
        width: HomePage.COVER_WIDTH,
        height: HomePage.COVER_HEIGHT,
        src: cover,
      });
      card.addChild(coverNode, false);
    } else {
      this.renderCoverPlaceholder(card, game);
    }

    // 悬停时给封面加一层"反光"，读起来就是"这张卡被选中了"
    const sheen = this.buildSheen(card, HomePage.COVER_INSET, HomePage.CARD_ROW.cover, HomePage.COVER_WIDTH, HomePage.COVER_HEIGHT);

    /**
     * 悬停时显示高亮框与反光。
     *
     * ⚠️ 事件载荷的形状别猜：`ICEWidget.setHovered()` 调的是
     * `this.trigger('hoverchange', null, { hovered })`，而 `trigger(eventName, originalEvent, param)`
     * 会把数据塞进 **`evt.param`** —— 所以 handler 收到的是 `ICEEvent`，要读 `evt.param.hovered`。
     * 直接读 `payload.hovered` 恒为 `undefined`（实测：悬停框永远不显示，且没有任何报错）。
     */
    card.on('hoverchange', (payload: any) => {
      const hovered = Boolean(payload && payload.param && payload.param.hovered);
      frame.setState({ display: hovered });
      sheen.setState({ display: hovered });
      this.ice.dirty = true;
    });

    card.addChild(
      new ICELabel({
        interactive: false,
        left: HomePage.COVER_INSET,
        top: HomePage.CARD_ROW.tagline,
        width: HomePage.COVER_WIDTH,
        height: 18,
        verticalAlign: 'middle',
        text: game.tagline,
        style: { fontSize: 12.5, fillStyle: this.theme.colors.textSecondary },
      }),
      false,
    );

    /* 内含物 / 按键标签（`ICETag`，与精选展厅同一套取数规则）。 */
    const chipSource =
      game.features.length > 0 ? game.features.slice(0, 3) : game.controls.slice(0, 3).map(([keys]) => keys);
    const CHIP_STATUS = ['primary', 'success', 'warning'];
    let chipLeft = HomePage.COVER_INSET;
    const chipLimit = HomePage.CARD_WIDTH - HomePage.COVER_INSET - HomePage.CARD_BUTTON.width - 14;
    for (let i = 0; i < chipSource.length; i += 1) {
      const text = chipSource[i];
      const size = this.tagSize(text);
      if (chipLeft + size.width > chipLimit) break; // 放不下就不再放（宁可少一个标签，也不越界）
      card.addChild(
        new ICETag({
          interactive: false,
          left: chipLeft,
          top: HomePage.CARD_ROW.tags,
          width: size.width,
          height: size.height,
          text,
          status: CHIP_STATUS[i % CHIP_STATUS.length],
          variant: 'soft',
        }),
        false,
      );
      chipLeft += size.width + 6;
    }

    /* 「进入」按钮：accent 渐变，比纯色更有体积感。 */
    const btnLeft = HomePage.CARD_WIDTH - HomePage.COVER_INSET - HomePage.CARD_BUTTON.width;
    const btnGradient = this.ice.createLinearGradient(0, 0, HomePage.CARD_BUTTON.width, HomePage.CARD_BUTTON.height);
    btnGradient.addColorStop(0, game.accent);
    btnGradient.addColorStop(1, this.shade(game.accent, -0.22));
    const button = new ICEButton({
      id: `game-enter-${game.slug}`,
      left: btnLeft,
      top: HomePage.CARD_ROW.actions,
      width: HomePage.CARD_BUTTON.width,
      height: HomePage.CARD_BUTTON.height,
      radius: 9,
      text: '进入',
      style: { fillStyle: btnGradient, strokeStyle: 'rgba(255,255,255,0.22)' },
    });
    // 按钮点击走事件（构造函数不吃 `onClick`；`ICESegmented` 那类才走构造参数）
    button.on('click', () => this.goto(game.page));
    card.addChild(button, false);

    return { card, button, frame, badge, cover: coverNode };
    }

}

new HomePage();