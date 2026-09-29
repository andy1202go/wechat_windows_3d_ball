/**
 * 把 3D 台面预览打包成**单个自包含 HTML**。
 *
 * 与 build-demo.mjs 同一套路：单文件在 file:// 下、编辑器预览面板里、
 * 以及直接发给别人时都能打开，没有相对路径与 CORS 的坑。
 *
 * 之所以能这么做，是因为渲染层不依赖小游戏 API —— 浏览器里只要换掉
 * 画布来源与屏幕度量就能跑（docs/adr/0010）。
 */

import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const entry = join(root, 'src', 'preview.ts');

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2017',
  // 预览故意不压缩：three 的报错栈要能直接在浏览器控制台里读
  minify: false,
  sourcemap: false,
  write: false,
  charset: 'utf8',
  logLevel: 'warning',
});

const js = result.outputFiles[0].text;
const shell = await readFile(join(here, 'preview-shell.html'), 'utf8');

if (shell.indexOf('<!--INJECT_SCRIPT-->') < 0) {
  throw new Error('preview-shell.html 缺少 <!--INJECT_SCRIPT--> 占位符');
}

// 元素 id 校验（同 build-demo.mjs 的理由）：页面骨架与逻辑分在两个文件里，
// id 写错在构建期不会报错，只会在打开页面时抛「缺少页面元素 #xxx」。
const source = await readFile(entry, 'utf8');
const referencedIds = new Set();
const idPattern = /\bel<[^>]+>\(\s*'([^']+)'\s*\)/g;
let match = idPattern.exec(source);
while (match !== null) {
  referencedIds.add(match[1]);
  match = idPattern.exec(source);
}

const missing = [...referencedIds].filter((id) => shell.indexOf(`id="${id}"`) < 0);
if (missing.length > 0) {
  throw new Error(`preview.ts 引用了 preview-shell.html 里不存在的元素：${missing.join(', ')}`);
}

// 内联脚本里若出现 </script> 会提前闭合标签。转义掉斜杠即可，
// 对 JS 语义没有影响（只在字符串/正则里出现这种序列）。
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const html = shell.replace('<!--INJECT_SCRIPT-->', `<script>\n${safeJs}\n</script>`);

await mkdir(join(root, 'demo'), { recursive: true });
const outPath = join(root, 'demo', 'preview.html');
await writeFile(outPath, html);

console.log(
  `3D 台面预览已生成：demo/preview.html（${(html.length / 1024).toFixed(1)} KB，` +
    `校验 ${referencedIds.size} 个元素 id）`,
);
