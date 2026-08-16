# Margin

一个轻量的 Obsidian AI 插件，主打两件事：

1. **右侧对话**：侧边栏常驻聊天，可切换模型、查看本次 token 用量。
2. **划词沟通**：选中文字 → 右键一个「AI 对话」→ 弹出悬浮框，基于选区提问；结果可**复制 / 插入光标 / 覆盖选区 / 继续对话**。交互参照 Copilot，保持简单，不堆功能。

初期只对接 **Gemini**，但模型名称、API Key 均为用户录入、可添加多个并切换，并非写死；后期可在 `src/llm/` 下扩展其他供应商。

---

## 功能

- 右侧 Chat 视图（`VIEW_TYPE_CHAT`）
  - 模型下拉切换（来自设置里的模型列表）
  - 消息流式输出
  - 底部显示用量（提示 / 补全 / 总计 tokens）
- 划词悬浮对话（`editor-menu` 仅一个菜单项）
  - 基于选区的上下文提问
  - 结果操作：复制、插入光标处、覆盖选区、继续对话
  - 显示用量
- 设置页
  - 添加 / 删除模型（名称 + API Key + 可选 base URL）
  - 设默认模型（可多个）
  - 划词「插入」落点（光标处 / 选区之后）
  - 可选全局系统指令

---

## 配置（Gemini）

1. 打开插件设置 → **添加模型**
2. 模型名称填你想要的型号，例如 `gemini-3.5-flash`（必须与 Google AI Studio 显示的一致）
3. API Key 填你的 Gemini Key（来自 https://aistudio.google.com/api-keys ）
4. 设为默认

> 中国大陆用户：Gemini API 走 `generativelanguage.googleapis.com`，需要 Obsidian 走代理（全局 / TUN 模式）才能连通。

---

## 开发 / 构建

```bash
npm install
npm run dev      # 监听模式，输出 main.js
npm run build    # 生产构建
```

构建后把 `main.js`、`manifest.json`、`styles.css` 复制到你的 vault 的
`.obsidian/plugins/margin-ai/` 目录，重启 Obsidian 并启用即可。
（开发期推荐用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 加载本地路径。）

---

## 目录结构

```
obsidian-margin/
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── styles.css
└── src/
    ├── main.ts                 # 入口：注册视图 / 右键 / 设置
    ├── settings.ts             # 数据模型 + 设置页（多模型管理）
    ├── llm/
    │   ├── types.ts            # LLMProvider 抽象接口
    │   ├── gemini.ts           # Gemini 流式客户端（SSE + 用量）
    │   └── index.ts            # 供应商注册表
    ├── views/
    │   └── chatView.ts         # 右侧 Chat 视图
    └── selection/
        └── popover.ts          # 划词悬浮对话
```

---

## 后期扩展

- 新增供应商：在 `src/llm/` 实现 `LLMProvider` 接口，并在 `index.ts` 的 `providers` 注册表登记。
- 设置页的 `provider` 字段目前固定 `gemini`，扩展时可改为下拉选择。
