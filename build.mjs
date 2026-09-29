import { build } from 'esbuild';
import { rmSync, mkdirSync, statSync } from 'node:fs';

const watch = process.argv.includes('--watch');
// 默认就出「可发布」的产物：小游戏主包只有 4M，而未压缩的 three r117 打包后
// 是 3.7M，一不留神就把预算吃光。要调试时显式加 --dev。
const dev = process.argv.includes('--dev');
const prod = process.argv.includes('--prod');

/** 单个产物的大小警戒线（KB）。app.js 是主要占用方。 */
const SIZE_BUDGET_KB = { 'dist/polyfill.js': 60, 'dist/app.js': 1200 };

const common = {
  bundle: true,
  format: 'iife',
  target: 'es2017',
  platform: 'browser',
  // 保留原样的中文字符串字面量，不转成 \uXXXX
  charset: 'utf8',
  logLevel: 'info',
  minify: !dev,
  // 内联 sourcemap 会让产物凭空大出几 MB，而且它本身不计入任何收益。
  // 需要调试时用 --dev（内联）或自行加 --sourcemap=external。
  sourcemap: dev ? 'inline' : false,
  pure: prod ? ['console.log'] : [],
  define: {
    'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development'),
  },
};

// 两个独立产物，执行顺序由 game.js 保证，不能合并：
// polyfill 必须作为独立 bundle 先跑完，three.js 的模块级代码才能访问 window / document。
const targets = [
  { entryPoints: ['src/env/polyfill.ts'], outfile: 'dist/polyfill.js' },
  { entryPoints: ['src/main.ts'], outfile: 'dist/app.js' },
];

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

for (const target of targets) {
  await build({ ...common, ...target });
}

const kb = (path) => statSync(path).size / 1024;

console.log('');
console.log(`产物大小（模式：${dev ? 'dev（未压缩 + 内联 sourcemap）' : prod ? 'prod' : '默认（压缩）'}）`);
let overBudget = false;
for (const target of targets) {
  const size = kb(target.outfile);
  const budget = SIZE_BUDGET_KB[target.outfile];
  const flag = size > budget ? `  ⚠️ 超出警戒线 ${budget} KB` : '';
  if (size > budget) overBudget = true;
  console.log(`  ${target.outfile.padEnd(18)}${size.toFixed(1).padStart(8)} KB${flag}`);
}
const total = targets.reduce((sum, t) => sum + kb(t.outfile), 0);
console.log(`  ${'合计'.padEnd(16)}${total.toFixed(1).padStart(8)} KB  （主包上限 4096 KB）`);
if (overBudget) {
  console.log('');
  console.log('提示：超出警戒线时先确认是不是误用了 --dev，其次考虑把台面贴图分辨率调低。');
}

if (watch) {
  const { context } = await import('esbuild');
  for (const target of targets) {
    const ctx = await context({ ...common, ...target, sourcemap: 'inline' });
    await ctx.watch();
  }
  console.log('');
  console.log('watch 模式已启用（强制内联 sourcemap 便于调试），改动 src/ 会自动重建。');
}
