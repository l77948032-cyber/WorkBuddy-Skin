<h1 align="center">WorkBuddy Skin</h1>

<p align="center"><strong>给 WorkBuddy 换一套真正融入工作的主题。</strong></p>

<p align="center">
  10 套内置主题 · Agent 直接调用 · 本地运行 · 随时恢复
</p>

<p align="center">
  <a href="#三步开始">立即开始</a> ·
  <a href="#真实案例">查看案例</a> ·
  <a href="https://github.com/l77948032-cyber/WorkBuddy-Skin/releases/latest">下载最新版</a>
</p>

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/l77948032-cyber/WorkBuddy-Skin/main/docs/images/workbuddy-harbor-focus.png" alt="Harbor Focus 在 WorkBuddy 中的实机效果">
      <br><strong>Harbor Focus</strong>
      <br><sub>雾蓝海港工作台 · WorkBuddy 首页实机</sub>
    </td>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/l77948032-cyber/WorkBuddy-Skin/main/docs/images/workbuddy-orchid-night.png" alt="Orchid Night 在 WorkBuddy 中的实机效果">
      <br><strong>Orchid Night</strong>
      <br><sub>深靛兰花夜景 · WorkBuddy 对话页实机</sub>
    </td>
  </tr>
</table>

WorkBuddy Skin 是一套交给本地编程 Agent 使用的 WorkBuddy 主题工具。你只需要描述想要的
颜色、氛围和工作状态，Agent 就能挑选模板、创建副本、继续调整，再把结果应用到
WorkBuddy。

它改变的不只是一张壁纸。首页、项目页、对话区、侧栏、输入框、按钮、选中状态和提示
都会使用同一种视觉语言；内容层保留足够的通透感，不再用大片不透明面板把背景完全盖住。

## 真实案例

### 日间专注：清爽，但不苍白

**主题：Harbor Focus**

> 给 WorkBuddy 做一套适合白天整理项目的主题。用雾蓝和海玻璃色，背景要能看见，但项目
> 卡片、搜索框和主要操作必须清楚。

浅色海港背景贯穿首页与侧栏，青绿色焦点负责标记当前入口；卡片使用轻薄半透明表面，既
能区分信息层级，也不会把主视觉切成一块块生硬的白板。

### 深夜工作：沉浸，但不压抑

**主题：Orchid Night**

> 用 Orchid Night 做一个夜间版本。降低装饰亮度，让输入框和当前任务最醒目，长对话
> 阅读不能费力。

深靛玻璃、兰花紫和克制的青色边光自然延伸到导航、对话与输入区。正文依然保持高对比，
视觉重点只落在当前任务、运行状态与即将执行的操作上。

## 更多主题方向

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="./plugins/workbuddy/catalog/city-rain/background.png" alt="City Rain 主题">
      <br><strong>City Rain</strong>
      <br><sub>午夜雨幕 · 城市灯火与深蓝玻璃</sub>
    </td>
    <td width="50%" valign="top">
      <img src="./plugins/workbuddy/catalog/winter-lodge/background.png" alt="Winter Lodge 主题">
      <br><strong>Winter Lodge</strong>
      <br><sub>雪山木屋 · 壁炉暖光与深木工作台</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="./plugins/workbuddy/catalog/paper-garden/background.png" alt="Paper Garden 主题">
      <br><strong>Paper Garden</strong>
      <br><sub>压花纸艺 · 适合长时间阅读与整理</sub>
    </td>
    <td width="50%" valign="top">
      <img src="./plugins/workbuddy/catalog/orbit-console/background.png" alt="Orbit Console 主题">
      <br><strong>Orbit Console</strong>
      <br><sub>轨道控制台 · 面向复杂任务的精密深色界面</sub>
    </td>
  </tr>
</table>

上面展示的是主题视觉方向。实际应用后，导航、组件、交互状态与内容层也会同步变化。

## 10 套内置主题

| 主题 | 视觉方向 | 主题 | 视觉方向 |
| --- | --- | --- | --- |
| **Harbor Focus** | 雾蓝海港与海玻璃 | **Orchid Night** | 深靛兰花与青色边光 |
| **City Rain** | 午夜雨幕与城市灯火 | **Winter Lodge** | 雪山木屋与壁炉暖光 |
| **Paper Garden** | 压花植物与纤维纸 | **Orbit Console** | 轨道舷窗与航天控制台 |
| **Ink Courtyard** | 水墨雨院与朱砂印记 | **Forest Notes** | 雨后森林与植物手记 |
| **Coral Studio** | 爱琴海光线与珊瑚拼贴 | **Desert Dawn** | 沙漠晨光与赤陶建筑台 |

每套模板都可以复制成自己的主题。原模板保持不变，你可以继续让 Agent 调整配色、背景、
表面透明度、焦点和组件细节，也可以从空白主题开始创造。

## 把它交给你的 Agent

你可以直接这样说：

> 给 WorkBuddy 找一套适合夜间长时间工作的主题，背景要有存在感，但文字不能被干扰。

> 以 Harbor Focus 为基础做一个更清爽的版本，降低卡片白度，把当前项目的焦点再加强。

> 先预览这个主题并截图，确认首页、项目页和对话页都清楚后再应用。

> 帮我把 WorkBuddy 恢复成原生界面。

Agent 可以直接调用 `workbuddy-skin` 完成这些操作，无需 ACP、MCP Server 或额外桌面管理
应用。

## 三步开始

### 1. 安装

需要 macOS 与 Node.js `22.12` 或更高版本。

```bash
npm install --global github:l77948032-cyber/WorkBuddy-Skin
```

### 2. 从模板创建自己的主题

```bash
workbuddy-skin templates
workbuddy-skin template install orchid-night --as my-night
```

### 3. 应用到 WorkBuddy

```bash
workbuddy-skin apply my-night
```

预览、检查与恢复：

```bash
workbuddy-skin preview my-night --screenshot "$PWD/preview.png"
workbuddy-skin verify --screenshot "$PWD/current.png"
workbuddy-skin restore
```

所有命令只面向 WorkBuddy，不需要选择目标或版本。

## 为什么可以放心尝试

- **本地运行**：主题、图片和运行状态留在你的电脑上。
- **明确应用**：创建和修改主题不会自动改变 WorkBuddy，应用操作始终单独执行。
- **先预览再决定**：可以生成真实截图检查结果，再决定是否保留。
- **随时恢复**：`restore` 会移除主题效果，让 WorkBuddy 回到原生界面。
- **不替换界面文件**：主题通过本地运行时呈现，不覆盖 WorkBuddy 原有界面资源。
- **不需要 Apple 证书**：这是 CLI，不是需要签名安装的 macOS 应用。

当前已在 **WorkBuddy 5.3.5 · macOS** 完成实机应用、首页与对话页截图验证。WorkBuddy
更新界面后，个别组件可能需要重新适配，欢迎附版本号与截图反馈。

## 常见问题

<details>
<summary><strong>关闭终端后，主题会消失吗？</strong></summary>
<br>
不会因为命令结束而立即消失。需要结束时，主动执行
<code>workbuddy-skin restore</code>。
</details>

<details>
<summary><strong>可以完全制作自己的主题吗？</strong></summary>
<br>
可以。你可以复制任意模板继续修改，也可以让 Agent 从空白主题开始生成，并导入自己的
PNG、JPEG 或 WebP 背景。
</details>

<details>
<summary><strong>应用之前能看到实际效果吗？</strong></summary>
<br>
可以。<code>preview</code> 会临时应用主题并生成实机截图，然后恢复此前状态。
</details>

<details>
<summary><strong>WorkBuddy 更新后效果异常怎么办？</strong></summary>
<br>
先执行验证或恢复，再附上 WorkBuddy 版本、macOS 版本和截图提交 Issue。应用界面升级后，
部分组件可能需要重新适配。
</details>

## 一起把 WorkBuddy 变得更有趣

欢迎分享主题灵感、实机截图和兼容性反馈，也欢迎通过 Pull Request 提交新的主题模板。

- [下载最新版本](https://github.com/l77948032-cyber/WorkBuddy-Skin/releases/latest)
- [提交问题或建议](https://github.com/l77948032-cyber/WorkBuddy-Skin/issues)
- [查看完整命令说明](./docs/agent-tool-v1.md)
- [素材与来源说明](./NOTICE.md)

本项目采用 [MIT License](./LICENSE)。WorkBuddy Skin 是非官方社区项目，不代表
WorkBuddy、ByteDance、OpenAI 或相关产品方。
