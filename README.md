<div align="center">
<br></br>
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
|[![Docs](https://img.shields.io/badge/Docs-GitHub-blue)](https://github.com/abhishek-verma/Pane/tree/main/docs)
<br></br>
<!-- TODO(pane-infra): replace with Pane download URLs when a Pane CDN/domain ships -->
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

Created by **Abhishek Verma**

[![LinkedIn](https://img.shields.io/badge/LinkedIn-abhi--vrma-0A66C2?style=flat&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/abhi-vrma/)
[![GitHub](https://img.shields.io/badge/GitHub-abhishek--verma-181717?style=flat&logo=github&logoColor=white)](http://github.com/abhishek-verma/)
[![X](https://img.shields.io/badge/X-vrma__abhi-000000?style=flat&logo=x&logoColor=white)](https://x.com/vrma_abhi)

</div>

# Pane — the agentic browser

Most of your work already lives in your browser — your tabs, your logins, your docs, your research, your meetings. So your agent should live there too, instead of in a separate window you paste context into.

**Pane is an open-source, AI-native browser that does everything a standalone agent does, but natively inside the browser where your work already is.** It has context on everything you browse, access to your files and terminal, and it automates across the web and your machine — locally, with your own models and keys. No servers, no account, no vendor lock-in.

Think "Hermes-style agent, but the browser." You manage tasks, work, files, context, and the internet from one place — and because Pane *is* the browser, it sees your work as it happens instead of waiting for you to describe it.

> **[Documentation](https://github.com/abhishek-verma/Pane/tree/main/docs)** · **[GitHub](https://github.com/abhishek-verma/Pane)** · **[Feature Requests](https://github.com/abhishek-verma/Pane/issues)**

## The thesis

Today's AI assistants live *outside* the browser. You copy URLs, screenshots, and page text into ChatGPT or Claude; context gets lost and workflows break. Standalone agents (Hermes, OpenClaw, Claude Cowork) try to fix this by driving a browser from the outside through plugins or remote control — but they're always one step removed from your real session.

Pane takes the other path: **put the agent inside the browser.** Same cookies, tabs, extensions, and logins you already use, plus an agent that can click, type, read, and reason over them directly. Then give it your files and terminal too, so it works across the web *and* your machine in one loop. Because it's your browser, it can also quietly learn from what you do — and get smarter over time.

- **Local-first.** Your browsing data and your agent's memory stay on your machine. Bring your own API keys, use OAuth subscriptions, or run local models.
- **Open source.** AGPL-3.0. Inspect it, fork it, contribute.
- **No servers.** Pane runs entirely on your machine. There's no Pane account, no Pane cloud, no metering — by design.

## Quick Start

1. **Download and install** Pane — [macOS](https://files.browseros.com/download/BrowserOS.dmg) · [Windows](https://files.browseros.com/download/BrowserOS_installer.exe) · [Linux (AppImage)](https://files.browseros.com/download/BrowserOS.AppImage) · [Linux (Debian)](https://cdn.browseros.com/download/BrowserOS.deb) *(installers currently ship under the BrowserOS artifact names until the Pane infra migration lands)*
2. **Import your Chrome data** (optional) — bookmarks, passwords, and extensions all carry over
3. **Connect your AI provider** — bring your own API key (Claude, OpenAI, Gemini, …), sign in with ChatGPT Pro / GitHub Copilot / Qwen Code via OAuth, or run local models with Ollama or LM Studio
4. **Try it out** — open any page and press the **Assistant** button in the toolbar, or describe a task from the new-tab home

## What works today

| Feature | Description | Docs |
|---------|-------------|------|
| **AI Agent** | Browser automation from natural language — navigate, click, type, extract data across tabs | [Guide](docs/index.mdx) |
| **MCP Server** | Control the browser from Claude Code, Cursor, Gemini CLI, or any MCP client over one URL | [Setup](docs/features/use-with-claude-code.mdx) |
| **Cowork** | Combine browser automation with local file operations — research the web, save reports to your folder, run terminal commands | [Docs](docs/features/cowork.mdx) |
| **Scheduled Tasks** | Run agents on autopilot — daily, hourly, or every few minutes | [Docs](docs/features/scheduled-tasks.mdx) |
| **Custom MCP integrations** | Connect your own MCP servers (Gmail, Slack, GitHub, Linear, …) | [Docs](docs/features/connect-mcps.mdx) |
| **Vertical Tabs** | Side-panel tab management — stay organized even with 100+ tabs open | [Docs](docs/features/vertical-tabs.mdx) |
| **Ad Blocking** | uBlock Origin + Manifest V2 support — stronger blocking than Chrome alone | [Docs](docs/features/ad-blocking.mdx) |
| **Bring your own brain** | Any LLM — API keys, OAuth subscriptions, or local models | [Docs](docs/features/bring-your-own-llm.mdx) |

## Where Pane is heading

The agent-in-the-browser position unlocks things a standalone agent simply can't do. These are on the roadmap ([see the specs](specs/README.md)):

- **Context Graph** — Pane indexes your browsing, files, terminal, and scheduled work into a local, queryable, bucketed graph, so it actually knows what you're working on.
- **Memory + auto-skills** — Pane remembers you and writes its own skills from workflows it sees you repeat, then prunes what goes stale. It gets smarter the more you use it.
- **Passive capture** — automatic meeting recordings + notes, and learnings from your browsing, captured into scoped context buckets — no extra product required, because Pane is already in the browser.
- **Proactive + reach** — triggered runs (not just scheduled), a daily digest, and out-of-browser reach (OS notifications, your email, Telegram) so Pane can work for you even when the browser isn't focused.
- **Trust framework** — consequence-classed approvals, dry-run for risky actions, and a replayable action log, so the agent can act on your machine safely.

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

Pane works with any LLM. Bring your own keys, use OAuth subscriptions, or run models locally. There's no default vendor — you choose.

| Provider | Type | Auth |
|----------|------|------|
| ChatGPT Pro/Plus | Cloud | [OAuth](docs/features/chatgpt-pro-oauth.mdx) |
| GitHub Copilot | Cloud | [OAuth](docs/features/github-copilot-oauth.mdx) |
| Qwen Code | Cloud | [OAuth](docs/features/bring-your-own-llm.mdx) |
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
| Agent lives in the browser | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| MCP Server (control from Claude Code/Cursor/CLI) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Files + terminal in the loop (Cowork) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
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

Pane is a monorepo with two main subsystems: the **browser** (a Chromium fork) and the **agent platform** (TypeScript + Go).

```
Pane/
├── packages/browseros/              # Chromium fork + build system (Python)
│   ├── chromium_patches/            # Patches applied to Chromium source
│   ├── build/                       # Build CLI and modules
│   └── resources/                   # Icons, entitlements, signing
│
├── packages/browseros-agent/        # Agent platform (TypeScript/Go)
│   ├── apps/
│   │   ├── server/                  # Agent loop + MCP server (Bun/Hono)
│   │   ├── app/                     # Browser extension UI (WXT + React)
│   │   ├── cli/                     # CLI tool (Go)
│   │   └── eval/                    # Benchmark framework
│   │
│   └── packages/
│       ├── browser-mcp/             # Browser tools (CDP) + MCP registration
│       ├── browser-core/            # Page content / extraction helpers
│       ├── cdp-protocol/            # CDP type bindings
│       └── shared/                  # Shared constants and types
```

| Package | What it does |
|---------|-------------|
| [`packages/browseros`](packages/browseros/) | Chromium fork — patches, build system, signing |
| [`apps/server`](packages/browseros-agent/apps/server/) | Bun/Hono server that runs the agent loop and exposes the browser over MCP |
| [`apps/app`](packages/browseros-agent/apps/app/) | Browser extension — new tab, side panel chat, onboarding, settings |
| [`apps/cli`](packages/browseros-agent/apps/cli/) | Go CLI — control Pane from the terminal or AI coding agents |
| [`apps/eval`](packages/browseros-agent/apps/eval/) | Benchmark framework for agent quality |

For the target architecture and the systems design behind the roadmap features (Context Graph, Memory, Capture, Trust, …), see [`specs/ARCHITECTURE-DESIGN.md`](specs/ARCHITECTURE-DESIGN.md).

## Contributing

We'd love your help making Pane better! See our [Contributing Guide](CONTRIBUTING.md) for details.

- [Report bugs](https://github.com/abhishek-verma/Pane/issues)
- [Suggest features](https://github.com/abhishek-verma/Pane/issues)

**Agent development** (TypeScript/Go) — see the [agent monorepo README](packages/browseros-agent/README.md) for setup instructions.

**Browser development** (C++/Python) — requires ~100GB disk space. See [`packages/browseros`](packages/browseros/) for build instructions.

## Credits

- **[BrowserOS](https://github.com/browseros-ai/BrowserOS)** — Pane is a fork of BrowserOS, an amazing open-source agentic-browser project in its own right. We forked because we wanted to take a different product trajectory — agent-native, local-first, no servers — and build the "agent that lives in your browser" vision on top of a solid foundation. If Pane isn't the right fit for you, definitely go check out BrowserOS.
- [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium) — some patches for enhanced privacy. Thanks to everyone behind this project.
- [The Chromium Project](https://www.chromium.org/) — at the core of Pane, making it possible to exist in the first place.

## Citation

If you use Pane in your research or project, please cite:

```bibtex
@software{pane2026,
  author = {Abhishek Verma and {Pane contributors}},
  title = {Pane: The open-source agentic browser},
  url = {https://github.com/abhishek-verma/Pane},
  year = {2026},
  publisher = {GitHub},
  license = {AGPL-3.0},
}
```

## License

Pane is open source under the [AGPL-3.0 license](LICENSE).

Copyright &copy; 2026 Abhishek Verma and Pane contributors.

## Stargazers

Thank you to all our supporters!

[![Star History Chart](https://api.star-history.com/svg?repos=abhishek-verma/Pane&type=Date)](https://www.star-history.com/#abhishek-verma/Pane&Date)
