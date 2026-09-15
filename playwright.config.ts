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
/**
 * 端口：家族其它仓库已占 8090（ice-render）/ 8091（实体设计器）/ 8092（smart-water）/
 * 8093（ice-web-components）/ 8094（ice-render-dsl）/ 8095（react-demo）/ 5177（ice-chart）。
 *
 * 本仓默认 **8098**。⚠️ 8096 与 8097 在本机被无关的常驻服务占着（实测是两个 python 进程，
 * 不是我们的服务）—— 所以端口做成**可用环境变量覆盖**：撞了就
 * `ICE_GAME_PORT=8099 npm run test:e2e`，不必改代码。
 *
 * `channel: 'chrome'`：用系统 Chrome，绕开 Playwright 自带无头壳与本地缓存版本对不上的坑。
 * `reuseExistingServer: false`：端口被别的服务占着时**直接响亮失败**，而不是静默复用别人的目录
 * （曾经因为 true 导致 9 个用例全红却看起来像代码坏了）。
 */
const PORT = Number(process.env.ICE_GAME_PORT || 8098);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  reporter: [['list']],
  webServer: {
    command: `npx http-server dist -p ${PORT} -c-1 --silent`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    channel: 'chrome',
  },
});
