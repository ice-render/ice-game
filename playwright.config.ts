import { defineConfig } from '@playwright/test';

/**
 * ice-game 端到端回归。
 *
 * 三个页面都是**整屏画布应用**，没有可断言的 DOM 结构，所以判据分三层：
 *  1) 无 pageerror、无 console error；
 *  2) 画布**内容像素占比**达标（只刷一层底色的空画布也会「有像素」，必须按与主色的差异算）；
 *  3) 真交互：掌机的卡带能切换、游戏能按键、XP 能开机进桌面 —— 光有像素不算「能玩」。
 *
 * 前置：`npm run build`（页面吃的是打包产物，不是 src）；运行：`npm run test:e2e`。
 *
 * 端口 8097：家族其它仓库已占 8090（ice-render）/ 8091（实体设计器）/ 8092（smart-water）/
 * 8093（ice-web-components）/ 8094（ice-render-dsl）/ 8095（react-demo）/ 5177（ice-chart），
 * 错开之后可以同时跑。（8096 在本机被一个无关的 python 服务长期占着，所以再往后挪一格。）
 *
 * `channel: 'chrome'`：用系统 Chrome，绕开 Playwright 自带无头壳与本地缓存版本对不上的坑。
 * `reuseExistingServer: false`：端口被别的仓占着时直接响亮失败，而不是静默复用别人的服务目录。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  reporter: [['list']],
  webServer: {
    command: 'npx http-server dist -p 8097 -c-1 --silent',
    port: 8097,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    baseURL: 'http://localhost:8097',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    channel: 'chrome',
  },
});
