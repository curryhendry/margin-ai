## 0.1.041 - 2026-08-27

- 🆕 MiMo 支持：新增小米 MiMo 供应商（mimo-v2.5-pro / mimo-v2.5 / mimo-v2-flash，OpenAI 兼容 /chat/completions 流式），设置页供应商按钮新增 MiMo；连接测试按供应商走对应接口并回填限额
- 🆕 DeepSeek 支持：新增 DeepSeek 供应商（deepseek-chat / deepseek-reasoner，OpenAI 兼容 /chat/completions 流式），设置页可选择 Gemini / DeepSeek；连接测试按供应商走对应接口并回填限额；兼容自定义网关 base URL
- 🧩 架构：设置页测试连接改为走统一 LLMProvider.getModelMeta，不再硬编码 Gemini
- 🌐 中英文文案新增供应商选择与 API 错误提示（Key 无效 / 余额不足 / 限流）
- 🧹 设置页：供应商选择改为 Gemini / DeepSeek 双按钮 Tab（选中高亮），替代下拉框
- 🐛 修复复制「假成功」：桌面端强制走 Electron 剪贴板（同步+回读校验），不再走会假成功的 navigator.clipboard；execCommand 兜底不再误报失败
- 🌏 区域封锁提示：识别 Gemini「User location is not supported」，给出明确中文提示（切换代理节点到支持地区）
- 🧹 设置页：移除重复的「默认模型」下拉（保留列表内「设为默认」按钮）

## 0.1.033.dev - 2026-08-21

- 💬 右侧 Chat：模型切换、流式输出、会话累计用量 + 模型限额展示；打开自动关联当前笔记
- 🖱️ 划词悬浮问答：右键「Margin」/ 命令面板打开；结果可插入光标 / 覆盖选区；每次打开新对话
- 📎 笔记关联：输入 `[[` 弹出候选补全（Obsidian 原生交互），标签可删除；解析失败有提示
- 🔄 失败重试：AI 气泡一键重新获取，不重置历史
- 🐛 修复复制误报：三级通道（electron.clipboard → navigator.clipboard → execCommand），写入后读回校验，只有确认成功才提示「已复制」
- 🌐 中英双语界面：跟随 Obsidian 语言，设置可切换
- ✨ UI：消息可拖选复制、AI 生成加载动画、图标化操作、Obsidian 原生风格
- ⚙️ 设置页：多模型管理（添加/删除/默认/连接测试回填限额）、全局系统指令、界面语言
- 🧩 架构：LLMProvider 抽象层，可扩展多供应商（当前 Gemini）
