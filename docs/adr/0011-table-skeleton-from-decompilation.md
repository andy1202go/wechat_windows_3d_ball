# 台面骨架以原版反编译资源为真值来源

Status: accepted

要按原版重建台面，先得知道「原版到底有什么」。这件事上项目此前是空白的：`data.ts` 里那 14 个元素（3 缓冲器、3 击倒目标、3 使命目标、2 反弹器、2 挡板、1 发射器）是我按印象估出来的，文件头注释还写着「M3 阶段会对着原版截图逐个校准」——而那份截图从来没找过。

参照源选定 `k4zmu2a/SpaceCadetPinball`（原版游戏的反编译项目）。它提供了三样截图给不了的东西：

1. **元素类型全集**。源码里是 18 个组件类：`TBumper`、`TFlipper`、`TRamp`、`THole`、`TKickout`、`TSink`、`TKickback`、`TFlagSpinner`、`TLightRollover`、`TLightBargraph`、`TLightGroup`、`TPopupTarget`、`TSoloTarget`、`TOneway`、`TGate`、`TTripwire`、`TWall`、`TDrain`。我们当时只实现了其中两类。
2. **数量是精确值而非目测**。`Doc/.dat dump.txt` 里 `attack_bumpers` 组的灯引用是 `1027 372 380 388 396`——4 个，与机制描述的「set of four bumpers」互相印证；`middle_circle` 9 盏、`outer_circle` 19 盏，中央灯环是 28 个点阵灯；`fuel_bargraph` 6 格且长度递减 `14 12 10 8 6 4`。这些数字用截图是数不准的。
3. **内部坐标系**。`table_size` 为 600 × 416。

取用边界定得很清楚：**只取结构**——元素清单、数量、相对位置，以及描述机制的那部分源码逻辑。原版的美术资源（位图、调色板、音效）一律不使用，台面所有图形仍由代码生成（ADR-0005）。参照文件放在 `.smoke/ref/`，在 `.gitignore` 内，不进版本库。

## Consequences

- `data.ts` 的角色变了：它不再是我的手工估值的容器，而是「原版结构的本地表达」。改一个元素的数量或位置时，依据应该是资源 dump 或源码，不是手感。
- 「原版内部的 600 × 416」与「我们的逻辑平面 100 × 172」之间需要一次映射。原版那个尺寸是整个游戏画面（含右侧计分面板），不是台面本身，所以映射不是简单等比缩放——必须先把台面的实际边界从画面里确定出来。这件事在 M3 做，结论要写回 `data.ts` 的注释。
- 我们的元素类型远少于原版，但不是所有原版类型都要落地。本次只做「有体积、有位置、球撞得到」的那部分（见 ADR-0012 的范围界定）；`TTripwire`、`TGate` 这类纯逻辑触发体不在此列。
- 参照源是第三方反编译项目，自身也在演进。它与原版行为若有出入，判据是**原版行为**，不是这个仓库的当前状态。
- 网络约束记一笔：本机 `en.wikipedia.org` 与 `upload.wikimedia.org` 不可达（超时），`raw.githubusercontent.com` 只解析到 IPv6 且无出口、`objects.githubusercontent.com` 被解析到 `127.0.0.1`，唯有 `api.github.com` 通。所以取文件走 GitHub Contents API（返回 base64），不走 raw 域名。
