/**
 * 「家族包只进来一份」的判据实现 —— `webpack.config.js` 的 SingleEnginePlugin 与
 * `scripts/check-wiring.cjs` 共用这一份。
 *
 * 为什么不各写一套：这条判据在开发中**静默失效过**（构建全程绿、画面空白、没有任何提示），
 * 任何一处写错都会变成一扇空门。共享一份实现，改一次两边都受益。
 *
 * 实测记录（都经过复现，不是推断）：
 *
 * 1. **真正的失效原因：守护名单从 alias 表推导。**
 *    第一版把"要守护哪些包"写成 `Object.keys(family)`。删掉某条 alias 时，`family` 少了那个键，
 *    于是**连守护它也一起停掉了** —— 正好漏掉判据唯一该抓的那类错误。
 *    实测：摘掉 `ice-render` 的 alias 后产物从 1010 KiB 涨到 1.49 MiB、包里三份引擎，
 *    而判据报"0 个重复"。现在名单来自 `package.json` 的 dependencies，与 alias 表解耦。
 *
 * 2. **带 scope 的包必须按"alias 目标目录名"匹配。**
 *    `@damoqiongqiu/ice-chart` 经 alias 解析后，资源路径是 `<workspace>/ice-chart/dist/index.umd.js`，
 *    里面没有 `@damoqiongqiu/` 那一层。只按包名匹配的话，**alias 进来的那一份永远看不到**，
 *    "两份"永远数不出两份 → 对这个包的守护是空的（实测漏判，产物体积对不上才发现）。
 *    所以除包名外还要匹配 alias 目标目录的 basename（`/ice-chart/dist/`）。
 *
 * 3. **用 `lastIndexOf` 定位包目录（防御性，不是上面那次的修复）。**
 *    实测：三份真实路径（workspace 本身就叫 `ice-render`）上 `indexOf` 与 `lastIndexOf`
 *    结果**完全相同**。两者只在"祖先目录里也出现 `<pkg>/dist/`"这种形状下才会分叉，例如
 *    `/a/ice-render/dist/lib/.../node_modules/ice-render/dist/x.js`（indexOf 取到外层、lastIndexOf 取到内层）。
 *    本工程当前不会出现这种路径，所以这一条是**防御**：语义上"包目录 = 路径里最后一段
 *    `<pkg>/dist/`"才正确，用 lastIndexOf 表达这个语义，将来路径形状变了也不会静默取错。
 *    它有专门的回归用例（`check-wiring.cjs` 的自测 A'），删掉 lastIndexOf 会被测出来。
 */

/**
 * 由「要守护的包名」+「alias 表」算出每个包的路径标记。
 *
 * @param {string[]} guarded 要守护的包名（通常来自 package.json 的 dependencies）
 * @param {Record<string,string>} family alias 表：包名 → 兄弟仓绝对路径
 * @returns {Record<string, string[]>} 包名 → 路径标记数组（都以 `/` 开头、以 `/dist/` 结尾）
 */
function buildMarkers(guarded, family) {
  const out = {};
  for (const name of guarded) {
    const markers = new Set([`/${name}/dist/`]);
    const aliasTarget = family && family[name];
    if (aliasTarget) {
      const base = aliasTarget.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
      if (base) markers.add(`/${base}/dist/`);
    }
    out[name] = [...markers];
  }
  return out;
}

/**
 * 从 webpack 的模块集合里统计每个守护包解析到了哪些**不同**的包目录。
 *
 * @param {Iterable<{resource?: string}>} modules webpack 模块（或任何带 `resource` 的对象）
 * @param {Record<string, string[]>} markers 见 {@link buildMarkers}
 * @returns {Map<string, Set<string>>} 包名 → 包目录集合（size > 1 就是打重了）
 */
function collectCopies(modules, markers) {
  const out = new Map();
  for (const name of Object.keys(markers)) out.set(name, new Set());

  for (const mod of modules) {
    const resource = mod && mod.resource;
    if (!resource) continue;
    for (const [name, list] of Object.entries(markers)) {
      for (const marker of list) {
        // lastIndexOf：包目录 = 路径里**最后**一段 `<pkg>/dist/`。
        // 实测当前所有真实路径上 indexOf 与 lastIndexOf 结果相同；用 lastIndexOf 是为了在
        // "祖先目录里也出现 `<pkg>/dist/`"的形状下仍然取对内层（见文件头第 3 条的实测记录）。
        const at = resource.lastIndexOf(marker);
        if (at === -1) continue;
        // 去掉末尾的 `dist/` 与它前面那个分隔符 → 得到包目录
        out.get(name).add(resource.slice(0, at + marker.length - 'dist/'.length - 1));
      }
    }
  }
  return out;
}

/** 只保留打了两份以上（或一份都没有）的包 —— 两者都算异常。 */
function findDuplicates(copies) {
  const dupes = [];
  for (const [name, dirs] of copies) {
    if (dirs.size > 1) dupes.push({ name, dirs: [...dirs].sort() });
  }
  return dupes;
}

/** 人类可读的报错正文。 */
function describeDuplicates(dupes) {
  return dupes
    .map(({ name, dirs }) => `  ${name}（${dirs.length} 份）:\n${dirs.map((d) => `    - ${d}`).join('\n')}`)
    .join('\n');
}

module.exports = { buildMarkers, collectCopies, findDuplicates, describeDuplicates };
