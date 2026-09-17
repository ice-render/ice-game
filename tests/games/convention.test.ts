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

/**
 * **页面级**文件（不在 `games/<slug>/` 里，但同样是"一页"）的迁移状态。
 *
 * - `src/home/main.ts`（1293 行）：自研首页，待迁；
 * - `src/machines/arcade/main.ts`（2286 行）与 `src/machines/windows-xp/main.ts`（3313 行）：
 *   `// @ts-nocheck` 的上游移植脚本（`sync-upstream` 抽出来后收归自维护）。它们不在类型检查里，
 *   迁成类之前要先决定"是否还跟着上游" —— 所以单独列在这里，别默默当成漏了。
 */
const PAGE_LEVEL_PENDING = new Set([
  'src/home/main.ts',
  'src/machines/arcade/main.ts',
  'src/machines/windows-xp/main.ts',
]);

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
});
