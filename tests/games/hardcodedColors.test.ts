/**
 * 硬编码颜色棘轮（2026-09-17 立）：**界面色走 token，只许留"美术 / 品牌 / 仿真"色。**
 *
 * 为什么：界面色漏了主题不会让任何测试变红，只在换主题时露白 / 糊成一片。这条把
 * "人工看起来"变成"测试拦下来"，和 `ice-smart-water` 的同名棘轮一个口径。
 *
 * 本仓的豁免是**按文件**给的（游戏美术调色板动辄几十上百个色值，逐个登记没有意义），
 * 每一条都要写明理由；**只减不增**：新文件出现写死色值会红，豁免清单里的文件没颜色了也会红。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.resolve(__dirname, '..', '..', 'src');

/**
 * 允许写死颜色的文件（**只减不增**）——这些不是"界面外观"。
 *
 * ⚠️ 判断标准：**换主题时它该不该变**。游戏美术、品牌徽标、上游同形整机的经典配色都不该变；
 * 面板 / 文字 / 边框 / 状态色则必须走 token。
 */
const EXEMPT: Record<string, string> = {
  'games/breakout/main.ts': '游戏美术调色板（霓虹方块 / 挡板热度色）+ HUD 强调色，玩法美术不跟界面主题走',
  'home/chrome.ts': '品牌水滴 logo 的 SVG 填充色（矢量图形自身的设计色）',
  'home/main.ts': '首页品牌渐变（主色 → 深主色）与三组卡片的分类强调色',
  'home/navbar.ts': '导航条品牌渐变（与首页徽标同一套）',
};

/** 整机仿真（上游同形移植）：按政策不改写，配色跟上游一致。 */
const EXEMPT_DIRS = ['machines'];

/** 剥掉注释（文档里常引用旧色值讲历史），保留字符串/模板里的色值（那是真代码）。 */
function stripComments(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === '/' && c2 === '/') {
      let j = i;
      while (j < source.length && source[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && c2 === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === c) break;
        j++;
      }
      i = Math.min(j + 1, source.length);
      continue;
    }
    i++;
  }
  return out.join('');
}

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXEMPT_DIRS.indexOf(entry.name) >= 0) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
};

function offenders(): string[] {
  const bad: string[] = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    if (EXEMPT[rel]) continue;
    const colors = [...new Set((stripComments(fs.readFileSync(file, 'utf8')).match(/#[0-9a-fA-F]{3,8}\b/g) || []))];
    if (colors.length) bad.push(`${rel}: ${colors.join(', ')}`);
  }
  return bad;
}

describe('硬编码颜色棘轮（界面色必须走 token）', () => {
  it('没有未登记的写死颜色', () => {
    expect(offenders()).toEqual([]);
  });

  it('豁免清单没有过期条目（文件不再有写死色值就要删掉，棘轮只进不退）', () => {
    const files = new Set(
      walk(SRC).map((file) => path.relative(SRC, file).split(path.sep).join('/'))
    );
    const stale: string[] = [];
    for (const [rel, reason] of Object.entries(EXEMPT)) {
      if (!files.has(rel)) stale.push(`${rel}: 文件不在了`);
      else if (!(stripComments(fs.readFileSync(path.join(SRC, rel), 'utf8')).match(/#[0-9a-fA-F]{3,8}\b/g) || []).length) {
        stale.push(`${rel}: 已经没有写死色值了，请从豁免清单里删掉`);
      }
      if (!reason) stale.push(`${rel}: 没写理由`);
    }
    expect(stale).toEqual([]);
  });

  it('扫描口径自检：剥注释之后，注释里的色值不该被算进来', () => {
    expect(stripComments('// #ff0000\nconst a = 1;').indexOf('#ff0000')).toBeLessThan(0);
    expect(stripComments("const c = '#ff0000';").indexOf('#ff0000')).toBeGreaterThan(0);
  });
});
