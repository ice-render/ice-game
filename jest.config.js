/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // 单测只覆盖 src/domain/（纯业务数据与纯函数，不 import ICE 家族、不碰 DOM），
        // 所以既不需要 jsdom，也不走工程的 tsconfig（那份是给 webpack 的 dom 配置）。
        // 这样 `npm test` 不依赖任何兄弟仓的构建产物，也不依赖浏览器，跑得又快又稳。
        tsconfig: {
          module: 'commonjs',
          target: 'es2019',
          lib: ['es2019'],
          types: ['jest'],
          esModuleInterop: true,
          strict: false,
          skipLibCheck: true,
        },
      },
    ],
  },
  collectCoverageFrom: ['src/domain/**/*.ts'],
};
