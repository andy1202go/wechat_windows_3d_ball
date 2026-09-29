// 小游戏运行时注入的全局对象。
// 这里刻意用 any 而不是安装 @types/wechat-minigame：M1 用到的 API 很少，
// 而第三方类型包与基础库版本不同步时带来的噪音比它挡住的错误多。

declare const wx: any;
declare const GameGlobal: any;
