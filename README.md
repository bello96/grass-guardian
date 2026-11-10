# 草原卫士

微距镜头下的花园里，白蚁帮占地筑巢。拉动蛛丝做的弹弓，把甲虫弹向它们的堡垒。

在线试玩：<https://grass-guardian.dengjiabei.cn>

游戏本身没有任何外部依赖：纯 HTML、Canvas 和 JavaScript。物理引擎、全部美术和全部音效都由代码生成。

## 运行

需要 Node.js 20 以上。玩和跑测试都不需要安装任何东西。

```bash
npm start     # 打开终端里显示的地址，默认 http://localhost:5173
npm test      # 物理、规则、页面和全部关卡的自动测试
```

浏览器不允许从 `file://` 加载 ES 模块，所以不能直接双击 `index.html`，要用上面的本地服务器。

## 操作

| 操作 | 鼠标或触屏 | 键盘 |
|---|---|---|
| 瞄准 | 按住弹弓上的虫子向后拉 | 方向键：上下调角度，左右调力度 |
| 发射 | 松手（只点一下不会发射） | 空格 |
| 用技能 | 飞行中点一下屏幕 | 空格 |
| 看关卡 | 按住空白处左右拖，滚轮缩放 | |
| 暂停、重玩、静音 | 左上角按钮 | Esc、R、M |

标题页本身就能玩：标题的四个字挂在蛛丝上，可以抓着晃，也可以直接用弹弓打。

## 虫子

虫子的出手速度由弹弓的物理算出来，所以越重的虫飞得越慢、越短，撞得却更狠。

| 虫子 | 特点 | 飞行中点一下 |
|---|---|---|
| 滚滚（西瓜虫） | 落地后会一路滚过去 | 没有技能 |
| 咔哒（叩头虫） | 轻，飞得快 | 空中再跳一次 |
| 大颚（锹甲） | 最重，飞不远 | 垂直砸下去 |
| 炮炮（放屁虫） | 中等 | 向前喷气浪，自己被反冲推回去 |
| 蛛蛛 | 最轻，飞得最远 | 朝点击处射丝并荡过去，再点一下松开 |

## 物理是怎么做的

`src/physics/` 是一个小步长的位置动力学引擎，子步固定为 1/960 秒。

- **速度由位移反推。** 惯性、抛出去的速度、被撞飞都不需要专门写代码。
- **绳子只拉不推。** 绳子松弛时完全不传力，挂在上面的东西就是自由落体，失重感由此而来。
- **绳子的力有上限，并且先硬后软。** 张力是 `T = H·tanh(E·s/H) + L·s + D·max(0, ds/dt)`，其中 s 是应变。饱和项限制回弹力度，阻尼只在拉长时起作用，所以松手时弹得干脆。
- **弹弓就是一根绳子。** 代码里没有"发射速度"这个数字。虫子由绳子的张力加速，越过叉口后绳子松弛，它就自然飞出去了。
- **两点接触联立求解。** 否则依次修正的偏差会让细木柱每个子步都倾斜一点，最后倒掉。
- **固定子步。** 同样的操作在任何帧率下结果都完全一致。

参考：Müller 等 *Detailed Rigid Body Simulation with Extended Position Based Dynamics*，Macklin 等 *Small Steps in Physics Simulation*。

## 项目结构

```
src/physics/   物理引擎：刚体、碰撞、绳子、弹弓、抓取
src/game/      规则（不依赖 DOM）：回合、伤害、碎裂、技能、关卡、存档
src/render/    画面：背景、角色、方块贴图、粒子、镜头、分辨率调节
src/audio/     合成音效
src/main.js    界面流程和输入
test/          自动测试和录好的关卡解法
tools/         关卡、字体和浏览器检查工具
```

## 关卡工具

规则层不依赖浏览器，所以可以在 Node 里验证关卡。

- `node tools/difficulty.mjs`：模拟四种手不稳的玩家打每一关，报告通关率和三星率。**调关卡看这个。** 可以指定关卡和次数，例如 `node tools/difficulty.mjs --levels=queen,bounce --trials=20`，也可以用环境变量试别的数值，例如 `TUNE="worker.threshold=70" node tools/difficulty.mjs`。全部跑完要半小时左右，也比较占内存，平时只跑改过的关卡就够了。
- `node tools/solve.mjs`：机器人暴力搜索每一关的解法，写入 `test/solutions.json`。可以指定关卡，例如 `node tools/solve.mjs queen`。
- `node tools/probe-level.mjs <关卡id>`：随机打很多发，统计杀伤和切断蛛丝的次数。

`solve.mjs` 瞄得分毫不差，所以它解得开只说明这关打得过，不说明人打得过。一发 0.1 度都不能差的解法它也会交上来，难度要看 `difficulty.mjs`。

`npm test` 会检查每关唤醒后不会自己塌，并回放解法确认还能通关。**改了物理或关卡之后，如果回放测试失败，需要重新运行 `solve.mjs`。**

`tools/browser-drive.js` 是在浏览器里逐帧驱动真实游戏的调试脚本，配合地址栏的 `?debug=1` 使用。

## 浏览器检查

`npm test` 在 Node 里跑，碰不到真正的浏览器。`npm run check:browsers` 会启动本地服务器，在三种浏览器内核里打开游戏，检查这几件事：

- 页面能加载，字体到位，画面不是空白。
- 真实的点按或点击能开始关卡，真实的鼠标拖动能瞄准并发射。
- `tools/page-checks.mjs` 里的 24 项界面检查都通过，例如误触不发射、暂停时松手不发射、胜利立刻存档。
- 每个音效都有声音，叠在一起也不削波。

| 内核 | 代表 | 来源 |
|---|---|---|
| chrome | 安卓手机，包括安卓微信 | 本机安装的 Google Chrome |
| webkit | iPhone，包括 iOS 微信 | Playwright 下载 |
| firefox | 桌面浏览器 | Playwright 下载 |

第一次用之前，先安装开发依赖和两个浏览器，下载后约占 550 MB。国内下载慢的话，先把环境变量 `PLAYWRIGHT_DOWNLOAD_HOST` 设为 `https://cdn.npmmirror.com/binaries/playwright`。

```bash
npm install
npx playwright-core install webkit firefox
npm run check:browsers                                                  # 本地，三个内核都查
npm run check:browsers -- --url=https://grass-guardian.dengjiabei.cn/   # 查线上
npm run check:browsers -- --browsers=webkit,firefox                     # 只查其中几个
```

每个内核会截两张图，一张标题页，一张第一关发射后，存在系统临时目录的 `grass-guardian-browser-check` 文件夹里。有任何一项不过，命令都以非零状态退出。设置了 `HTTPS_PROXY` 时，访问线上会走这个代理。

这项检查替代不了真机：

- Playwright 带的是最新版 WebKit，而微信用的是手机系统自带的 WebKit，老 iPhone 上的版本更旧。
- Windows 版的 WebKit 没有 Web Audio，所以声音只在 Chrome 和 Firefox 里检查。
- 无头浏览器的帧率说明不了手机的帧率。Windows 上的 WebKit 用软件绘制，只有十几帧，所以检查里的等待都按游戏时间计算，不按真实时间。

## 部署

部署到 Cloudflare Workers 静态资源，配置在 `wrangler.jsonc`。这一步、裁剪字体和浏览器检查都需要先安装开发依赖。

```bash
npm install
npm run deploy
```

部署前先跑 `npm test` 和 `npm run check:browsers`，部署后再加上 `--url` 查一次线上。

只发布 `index.html`、`styles.css`、`src/` 和 `assets/`，其余文件由 `.assetsignore` 挡在外面。

## 素材

- 代码、美术、音效、关卡：全部为本项目原创，由代码生成。
- 字体：站酷快乐体（ZCOOL KuaiLe），SIL Open Font License 1.1，见 `assets/fonts/OFL.txt`。

发布的字体是只含用到的字符的子集，从 1.5 MB 减到约 34 KB，完整字体在 `tools/fonts/`。**游戏里加了新字之后要运行 `npm run font`**，漏了的话 `npm test` 会报告缺哪些字。
