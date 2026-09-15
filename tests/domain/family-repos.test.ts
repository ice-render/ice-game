import {
  FAMILY_HOME,
  FAMILY_REPOS,
  SELF_REPO,
  allLinks,
  reposInGroup,
} from '../../src/domain/family-repos';

/**
 * 家族链接数据的单测。
 *
 * 这一层守的是"页脚挂出去的东西能不能点"——URL 形状、去重、必填字段。
 * **地址本身是否真实存在**没法在单测里验（要联网，会 flaky）；
 * 那是开发时用 HTTP 请求逐个核实过的（见 AGENTS.md），改动地址时必须重新核实。
 */
describe('family-repos', () => {
  it('每条都有 name / role / url / group，且字段不留空', () => {
    expect(FAMILY_REPOS.length).toBeGreaterThan(0);
    for (const repo of FAMILY_REPOS) {
      // 注意：`expect(value, '提示')` 是 Playwright 的用法，jest 只收一个参数
      // （多写一个会直接编译不过）—— 所以判定意图写在注释里。
      // name / role / url 都不能是空串（空串会让页脚出现一行点不了的空白）
      expect(repo.name.trim().length).toBeGreaterThan(0);
      expect(repo.role.trim().length).toBeGreaterThan(0);
      expect(repo.url.trim().length).toBeGreaterThan(0);
      expect(['core', 'app', 'tooling']).toContain(repo.group);
    }
  });

  it('URL 一律是 icerepo 的 https 地址，且与仓库名一致', () => {
    // 断言"地址 = 家族主页 + 仓库名"，防止手写时拼错（比如多一个斜杠、少了段路径）
    for (const repo of FAMILY_REPOS) {
      expect(repo.url).toBe(`${FAMILY_HOME}/${repo.name}`);
      expect(repo.url.startsWith('https://')).toBe(true);
      expect(repo.url.endsWith('/')).toBe(false);
    }
  });

  it('仓库名与 URL 都不重复', () => {
    expect(new Set(FAMILY_REPOS.map((r) => r.name)).size).toBe(FAMILY_REPOS.length);
    expect(new Set(FAMILY_REPOS.map((r) => r.url)).size).toBe(FAMILY_REPOS.length);
  });

  it('分组齐全：核心库有引擎与控件，应用与文档各至少一个', () => {
    const core = reposInGroup('core').map((r) => r.name);
    expect(core).toEqual(expect.arrayContaining(['ice-render', 'ice-web-components']));
    expect(reposInGroup('app').length).toBeGreaterThan(0);
    expect(reposInGroup('tooling').length).toBeGreaterThan(0);
  });

  it('本仓未开源时不进链接清单（页脚据此渲染成纯文本，而不是 404 链接）', () => {
    // 这是本轮的真实状态：ice-game 只有本地 git，没有 GitHub 远端。
    // 断言"没有地址时不给链接"，避免将来有人为了"好看"编一个地址进去。
    const links = allLinks();
    if (!SELF_REPO.published) {
      expect(SELF_REPO.url).toBeNull();
      expect(links).not.toContain(`https://github.com/ice-render/${SELF_REPO.name}`);
    } else {
      expect(links).toContain(SELF_REPO.url);
    }
    // 家族主页一定在清单里
    expect(links).toContain(FAMILY_HOME);
  });

  it('allLinks 与 FAMILY_REPOS 口径一致（页脚渲染与断言同源）', () => {
    const links = allLinks();
    for (const repo of FAMILY_REPOS) expect(links).toContain(repo.url);
    expect(new Set(links).size).toBe(links.length);
  });
});
