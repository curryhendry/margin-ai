[中文](README.md) | English

# Margin

> Obsidian AI plugin: a side panel chat + selection popover. Ask questions about your selection, insert/overwrite results with one click; multi-model, streaming output and usage stats.

> No fancy tech, just a minimal way to use AI.

[![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/curryhendry/margin-ai?style=flat-square)](https://github.com/curryhendry/margin-ai/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/curryhendry/margin-ai?style=flat-square)](https://github.com/curryhendry/margin-ai)
[![MIT License](https://img.shields.io/github/license/curryhendry/margin-ai?style=flat-square)](LICENSE)

---

## Features

- 💬 **Side Panel Chat** — Persistent chat in the sidebar, streaming output, model switching, session usage stats
- 🖱️ **Selection Popover** — Select text, right-click "Margin", ask questions about the selection in a popover
- 📥 **Insert / Overwrite** — Insert the result at the cursor or overwrite the selection with one click
- 📎 **Note Association** — Auto-attach the current note; type `[[` for note suggestions; tags are removable
- 🔄 **Retry on Failure** — One-click retry without losing history
- ⚙️ **Multi-Model** — Add/remove models in settings, independent API keys, connection test fills in limits

---

## Installation

**Option 1: Download ZIP**

1. Click *Code* → *Download ZIP* in this repository
2. Extract and place in `<vault>/.obsidian/plugins/obsidian-margin/`

**Option 2: Download by Release**

Visit [Releases](https://github.com/curryhendry/margin-ai/releases) to download a specific version.

---

## Configuration (Gemini)

1. Open plugin settings → **Add model**
2. Enter the model name you want, e.g. `gemini-3.5-flash` (matches Google AI Studio)
3. Enter your Gemini API key ([https://aistudio.google.com/api-keys](https://aistudio.google.com/api-keys))

---

## Usage

1. **Side panel chat**: click the sidebar icon, or run "Open AI Chat" from the command palette
2. **Selection popover**: select text → right-click "Margin" → ask in the popover → insert at cursor / overwrite selection
3. **Note association**: type `[[` for note suggestions, pick to attach; tags can be removed anytime

<img alt="Settings" src="https://github.com/user-attachments/assets/1abbf5b7-3de0-4089-8d17-183ab50341ea" />

<img alt="Popover" src="https://github.com/user-attachments/assets/39ec5df2-e5b5-480c-b54f-bc150c2a4149" />

---

## Privacy

- 🔑 **API keys stay local** — keys are stored in your vault's `data.json`, never uploaded
- 📤 **Note content is sent to the model** — attached notes and selections are sent to your configured model API (e.g. Gemini) to generate answers
- 📊 **No data collection** — no analytics, telemetry, or third-party reporting

---

## Roadmap

- [x] Side panel chat + selection popover
- [x] Multi-model management
- [x] Note `[[ ]]` association & suggestions
- [x] Retry on failure

---

## Changelog

[Releases](https://github.com/curryhendry/margin-ai/releases)

---

## Acknowledgements

- [Obsidian](https://obsidian.md)
- [Google AI Studio](https://aistudio.google.com)

---

Issues and Pull Requests are welcome!
