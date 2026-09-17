/**
 * 主题引用棘轮（2026-09-17 立）：**构造期取色只许减，不许增**。
 *
 * 与另外两个应用仓（`ice-smart-water` / 库里的 `tests/theme-refs.test.ts`）同一套口径：
 *
 * | 写法 | 换主题时 |
 * |---|---|
 * | `fillStyle: token('ui.colors.text')`（**主题引用**，paint 时解析） | 跟着换 ✅ |
 * | `const c = theme.colors.text; … fillStyle: c`（构造期取色） | 停在旧主题 ❌ |
 *
 * 本仓 2026-09-17 把**直接进样式槽**的 17 处迁成了引用式（`kit/shell.ts` 14 处、首页 3 处），
 * 顺带把 `OVERLAY_STYLE` 那四支**语义状态色**（暂停 / 失败 / 胜利 / 就绪）从 Bootstrap 字面量
 * 换成 token —— 它们本来就该跟主题走。
 *
 * **`src/machines/*` 不在口径内**：那两台整机是从上游示例抽出来的移植脚本，
 * 按政策"继续跟上游同形"（见 AGENTS），改了就再也对不上。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.resolve(__dirname, '..', '..', 'src');

/** 每个文件允许的 `theme.colors.*` 用量（**当前实测值**，只能下调；改到 0 就从表里删）。 */
/** 每个文件允许的 `theme.colors.*` 用量 —— **已经是空的**：界面色全部改成主题引用。 */
const BUDGET: Record<string, number> = {};

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'machines') continue; // 上游同形整机，不在口径内
      walk(full, out);
    } else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
};

function usages(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of walk(SRC)) {
    const n = (fs.readFileSync(file, 'utf8').match(/theme\.colors\.[A-Za-z]/g) || []).length;
    if (n) found[path.relative(SRC, file).split(path.sep).join('/')] = n;
  }
  return found;
}

describe('主题引用棘轮（构造期取色只许减）', () => {
  it('没有文件超出预算（新增取色要写成 token 引用）', () => {
    const current = usages();
    const over = Object.entries(current)
      .filter(([file, n]) => n > (BUDGET[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} > 预算 ${BUDGET[file] ?? 0}`);
    expect(over).toEqual([]);
  });

  it('预算没有虚高（降下来了要登记，棘轮只进不退）', () => {
    const current = usages();
    const stale = Object.entries(BUDGET)
      .filter(([file, budget]) => (current[file] ?? 0) < budget)
      .map(([file, budget]) => `${file}: 预算 ${budget}，实测 ${current[file] ?? 0}（请调小）`);
    expect(stale).toEqual([]);
  });

  it('迁移进度上限（2026-09-17 起点：47 处 / 5 个文件）', () => {
    const current = usages();
    const total = Object.values(current).reduce((sum, n) => sum + n, 0);
    expect(total).toBeLessThanOrEqual(35);
    expect(Object.keys(current).length).toBeLessThanOrEqual(5);
  });
});
