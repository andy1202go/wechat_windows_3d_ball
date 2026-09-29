# 全局写入同时写 GameGlobal 与 globalThis，判断能力时两边都查

Status: accepted

polyfill 里所有全局写入都走 `publishGlobal(key, value)`，把同一个值写到 `GameGlobal` 与 `globalThis` **两个**目标上；反过来，判断「某个全局能力是否已经存在」一律走 `readGlobal(key)`，两个目标都查一遍。

起因是一个真实 bug，不是理论洁癖。原先判断是否需要装 `performance` 替身的条件是 `if (!g.performance)`，其中 `g` 取的是 `GameGlobal`。真机上 `GameGlobal` 与 `globalThis` 的关系并不统一——有的引擎里它们是同一个全局对象，有的 `GameGlobal` 是独立对象、内置全局只挂在 `globalThis` 上。后一种情况下这个条件恒为真，于是 polyfill 用 `Date.now()` 的低精度假时钟**覆盖掉了真实 `performance`**。

症状不是崩溃：主循环拿到毫秒级抖动的时间戳，真机上表现为周期性卡顿，而且几乎不可能归因到 polyfill。它是在把测试替身改成忠实的（让 `GameGlobal` 与 `globalThis` 是两个不同对象）之后才暴露出来的——旧替身把二者写成同一个对象，正好把这个 bug 掩盖掉了。修复前冒烟测试的主循环步数在 586~590 之间随机抖动（期望 598 步），修复后稳定为 598，且「跑不跑前置步骤」的结果完全一致。

## Consequences

- **测试替身必须比真机更严格，不能比真机宽松。** 替身里 `GameGlobal` 刻意是一个空壳对象，连 `performance` 都看不到——比真机更苛刻。这样才能暴露「只看一边」这类错误。任何为了「让测试通过」而放松替身忠实度的改动都要先说服自己：这条差异在真机上真的不存在吗？
- 替身需要显式清掉 Node 自带、而小游戏没有的全局（`navigator`、以及强制覆盖 `performance`）。不清掉的话 polyfill 会（正确地）跳过替身安装，替身就不再忠实于真机。
- 冒烟测试里加了一条回归护栏：断言 `performance.now()` 仍是受控时钟，一旦 polyfill 又开始覆盖真实 `performance` 就会直接失败。
- 契约是「两个目标都满足」而不是「先 Try GameGlobal、失败再 globalThis」。因为 three.js 打包后的代码用的是**裸标识符** `window` / `document`（走作用域链解析到真正的全局），而业务代码显式读 `GameGlobal.canvas`——两个方向都得同时成立，退化成回退式写法会漏掉一边。
