/**
 * 最高分榜：**薄包装**，实体是库里的 `ICEHighScoreModel`。
 *
 * 为什么只包一层而不自己写：库里那个模型已经把这类代码最容易出错的地方做完了 ——
 * 排序、截断、并列保持先来后到、存档损坏（非法 JSON / 结构不对 / 里层字段不合法）降级成空榜、
 * 写盘失败不影响内存成绩。重写一遍只会把这些坑再踩一次。
 *
 * ```ts
 * const best = createHighScores('breakout', { maxEntries: 5 });
 * best.add(120);      // 注意：收的是**分数本身**，不是对象
 * best.getBest();     // 空榜返回 0
 * best.getScores();   // [{ score, at }, ...] 降序
 * ```
 *
 * 前缀 `ice-game-scores-` + 游戏 slug：多个游戏的榜单互不干扰，也不与家族其它示例撞键。
 */
import { ICEHighScoreModel } from 'ice-web-components';
import type { KVStorage } from './storage';

export interface HighScoreOptions {
  maxEntries?: number;
  /** 注入存储后端（默认用 localStorage；模型内部自己兜容错）。 */
  storage?: KVStorage | null;
}

/** 建一个最高分榜。 */
export function createHighScores(gameSlug: string, options: HighScoreOptions = {}): ICEHighScoreModel {
  const config: Record<string, unknown> = {
    key: gameSlug,
    prefix: 'ice-game-scores-',
    maxEntries: options.maxEntries || 5,
  };
  if (options.storage !== undefined) config.storage = options.storage;
  return new ICEHighScoreModel(config as never);
}
