# Margin

> Obsidian AI 插件：右侧对话 + 划词悬浮问答。基于选区提问，结果一键插入/覆盖；支持多模型、流式输出与用量统计。

[![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/curryhendry/margin-ai?style=flat-square)](https://github.com/curryhendry/margin-ai/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/curryhendry/margin-ai?style=flat-square)](https://github.com/curryhendry/margin-ai)

---

## 功能特点

- 💬 **右侧对话** — 侧边栏常驻聊天，流式输出，模型切换，会话用量统计
- 🖱️ **划词问答** — 选中文字右键「Margin」，悬浮窗基于选区提问
- 📥 **插入 / 覆盖** — 结果一键插入光标处或覆盖选区
- 📎 **笔记关联** — 打开自动关联当前笔记；输入 `[[` 弹出候选补全，标签可删除
- 🔄 **失败重试** — 请求失败一键重新获取，不重置历史
- ⚙️ **多模型管理** — 设置页添加/删除模型，独立 API Key，连接测试回填限额

---

## Installation

**方式一：下载 ZIP**

1. 点击本仓库 *Code* → *Download ZIP*
2. 解压后放入 `<vault>/.obsidian/plugins/margin-ai/` 目录

**方式二：按版本下载**

前往 [Releases](https://github.com/curryhendry/margin-ai/releases) 下载对应版本。


---

## 配置（Gemini）

1. 打开插件设置 → **添加模型**
2. 模型名称填你想要的型号，例如 `gemini-3.5-flash`（与 Google AI Studio 显示一致）
3. API Key 填你的 Gemini Key（[https://aistudio.google.com/api-keys](https://aistudio.google.com/api-keys)）
4. 设为默认

> 中国大陆用户：Gemini API 需要 Obsidian 走代理（全局 / TUN 模式）才能连通。

---

## Usage

1. **右侧对话**：点击侧边栏图标，或命令面板「打开 AI Chat」
2. **划词问答**：选中文字 → 右键「Margin」→ 悬浮窗提问 → 插入光标 / 覆盖选区
3. **关联笔记**：输入 `[[` 弹出笔记候选，选中即关联；标签可随时移除

---

## 后续规划

- [x] 右侧对话 + 划词悬浮问答
- [x] 多模型管理
- [x] 笔记 `[[ ]]` 关联与补全
- [x] 失败重试

---

## 更新日志

[Releases](https://github.com/curryhendry/margin-ai/releases)

---

## 致谢

- [Obsidian](https://obsidian.md)
- [Google AI Studio](https://aistudio.google.com)

---

欢迎提交 Issue 和 Pull Request！
