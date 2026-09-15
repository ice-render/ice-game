/**
 * 存档：`localStorage` 的**容错**包装。
 *
 * 为什么值得单独收一层：直接用 `localStorage` 会在这些情况下把游戏搞崩 ——
 * 隐私模式/禁用存储时 `localStorage` 本身就可能抛异常；配额满时 `setItem` 抛；
 * 上一版游戏写下的 JSON 结构变了会让 `JSON.parse` 或后续读取拿到 `undefined`。
 * 游戏不该为这些付代价：读不到就当没有，写不进就当这次不存。
 *
 * ```ts
 * const store = createStore('breakout');        // 键名会带前缀，避免多个游戏互相踩
 * const sound = store.get('sound', true) as boolean;
 * store.set('sound', false);
 * ```
 *
 * 本文件**零运行时依赖**（不 import 任何 ICE 包），所以能直接在 node 里单测
 * （见 `tests/kit/storage.test.ts`）—— 容错逻辑正是最该被测的那类代码。
 * 最高分榜在 `high-scores.ts`（那一层要复用库里的模型）。
 */

/** 存储后端的最小接口（与 `localStorage` 同形，便于注入内存实现做测试）。 */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface Store {
  readonly namespace: string;
  /** 存储是否可用（隐私模式下为 false；此时 `get` 恒返回兜底值、`set` 恒失败）。 */
  readonly available: boolean;
  get<T>(key: string, fallback: T): T;
  /** 返回是否真的写成功（配额满 / 不可用时为 false，不抛错）。 */
  set(key: string, value: unknown): boolean;
  remove(key: string): void;
}

/** 探测一次存储可用性：不可用时返回 null，之后所有读写都走"降级"路径。 */
function detectStorage(injected?: KVStorage | null): KVStorage | null {
  if (injected !== undefined) return injected;
  try {
    const storage = (globalThis as any).localStorage as KVStorage | undefined;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return null;
    // 真写一次：隐私模式下 localStorage 存在但 setItem 会抛
    const probe = '__ice-game-probe__';
    storage.setItem(probe, '1');
    if (typeof storage.removeItem === 'function') storage.removeItem(probe);
    return storage;
  } catch (err) {
    return null;
  }
}

/**
 * 建一个带命名空间的键值存储。
 *
 * @param namespace 通常是游戏 slug；键名会变成 `ice-game:<namespace>:<key>`
 * @param storage   可选，注入后端（测试用内存实现）
 */
export function createStore(namespace: string, storage?: KVStorage | null): Store {
  const ns = `ice-game:${namespace}:`;
  const backend = detectStorage(storage);
  const fullKey = (key: string) => ns + key;

  return {
    namespace,
    available: backend !== null,
    get<T>(key: string, fallback: T): T {
      if (!backend) return fallback;
      let raw: string | null = null;
      try {
        raw = backend.getItem(fullKey(key));
      } catch (err) {
        return fallback;
      }
      if (raw === null || raw === undefined) return fallback;
      try {
        const parsed = JSON.parse(raw);
        // 存进去的是 undefined / null 时按"没有值"处理，不覆盖兜底
        return parsed === undefined || parsed === null ? fallback : (parsed as T);
      } catch (err) {
        /*
         * JSON.parse 失败 = 这份数据不可信（被外部改过 / 格式不认识）→ 用兜底值。
         *
         * 这里**不要**"退回原始字符串"：本层写入一律经过 JSON.stringify，所以
         * 读出来不是合法 JSON 就说明数据已经坏了；把 `'{坏掉的 json'` 透给游戏，
         * 等于把"读不到"的小问题变成"类型错乱"的大问题。
         */
        return fallback;
      }
    },
    set(key: string, value: unknown): boolean {
      if (!backend) return false;
      try {
        backend.setItem(fullKey(key), JSON.stringify(value));
        return true;
      } catch (err) {
        // 配额满 / 被禁用：静默失败，游戏继续跑（丢一次存档不该中断游戏）
        return false;
      }
    },
    remove(key: string): void {
      if (!backend || typeof backend.removeItem !== 'function') return;
      try {
        backend.removeItem(fullKey(key));
      } catch (err) {
        /* 同上：删不掉就算了 */
      }
    },
  };
}
