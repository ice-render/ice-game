/**
 * `src/kit` —— 小游戏底座。自研游戏（`src/games/<slug>/`）共用这一套，不要再各写一遍。
 *
 * 六件：
 *
 * | 模块 | 解决什么 |
 * |---|---|
 * | `page` | 画布 + 引擎 + 主题 + dpr，一行初始化 |
 * | `shell` | 标题 / 数值卡 / 按钮 / 操作说明 / 暂停与结束覆盖层 |
 * | `loop` | 帧循环（dt 上限、暂停即停帧） |
 * | `input` | 键盘 → 语义动作（repeat 抑制、失焦清键、preventDefault 只拦已绑定的键） |
 * | `storage` | localStorage 容错读写（零依赖，可纯 node 单测） |
 * | `high-scores` | 最高分榜（复用 `ICEHighScoreModel`，不重写排序与存档容错） |
 * | `audio` | WebAudio 合成音效（零音频文件） |
 *
 * 约定：**kit 只放"每个游戏都会重复写、且写错了很难查"的东西**。
 * 只要一个游戏用得上的逻辑（玩法、胜负判定、版面）就写在那个游戏自己的目录里，
 * 别往这里塞 —— 这里是公共件，改一处会影响所有游戏。
 */
export * from './page';
export * from './shell';
export * from './loop';
export * from './input';
export * from './storage';
export * from './high-scores';
export * from './audio';
