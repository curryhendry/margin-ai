中文 | [English](README_EN.md)

# Margin

> Margin is an AI assistant plugin for Obsidian: a side-panel chat plus a selection popover. Select any text, ask questions about it, and insert or overwrite the result with one click. Multi-model, streaming output, note association and usage statistics.

> Obsidian AI 插件：右侧对话 + 划词悬浮问答。基于选区提问，结果一键插入/覆盖；支持多模型、流式输出与用量统计。
> 没有什么科技含量，单纯为极简使用AI

[![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/curryhendry/margin-ai?style=flat-square)](https://github.com/curryhendry/margin-ai/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/curryhendry/margin-ai?style=flat-square)](https://github.com/curryhendry/margin-ai)
[![MIT License](https://img.shields.io/github/license/curryhendry/margin-ai?style=flat-square)](LICENSE)

---

## Features / 功能特点

- 💬 **Side-panel chat** / 右侧对话 — streaming output, model switching, session usage stats
- 🖱️ **Selection popover** / 划词问答 — right-click "Margin" on selected text, ask about the selection
- 📥 **Insert / Overwrite** / 插入 / 覆盖 — one-click insert at cursor or overwrite selection
- 📎 **Note association** / 笔记关联 — auto-attach the current note; `[[` suggestion chips, removable
- 🔄 **Retry** / 失败重试 — one-click retry on failure without losing history
- ⚙️ **Multi-model** / 多模型管理 — add/remove models, independent API keys, connection test fills in limits

---

## Installation / 安装

**Option 1: Download ZIP** / 方式一：下载 ZIP

1. Click *Code* → *Download ZIP* in this repository
2. Extract and place in `<vault>/.obsidian/plugins/margin-ai-chat/`
   （点击本仓库 *Code* → *Download ZIP*，解压后放入该目录）

**Option 2: Download by Release** / 方式二：按版本下载

Visit [Releases](https://github.com/curryhendry/margin-ai/releases) to download a specific version.
（前往 [Releases](https://github.com/curryhendry/margin-ai/releases) 下载对应版本。）

---

## Configuration / 配置

1. Open plugin settings → **Add model**（select provider + model name + API key）/ 打开插件设置 → 添加模型（选择供应商 + 模型名 + API Key）
2. **Gemini**: model name e.g. `gemini-3.5-flash`; API key from [Google AI Studio](https://aistudio.google.com/api-keys) / Gemini：模型名如 `gemini-3.5-flash`，Key 从 Google AI Studio 获取
3. **DeepSeek**: model name e.g. `deepseek-chat` / `deepseek-reasoner`; API key from [DeepSeek Open Platform](https://platform.deepseek.com) / DeepSeek：模型名如 `deepseek-chat`、`deepseek-reasoner`，Key 从 DeepSeek 开放平台获取
4. Optional base URL for gateway/proxy (e.g. OpenRouter, one-api) / 可选：自定义 base URL 用于网关或代理（如 OpenRouter、one-api）
5. Click **Test** to verify connection and fill in model limits / 点击「测试」验证连接并回填限额

---

## Usage / 使用

1. **Side-panel chat**: click the sidebar icon, or run "Open AI Chat" from the command palette / 点击侧边栏图标，或命令面板「打开 AI Chat」
2. **Selection popover**: select text → right-click "Margin" → ask in the popover → insert at cursor / overwrite selection / 选中文字 → 右键「Margin」→ 悬浮窗提问 → 插入光标 / 覆盖选区
3. **Note association**: type `[[` for note suggestions, pick to attach; tags can be removed anytime / 输入 `[[` 弹出笔记候选，选中即关联；标签可随时移除

<img alt="设置 / Settings" src="https://github.com/user-attachments/assets/1abbf5b7-3de0-4089-8d17-183ab50341ea" />

<img alt="悬浮窗对话 / Popover" src="https://github.com/user-attachments/assets/39ec5df2-e5b5-480c-b54f-bc150c2a4149" />

---

## Privacy / 隐私说明

- 🔑 **API keys stay local** / API Key 仅存本地 — stored in your vault's `data.json`, never uploaded
- 📤 **Note content is sent to the model** / 笔记内容发送给模型 — attached notes and selections go to your configured model API (e.g. Gemini)
- 📊 **No data collection** / 不收集数据 — no analytics, telemetry, or third-party reporting

---

## Roadmap / 后续规划

- [x] Side-panel chat + selection popover / 右侧对话 + 划词悬浮问答
- [x] Multi-model management / 多模型管理
- [x] Note `[[ ]]` association & suggestions / 笔记 `[[ ]]` 关联与补全
- [x] Retry on failure / 失败重试

---

## Changelog / 更新日志

[Releases](https://github.com/curryhendry/margin-ai/releases)

---

## Acknowledgements / 致谢

- [Obsidian](https://obsidian.md)
- [Google AI Studio](https://aistudio.google.com)

---

Issues and Pull Requests are welcome!
欢迎提交 Issue 和 Pull Request！
