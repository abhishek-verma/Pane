<div align="center">
<img width="693" height="379" alt="github-banner" src="https://github.com/user-attachments/assets/1e37941c-4dbc-4662-9c8c-3bbe9971301d" />

<br></br>
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/Docs-GitHub-blue)](https://github.com/abhishek-verma/Pane/tree/main/docs)
<br></br>
<!-- TODO(pane-infra): Pane download URLs when a Pane CDN/domain ships -->
<a href="https://files.browseros.com/download/BrowserOS.dmg">
  <img src="https://img.shields.io/badge/Download-macOS-black?style=flat&logo=apple&logoColor=white" alt="Download Pane for macOS (beta)" />
</a>
<a href="https://files.browseros.com/download/BrowserOS_installer.exe">
  <img src="https://img.shields.io/badge/Download-Windows-0078D4?style=flat&logo=windows&logoColor=white" alt="Download Pane for Windows (beta)" />
</a>
<a href="https://files.browseros.com/download/BrowserOS.AppImage">
  <img src="https://img.shields.io/badge/Download-Linux-FCC624?style=flat&logo=linux&logoColor=black" alt="Download Pane for Linux (beta)" />
</a>
<a href="https://cdn.browseros.com/download/BrowserOS.deb">
  <img src="https://img.shields.io/badge/Download-Debian-D70A53?style=flat&logo=debian&logoColor=white" alt="Download Pane Debian package" />
</a>
<br /><br />

Founders — [@nv_sonti](https://x.com/intent/user?screen_name=nv_sonti) and [@ThatNithin](https://x.com/intent/user?screen_name=ThatNithin):

[![Twitter Follow](https://img.shields.io/twitter/follow/nv_sonti?style=social)](https://x.com/intent/user?screen_name=nv_sonti)
&emsp;&emsp;&emsp;
[![Twitter Follow](https://img.shields.io/twitter/follow/ThatNithin?style=social)](https://x.com/intent/user?screen_name=ThatNithin)

</div>

Pane is an open-source Chromium fork that runs AI agents natively. **The privacy-first alternative to ChatGPT Atlas, Perplexity Comet, and Dia.**

Use your own API keys or run local models with Ollama. Your data never leaves your machine.

> **[Documentation](https://github.com/abhishek-verma/Pane/tree/main/docs)** · **[GitHub](https://github.com/abhishek-verma/Pane)** · **[Feature Requests](https://github.com/abhishek-verma/Pane/issues)**

## Quick Start

1. **Download and install** Pane — [macOS](https://files.browseros.com/download/BrowserOS.dmg) · [Windows](https://files.browseros.com/download/BrowserOS_installer.exe) · [Linux (AppImage)](https://files.browseros.com/download/BrowserOS.AppImage) · [Linux (Debian)](https://cdn.browseros.com/download/BrowserOS.deb) *(installers still ship under the BrowserOS artifact names until the infra migration lands)*
2. **Import your Chrome data** (optional) — bookmarks, passwords, extensions all carry over
3. **Connect your AI provider** — Claude, OpenAI, Gemini, ChatGPT Pro via OAuth, or local models via Ollama/LM Studio

## Features

| Feature | Description | Docs |
|---------|-------------|------|
| **AI Agent** | 53+ browser automation tools — navigate, click, type, extract data, all with natural language | [Guide](docs/index.mdx) |
| **MCP Server** | Control the browser from Claude Code, Gemini CLI, or any MCP client | [Setup](docs/features/use-with-claude-code.mdx) |
| **Cowork** | Combine browser automation with local file operations — research the web, save reports to your folder | [Docs](docs/features/cowork.mdx) |
| **Scheduled Tasks** | Run agents on autopilot — daily, hourly, or every few minutes | [Docs](docs/features/scheduled-tasks.mdx) |
| **40+ App Integrations** | Gmail, Slack, GitHub, Linear, Notion, Figma, Salesforce, and more via MCP | [Docs](docs/features/connect-mcps.mdx) |
| **Vertical Tabs** | Side-panel tab management — stay organized even with 100+ tabs open | [Docs](docs/features/vertical-tabs.mdx) |
| **Ad Blocking** | uBlock Origin + Manifest V2 support — stronger blocking than Chrome alone | [Docs](docs/features/ad-blocking.mdx) |
| **Smart Nudges** | Contextual suggestions to connect apps and use features at the right moment | [Docs](docs/features/smart-nudges.mdx) |

## Demos

### Pane agent in action
[![Pane agent in action](docs/videos/browserOS-agent-in-action.gif)](https://www.youtube.com/watch?v=SoSFev5R5dI)
<br/><br/>

### Install [Pane as MCP](docs/features/use-with-claude-code.mdx) and control it from `claude-code`

https://github.com/user-attachments/assets/c725d6df-1a0d-40eb-a125-ea009bf664dc

<br/><br/>

### Use Pane to chat

https://github.com/user-attachments/assets/726803c5-8e36-420e-8694-c63a2607beca

<br/><br/>

### Use Pane to scrape data

https://github.com/user-attachments/assets/9f038216-bc24-4555-abf1-af2adcb7ebc0

<br/><br/>

## Install `browseros-cli`

Use **Pane CLI** (`browseros-cli`) to launch and control Pane from the terminal or from AI coding agents like Claude Code.

**macOS / Linux:**

```bash
curl -fsSL https://cdn.browseros.com/cli/install.sh | bash
```

**Windows:**

```powershell
irm https://cdn.browseros.com/cli/install.ps1 | iex
```

After install, run `browseros-cli init` to connect the CLI to your running Pane instance.

## LLM Providers

Pane works with any LLM. Bring your own keys, use OAuth, or run models locally.

| Provider | Type | Auth |
|----------|------|------|
| ChatGPT Pro/Plus | Cloud | [OAuth](docs/features/chatgpt-pro-oauth.mdx) |
| GitHub Copilot | Cloud | [OAuth](docs/features/github-copilot-oauth.mdx) |
| Qwen Code | Cloud | [OAuth](docs/features/qwen-code.mdx) |
| Claude (Anthropic) | Cloud | API key |
| GPT-4o / o3 (OpenAI) | Cloud | API key |
| Gemini (Google) | Cloud | API key |
| Azure OpenAI | Cloud | API key |
| AWS Bedrock | Cloud | IAM credentials |
| OpenRouter | Cloud | API key |
| Ollama | Local | [Setup](docs/features/local-models.mdx) |
| LM Studio | Local | [Setup](docs/features/local-models.mdx) |

## How We Compare

| | Pane | Chrome | Brave | Dia | Comet | Atlas |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Open Source | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| AI Agent | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| MCP Server | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cowork (files + browser) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Scheduled Tasks | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Bring Your Own Keys | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Local Models (Ollama) | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Local-first Privacy | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Ad Blocking (MV2) | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |

**Detailed comparisons:**
- [Pane vs Chrome DevTools MCP](docs/comparisons/chrome-devtools-mcp.mdx) — developer-focused comparison for browser automation
- [Pane vs Claude Cowork](docs/comparisons/claude-cowork.mdx) — getting real work done with AI
- [Pane vs OpenClaw](docs/comparisons/openclaw.mdx) — everyday AI assistance

## Architecture

Pane is a monorepo with two main subsystems: the **browser** (Chromium fork) and the **agent platform** (TypeScript/Go).

```
Pane/
├── packages/browseros/              # Chromium fork + build system (Python)
│   ├── chromium_patches/            # Patches applied to Chromium source
│   ├── build/                       # Build CLI and modules
│   └── resources/                   # Icons, entitlements, signing
│
├── packages/browseros-agent/        # Agent platform (TypeScript/Go)
│   ├── apps/
│   │   ├── server/                  # MCP server + AI agent loop (Bun)
│   │   ├── app/                     # Browser extension UI (WXT + React)
│   │   ├── cli/                     # CLI tool (Go)
│   │   ├── eval/                    # Benchmark framework
│   │   └── controller-ext/          # Chrome API bridge extension
│   │
│   └── packages/
│       ├── agent-sdk/               # Node.js SDK (npm: @browseros-ai/agent-sdk)
│       ├── cdp-protocol/            # CDP type bindings
│       └── shared/                  # Shared constants
```

| Package | What it does |
|---------|-------------|
| [`packages/browseros`](packages/browseros/) | Chromium fork — patches, build system, signing |
| [`apps/server`](packages/browseros-agent/apps/server/) | Bun server exposing 53+ MCP tools and running the AI agent loop |
| [`apps/app`](packages/browseros-agent/apps/app/) | Browser extension — new tab, side panel chat, onboarding, settings |
| [`apps/cli`](packages/browseros-agent/apps/cli/) | Go CLI — control Pane from the terminal or AI coding agents |
| [`apps/eval`](packages/browseros-agent/apps/eval/) | Benchmark framework — WebVoyager, Mind2Web evaluation |
| [`agent-sdk`](packages/browseros-agent/packages/agent-sdk/) | Node.js SDK for browser automation with natural language |
| [`cdp-protocol`](packages/browseros-agent/packages/cdp-protocol/) | Type-safe Chrome DevTools Protocol bindings |

## Contributing

We'd love your help making Pane better! See our [Contributing Guide](CONTRIBUTING.md) for details.

- [Report bugs](https://github.com/abhishek-verma/Pane/issues)
- [Suggest features](https://github.com/abhishek-verma/Pane/issues)

**Agent development** (TypeScript/Go) — see the [agent monorepo README](packages/browseros-agent/README.md) for setup instructions.

**Browser development** (C++/Python) — requires ~100GB disk space. See [`packages/browseros`](packages/browseros/) for build instructions.

## Credits

- [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium) — Pane uses some patches for enhanced privacy. Thanks to everyone behind this project!
- [The Chromium Project](https://www.chromium.org/) — at the core of Pane, making it possible to exist in the first place.

## Citation

If you use Pane in your research or project, please cite:

```bibtex
@software{pane2026,
  author = {Nithin Sonti and Nikhil Sonti and {Pane-team}},
  title = {Pane: The open-source agentic browser},
  url = {https://github.com/abhishek-verma/Pane},
  year = {2026},
  publisher = {GitHub},
  license = {AGPL-3.0},
}
```

## License

Pane is open source under the [AGPL-3.0 license](LICENSE).

Copyright &copy; 2026 Felafax, Inc.

## Stargazers

Thank you to all our supporters!

[![Star History Chart](https://api.star-history.com/svg?repos=abhishek-verma/Pane&type=Date)](https://www.star-history.com/#abhishek-verma/Pane&Date)

<p align="center">
Built with ❤️ from San Francisco
</p>
