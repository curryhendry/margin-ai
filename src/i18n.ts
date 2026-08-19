/** 简易 i18n：中英双语，跟随 Obsidian 语言 + 设置可覆盖 */

import { getLanguage } from "obsidian";

export type Lang = "zh" | "en";

const zh: Record<string, string> = {
  // common
  "common.send": "发送",
  "common.you": "你",
  "common.copy": "复制本条消息",
  "common.edit_resend": "编辑并重发",
  "common.remove_attach": "移除关联",
  "common.retry": "重新获取这一轮回答",
  "common.close": "关闭",
  "common.no_model": "请先在设置中添加模型",
  "common.no_model_selected": "未选模型",
  "common.error": "错误：",
  "common.copied": "已复制",
  "common.copy_failed": "复制失败",
  // commands
  "cmd.open_chat": "打开 AI Chat",
  "cmd.open_popover": "打开 Margin 悬浮对话",
  // chat
  "chat.new": "新对话",
  "chat.placeholder": "输入消息，Enter 发送，Shift+Enter 换行",
  "chat.note_not_found": "未找到笔记：{name}",
  "chat.this_usage": "本次 {prompt}+{completion}={total}",
  "chat.session_usage": "会话累计 {prompt}+{completion}={total} tokens · {tail}",
  "chat.attached_notes": "关联笔记",
  // popover
  "popover.no_note": "当前没有打开的笔记",
  "popover.selection": "选区",
  "popover.placeholder_sel": "基于选区提问，Enter 发送，Shift+Enter 换行",
  "popover.placeholder": "输入问题，Enter 发送，Shift+Enter 换行",
  "popover.insert": "插入光标",
  "popover.overwrite": "覆盖选区",
  "popover.inserted": "已插入到光标处",
  "popover.overwritten": "已覆盖选区",
  "popover.ask_marker": "请基于上述文本回答我的问题：",
  "popover.selection_label": "基于选区：",
  "popover.ask_prompt":
    "以下是选中的文本：\n\"\"\"\n{selection}\n\"\"\"\n\n请基于上述文本回答我的问题：{question}",
  "popover.this_usage": "本次 提示 {prompt} · 补全 {completion} · 总计 {total}",
  // settings
  "settings.title": "Margin 设置",
  "settings.eye": "显示 / 隐藏",
  "settings.api_key": "API Key",
  "settings.add_model": "添加模型",
  "settings.add_hint":
    "模型名称填你想要的型号（如 gemini-3.5-flash），API Key 从 Google AI Studio 获取。可添加多个并随时切换。",
  "settings.model_name_placeholder": "模型名称，如 gemini-3.5-flash",
  "settings.need_name_key": "请填写模型名称和 API Key",
  "settings.models": "已添加模型",
  "settings.empty": "还没有模型，先在上方添加。",
  "settings.untested": "未测试",
  "settings.set_default": "设为默认",
  "settings.is_default": "默认 ✓",
  "settings.test": "测试",
  "settings.testing": "测试中…",
  "settings.test_ok": "✓ {name} 连接成功 · {limits}",
  "settings.no_limits": "无限额信息",
  "settings.test_fail_prefix": "✗ 测试失败：",
  "settings.unknown_error": "未知错误",
  "settings.edit": "修改",
  "settings.delete": "删除",
  "settings.model_name": "模型名称",
  "settings.base_url_placeholder": "base URL（可选，代理 / 网关用）",
  "settings.save": "保存",
  "settings.cancel": "取消",
  "settings.default_model": "默认模型",
  "settings.default_model_desc": "新对话 / 划词使用的默认模型",
  "settings.system_instruction": "系统指令（可选）",
  "settings.system_instruction_desc": "追加给模型的全局设定，例如“用简洁中文回答”",
  "settings.limit_context": "上下文 {n}",
  "settings.limit_output": "输出 {n}",
  };

const en: Record<string, string> = {
  "common.send": "Send",
  "common.you": "You",
  "common.copy": "Copy message",
  "common.edit_resend": "Edit & resend",
  "common.remove_attach": "Remove",
  "common.retry": "Retry this turn",
  "common.close": "Close",
  "common.no_model": "Please add a model in settings first",
  "common.no_model_selected": "No model",
  "common.error": "Error: ",
  "common.copied": "Copied",
  "common.copy_failed": "Copy failed",
  "cmd.open_chat": "Open AI Chat",
  "cmd.open_popover": "Open Margin Popover",
  "chat.new": "New chat",
  "chat.placeholder": "Type a message, Enter to send, Shift+Enter for newline",
  "chat.note_not_found": "Note not found: {name}",
  "chat.this_usage": "This: {prompt}+{completion}={total}",
  "chat.session_usage": "Session {prompt}+{completion}={total} tokens · {tail}",
  "chat.attached_notes": "Attached notes",
  "popover.no_note": "No note is open",
  "popover.selection": "Selection",
  "popover.placeholder_sel": "Ask about the selection, Enter to send",
  "popover.placeholder": "Type a question, Enter to send",
  "popover.insert": "Insert at cursor",
  "popover.overwrite": "Overwrite selection",
  "popover.inserted": "Inserted at cursor",
  "popover.overwritten": "Selection overwritten",
  "popover.ask_marker": "Please answer my question based on the text above:",
  "popover.selection_label": "Based on selection: ",
  "popover.ask_prompt":
    "Here is the selected text:\n\"\"\"\n{selection}\n\"\"\"\n\nPlease answer my question based on the text above: {question}",
  "popover.this_usage": "This: prompt {prompt} · completion {completion} · total {total}",
  "settings.title": "Margin Settings",
  "settings.eye": "Show / Hide",
  "settings.api_key": "API Key",
  "settings.add_model": "Add model",
  "settings.add_hint":
    "Enter the model name (e.g. gemini-3.5-flash) and an API key from Google AI Studio. You can add multiple models and switch anytime.",
  "settings.model_name_placeholder": "Model name, e.g. gemini-3.5-flash",
  "settings.need_name_key": "Please fill in model name and API key",
  "settings.models": "Added models",
  "settings.empty": "No models yet. Add one above.",
  "settings.untested": "Not tested",
  "settings.set_default": "Set default",
  "settings.is_default": "Default ✓",
  "settings.test": "Test",
  "settings.testing": "Testing…",
  "settings.test_ok": "✓ {name} connected · {limits}",
  "settings.no_limits": "No limit info",
  "settings.test_fail_prefix": "✗ Test failed: ",
  "settings.unknown_error": "Unknown error",
  "settings.edit": "Edit",
  "settings.delete": "Delete",
  "settings.model_name": "Model name",
  "settings.base_url_placeholder": "base URL (optional, for proxy/gateway)",
  "settings.save": "Save",
  "settings.cancel": "Cancel",
  "settings.default_model": "Default model",
  "settings.default_model_desc": "The model used for new chats and the selection popover",
  "settings.system_instruction": "System instruction (optional)",
  "settings.system_instruction_desc":
    "Global instructions appended to the model, e.g. \"answer in concise Chinese\"",
  "settings.limit_context": "Context {n}",
  "settings.limit_output": "Output {n}",
  };

let lang: Lang = "zh";

/** 从 Obsidian 的 locale 检测界面语言 */
export function detectObsidianLang(): Lang {
  try {
    if (getLanguage().startsWith("zh")) return "zh";
  } catch {
    // 忽略
  }
  return "en";
}

export function setLang(l: Lang): void {
  lang = l;
}

export function getLang(): Lang {
  return lang;
}

/** 取文案；缺失时返回 key 本身 */
export function t(key: string): string {
  return (lang === "zh" ? zh[key] : en[key]) ?? key;
}

/** 取带占位符的文案：t("chat.note_not_found", { name }) */
export function tf(key: string, params: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(params)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return s;
}
