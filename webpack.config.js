const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const WORKSPACE = path.resolve(__dirname, '..');

/**
 * ICE 家族各仓是**并列的兄弟目录**，不是一个 monorepo。
 *
 * 每个包的 `node_modules` 里还各自躺着一份自己装的 `ice-render`，直接用 node 的解析规则
 * 打包会解析出**多份引擎实例** —— 引擎的类身份（`typeId` 注册表、`instanceof`、事件总线）
 * 就会错位，表现是「组件画不出来 / 拿不到同一个 ICE」。
 *
 * 所以把两个包**都** alias 到同级仓库目录，强制整个工程只有一份 `ice-render`。
 * 副作用是好的：改完兄弟仓库 `npm run build` 一下，本工程立刻吃到新产物。
 */
const family = {
  'ice-render': path.resolve(WORKSPACE, 'ice-render'),
  'ice-web-components': path.resolve(WORKSPACE, 'ice-web-components'),
};

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    /**
     * **三个入口 = 三个 HTML**，而不是一个 HTML 里的三个页签。
     *
     * 与 ice-smart-water（单 HTML + 页签）有意不同：那是一个业务系统的多个模块，共用一套
     * 工况 / 筛选状态；这里是**三台互不相干的机器**（游戏厅首页、掌机、XP 桌面），
     * 各自独占整屏、独占键盘、各自有开机自检这类一次性流程 —— 硬塞进一个页面里，
     * 只会让「切页要重建整台机器」比「开个新页面」更贵。
     */
    entry: {
      home: path.resolve(__dirname, 'src/home/main.ts'),
      arcade: path.resolve(__dirname, 'src/games/arcade/main.ts'),
      'windows-xp': path.resolve(__dirname, 'src/games/windows-xp/main.ts'),
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      // 三个 HTML 都落在 dist 根，chunk 也在根 —— `publicPath: ''` 下相对路径全部成立，
      // 换成子目录就要处理 `../`，没有必要。
      publicPath: '',
      filename: isProd ? '[name].[contenthash:8].js' : '[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: family,
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [
            {
              // 只转译不做类型检查（类型门禁交给 `npm run types:check`），构建快得多
              loader: 'ts-loader',
              options: { transpileOnly: true },
            },
          ],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({ template: 'src/home/index.html', filename: 'index.html', chunks: ['home'] }),
      new HtmlWebpackPlugin({ template: 'src/games/arcade/index.html', filename: 'arcade.html', chunks: ['arcade'] }),
      new HtmlWebpackPlugin({
        template: 'src/games/windows-xp/index.html',
        filename: 'windows-xp.html',
        chunks: ['windows-xp'],
      }),
    ],
    devServer: {
      // 8097：家族端口分配见 playwright.config.ts 顶部注释（8096 在本机被别的服务占着）
      port: 8097,
      open: false,
      hot: false,
      // 三个入口互相独立，没有 history 路由，走默认的静态中间件即可
      historyApiFallback: false,
    },
    optimization: {
      /**
       * **不抽公共 chunk**：三个页面各自独立，同一时刻只加载一个。
       * 抽出一份 shared bundle 只会让「打开一页」多一次请求，还会把三个互不相干的
       * 页面的加载顺序绑在一起。
       */
      splitChunks: { chunks: () => false },
      runtimeChunk: false,
    },
    performance: { hints: false },
    devtool: isProd ? false : 'eval-source-map',
  };
};
