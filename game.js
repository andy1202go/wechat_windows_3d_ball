// 微信小游戏唯一入口。
//
// 顺序绝对不能调换：app.js 里 three.js 的模块级代码在加载时就会访问
// window / document，polyfill 没跑完会直接崩在模块初始化阶段。
// 之所以拆成两个产物而不是在 main.ts 里写 `import './env/polyfill'`，
// 是因为 esbuild 打包时模块的执行顺序虽然遵循 import 顺序，
// 但这种隐式依赖一旦有人调整 import 次序就会静默失效。
// 手写入口把顺序变成显式契约。
require('./dist/polyfill.js');
require('./dist/app.js');
