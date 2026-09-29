// 冒烟测试跑在 Node 里，需要几个 Node 全局。
// 只声明用到的那几个，不引入 @types/node —— 它会把浏览器环境里
// 根本不存在的东西也变成合法标识符，反而削弱类型检查的价值。

declare const process: {
  exit(code?: number): never;
  argv: string[];
};
