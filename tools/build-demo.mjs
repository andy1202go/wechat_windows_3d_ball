/**
 * 把物理调试图打包成**单个自包含 HTML**。
 *
 * 为什么不输出「HTML + 独立 JS」两个文件：单文件在 file:// 下、
 * 在编辑器内置预览面板里、以及直接发给别人时都能打开，没有相对路径与
 * CORS 的坑。代价是构建脚本多一步字符串内联，很划算。
 */

import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);

const result = await build({
  entryPoints: [join(here, 'physics-demo.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2017',
  // 调试图故意不压缩：出错时能直接在浏览器控制台里读栈
  minify: false,
  sourcemap: false,
  write: false,
  charset: 'utf8',
  logLevel: 'warning',
});

const js = result.outputFiles[0].text;
const shell = await readFile(join(here, 'demo-shell.html'), 'utf8');

if (shell.indexOf('<!--INJECT_SCRIPT-->') < 0) {
  throw new Error('demo-shell.html 缺少 <!--INJECT_SCRIPT--> 占位符');
}

// 元素 id 校验。
// 页面骨架与逻辑分在两个文件里，id 写错在构建期不会报错，只会在打开页面时
// 抛一句「缺少页面元素 #xxx」。那种错误在真机/预览里才暴露，代价太高，
// 所以在这里把两个文件的 id 对齐检查一遍。
const demoSource = await readFile(join(here, 'physics-demo.ts'), 'utf8');
const referencedIds = new Set();
const idPattern = /\bel<[^>]+>\(\s*'([^']+)'\s*\)/g;
let idMatch = idPattern.exec(demoSource);
while (idMatch !== null) {
  referencedIds.add(idMatch[1]);
  idMatch = idPattern.exec(demoSource);
}

const missingIds = [...referencedIds].filter((id) => shell.indexOf(`id="${id}"`) < 0);
if (missingIds.length > 0) {
  throw new Error(`physics-demo.ts 引用了 demo-shell.html 里不存在的元素：${missingIds.join(', ')}`);
}

// 内联脚本里若出现 </script> 会提前闭合标签。转义掉斜杠即可，
// 对 JS 语义没有影响（只在字符串/正则里出现这种序列）。
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const html = shell.replace('<!--INJECT_SCRIPT-->', `<script>\n${safeJs}\n</script>`);

await mkdir(join(root, 'demo'), { recursive: true });
const outPath = join(root, 'demo', 'index.html');
await writeFile(outPath, html);

console.log(
  `物理调试图已生成：demo/index.html（${(html.length / 1024).toFixed(1)} KB，` +
    `校验 ${referencedIds.size} 个元素 id）`,
);
