/**
 * 应用层写法棘轮（2026-09-17 立）：**一页 = 一个类**。
 *
 * 家族口径（`ice-web-components` 的 `ICEContainer` 契约 + 各仓示例页）：页面的装配脚本里
 * **只应该有一个类**，构造期建好、方法承载刷新与交互；不出现模块级的 `function` / `let`。
 *
 * 本仓对应 `src/games/<slug>/main.ts`（自研游戏页）。`src/home/main.ts` 与 `src/machines/*`
 * 还没迁，先在 `PENDING` 里登记 —— 迁完从这张表里挪走，**新增的游戏一律按新写法**。
 * 上游移植的 `src/ported/*` 是生成物（`sync:upstream` 覆盖），不在本棘轮口径内。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const GAMES_DIR = path.resolve(__dirname, '..', '..', 'src', 'games');

/** 已迁：构造期建好 + 一个类 + 无模块级 function / let。 */
const MIGRATED = new Set(['breakout']);
/** 待迁：登记到此，迁完挪进 MIGRATED。 */
const PENDING = new Set<string>([]);

/** **页面级**待迁：不在 `games/<slug>/` 里，但同样是"一页"的自研文件。当前为空 —— 全迁完了。 */
const PAGE_LEVEL_PENDING = new Set<string>([]);

/**
 * **按政策排除**：这两台整机是从上游示例抽出来的移植脚本（`// @ts-nocheck`）。
 *
 * 2026-09-17 决定：**继续跟上游同形** —— 上游不长成"一页一个类"，它们就不改。
 * 理由：这几页的价值在于"能和上游示例对照"，按本仓的写法改完就再也对不上了；
 * 而 `sync-upstream` 的不变量（抽取-对照）比本仓内部的写法统一更值钱。
 * 这条清单的作用是：谁看到它们不是类，也知道这是**故意的**，不是漏了。
 */
const UPSTREAM_PARITY_EXCLUDED = new Set(['src/machines/arcade/main.ts', 'src/machines/windows-xp/main.ts']);

const gameDirs = fs
  .readdirSync(GAMES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const statsOf = (file: string) => {
  const text = fs.readFileSync(file, 'utf8');
  return {
    // 脚手架模板的类名是占位符 `__NAME__Page`，所以首位允许下划线
    classes: (text.match(/^class [A-Za-z_$]/gm) || []).length,
    topFn: (text.match(/^function /gm) || []).length,
    topLet: (text.match(/^let /gm) || []).length,
    instantiates: /^new [A-Z]\w*\(\);?$/m.test(text),
  };
};

describe('游戏页写法棘轮（一页一个类）', () => {
  it('每个自研游戏都做了决定：已迁 / 待迁二选一（新增游戏别默默写成函数式）', () => {
    const undecided = gameDirs.filter((slug) => !MIGRATED.has(slug) && !PENDING.has(slug));
    expect(undecided).toEqual([]);
  });

  it('已迁的游戏页：恰好一个类、无模块级 function / let、且在文件末尾实例化', () => {
    const bad: string[] = [];
    for (const slug of MIGRATED) {
      const file = path.join(GAMES_DIR, slug, 'main.ts');
      if (!fs.existsSync(file)) continue;
      const s = statsOf(file);
      if (s.classes !== 1 || s.topFn > 0 || s.topLet > 0 || !s.instantiates) {
        bad.push(`${slug}(类${s.classes}/fn${s.topFn}/let${s.topLet}/实例化:${s.instantiates})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('脚手架模板同样是一页一个类（新游戏从第一天就合规）', () => {
    const tpl = path.resolve(__dirname, '..', '..', 'scripts', 'templates', 'game', 'main.ts');
    const s = statsOf(tpl);
    expect({ classes: s.classes, topFn: s.topFn, topLet: s.topLet }).toEqual({ classes: 1, topFn: 0, topLet: 0 });
  });

  it('至少扫到一个游戏目录（防目录改名后静默空转）', () => {
    expect(gameDirs.length).toBeGreaterThan(0);
  });

  it('页面级待迁清单里的文件都真实存在，且确实还没迁（防清单悄悄过期）', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const bad: string[] = [];
    for (const rel of PAGE_LEVEL_PENDING) {
      const file = path.join(repoRoot, rel);
      if (!fs.existsSync(file)) {
        bad.push(`${rel} 不存在（迁完请从清单里删掉）`);
        continue;
      }
      const s = statsOf(file);
      if (s.classes === 1 && s.topFn === 0 && s.topLet === 0) {
        bad.push(`${rel} 已经迁完（类${s.classes}/fn${s.topFn}/let${s.topLet}），请从清单里删掉`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('跟上游同形而排除的整机：文件存在、且确实不是"一页一个类"（排除理由还成立）', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const bad: string[] = [];
    for (const rel of UPSTREAM_PARITY_EXCLUDED) {
      const file = path.join(repoRoot, rel);
      if (!fs.existsSync(file)) {
        bad.push(`${rel} 不存在（清单过期）`);
        continue;
      }
      const text = fs.readFileSync(file, 'utf8');
      if (!text.startsWith('// @ts-nocheck')) {
        bad.push(`${rel} 不再是 @ts-nocheck 的移植脚本 —— 排除理由需要重新评估`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/**
 * 类体里的成员序列：`S` 静态字段 / `F` 实例字段 / `C` 构造函数 / `A` 访问器 /
 * `T` 静态方法 / `M` 实例方法。只看**类体这一层**，方法体里的东西不算；注释行整行跳过。
 */
const memberSequence = (classBody: string): string => {
  const kinds: string[] = [];
  let depth = 0;
  for (const line of classBody.split('\n')) {
    const t = line.trim();
    if (depth === 0 && t && !/^(\*|\/\/|\/\*)/.test(t)) {
      const isCtor = /^(?:public |protected |private )?constructor\s*\(/.test(t);
      const isStatic = /^(?:public |protected |private )?static\b/.test(t);
      const isAccessor = /^(?:public |private |protected )?(?:get|set)\s+[A-Za-z_$]/.test(t);
      const isCall = /\b(if|for|while|switch|catch|return|new|super|await|void|typeof)\b/.test(t.split('(')[0]);
      const mods = '(?:(?:public|private|protected|readonly|declare|abstract|override|static|async|\\*)\\s+)*';
      const isMethod =
        !isCtor &&
        !isAccessor &&
        !isCall &&
        /\(/.test(t) &&
        new RegExp(`^${mods}[A-Za-z_$#][\\w$]*(?:\\s*<[^>]*>)?\\s*\\(`).test(t);
      const isField =
        !isCtor &&
        !isAccessor &&
        !isMethod &&
        new RegExp(`^${mods}[A-Za-z_$#][\\w$]*(?:!|\\?)?\\s*(?::[^=;]*)?(?:=|;)`).test(t);
      if (isCtor) kinds.push('C');
      else if (isField) kinds.push(isStatic ? 'S' : 'F');
      else if (isAccessor) kinds.push('A');
      else if (isMethod) kinds.push(isStatic ? 'T' : 'M');
    }
    depth += (line.match(/[{([]/g) || []).length - (line.match(/[})\]]/g) || []).length;
    if (depth < 0) depth = 0;
  }
  return kinds.join('');
};

const memberSequenceOf = (file: string): string => {
  const text = fs.readFileSync(file, 'utf8');
  // 必须是**行首的类声明**：文件头的注释里常有一段示例代码（` * class XxxPage extends …`），
  // 用 `indexOf('class ')` 会命中注释里的那一个，扫出来的序列就成了空的（静默假绿）。
  const at = text.search(/^[ \t]*(?:export\s+)?(?:abstract\s+)?class\s+[A-Za-z_$]/m);
  if (at < 0) return '';
  return memberSequence(text.slice(at).split('\n').slice(1).join('\n'));
};

/**
 * 成员顺序棘轮（2026-09-17 定，全家族同口径）。
 *
 * 契约：`static 常量/字段 → static 方法 → 实例字段 → 构造函数 → 访问器 / 实例方法`
 * —— 就是这条正则：`S*T*F*C*(A|M)*`。游戏页本来就是这个形状（页面的版面常量与静态工具
 * 都在最前），所以这条棘轮现在只是把现状**钉住**。
 *
 * 为什么只到这一层：Google Java Style §3.4.2 明确说 class 成员顺序"**没有唯一正确的配方**"
 * （要的是每种顺序都讲得通、维护者能解释），Google 的 TypeScript 指南对顺序**完全沉默**
 * （全文 "ordering" 出现 0 次）。所以 public/private 的先后、同组内谁先谁后，留给作者判断。
 *
 * ⚠️ 挪位置前先分清挪的是什么：**方法随便挪**（类定义时方法就全部装好，与文本顺序无关），
 * **字段的声明顺序有语义**（初始化按声明顺序执行 + 影响 V8 的 class shape）。
 */
describe('成员顺序棘轮（static 常量 → 实例字段 → 构造函数 → 方法）', () => {
  it('已迁的游戏页 / 首页 / 脚手架模板都是 S*T*F*C*(A|M)*', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const files = [
      ...[...MIGRATED].map((slug) => path.join(GAMES_DIR, slug, 'main.ts')),
      ...PAGE_LEVEL_PENDING,
      'src/home/main.ts',
      'scripts/templates/game/main.ts',
    ].map((p) => (path.isAbsolute(p) ? p : path.join(repoRoot, p)));

    const bad: string[] = [];
    let scanned = 0;
    for (const file of files) {
      if (!fs.existsSync(file)) continue;
      const seq = memberSequenceOf(file);
      if (!seq) continue;
      scanned++;
      if (!/^S*T*F*C*(?:A|M)*$/.test(seq)) bad.push(`${path.relative(repoRoot, file)}(${seq})`);
    }
    expect(bad).toEqual([]);
    // 自检：一条都没扫到就说明这条测试已经失效了
    expect(scanned).toBeGreaterThanOrEqual(3);
  });
});
