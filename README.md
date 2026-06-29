<div align="center">
# Pane

### Your browser, with an agent built in

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

Pane is for people who live in their browser all day and wish their AI assistant understood what they were actually doing.

You have tabs open, docs half-written, dashboards loaded, a meeting running, a task in your editor, and some research spread across five pages. A normal chatbot sees none of that unless you stop and explain it. Pane changes the default: the assistant lives in the browser, so it starts with the same context you already have.

Use Pane when you want to ask about the page in front of you, automate a boring web workflow, research something across tabs, save work into a local folder, or let Claude Code / Cursor drive your real browser through MCP. It feels less like "copy this into AI" and more like "my browser can help."

> **[Documentation](https://github.com/abhishek-verma/Pane/tree/main/docs)** · **[GitHub](https://github.com/abhishek-verma/Pane)** · **[Feature Requests](https://github.com/abhishek-verma/Pane/issues)**

## Why you'll want it

**Pane keeps you in flow.** You do not need to describe every tab, copy every snippet, or switch between a browser, a chatbot, and an automation tool. Pane is already where the work is.

**Pane uses your real browser session.** Authenticated apps, extensions, cookies, local dev servers, dashboards, docs, and tabs are all part of the same environment. When the agent works, it works in the browser you use.

**Pane is useful even before the big future vision.** Chat with the current page. Ask it to click through a task. Save research into a folder. Run recurring jobs. Let coding agents inspect and operate your browser through MCP.

**Pane is yours.** It is open source and local-first. Bring your own API keys, use OAuth subscriptions, or run local models. There is no Pane account or Pane cloud required.

## Quick Start

1. **Download and install** Pane — [macOS](https://files.browseros.com/download/BrowserOS.dmg) · [Windows](https://files.browseros.com/download/BrowserOS_installer.exe) · [Linux (AppImage)](https://files.browseros.com/download/BrowserOS.AppImage) · [Linux (Debian)](https://cdn.browseros.com/download/BrowserOS.deb) *(installers currently ship under the BrowserOS artifact names until the Pane infra migration lands)*
2. **Import your Chrome data** (optional) — bookmarks, passwords, and extensions all carry over
3. **Connect your AI provider** — bring your own API key (Claude, OpenAI, Gemini, …), sign in with ChatGPT Pro / GitHub Copilot / Qwen Code via OAuth, or run local models with Ollama or LM Studio
4. **Try it out** — open any page and press the **Assistant** button in the toolbar, or describe a task from the new-tab home

## What Pane can do today

| Feature | Description | Docs |
|---------|-------------|------|
| **Chat with pages** | Ask questions, summarize, extract, translate, and reason about the page you are on | [Guide](docs/index.mdx) |
| **Automate browser work** | Navigate, click, type, extract data, and complete multi-step web tasks from natural language | [Guide](docs/index.mdx) |
| **Work with local files** | Give Pane a folder so it can read, write, search, and save outputs locally | [Docs](docs/features/cowork.mdx) |
| **Use Pane from your editor** | Control your real browser from Claude Code, Cursor, Gemini CLI, or any MCP client | [Setup](docs/features/use-with-claude-code.mdx) |
| **Run scheduled tasks** | Ask Pane to run something daily, hourly, or every few minutes | [Docs](docs/features/scheduled-tasks.mdx) |
| **Bring your own model** | Use API keys, OAuth subscriptions, Ollama, or LM Studio | [Docs](docs/features/bring-your-own-llm.mdx) |
| **Browse like Chrome** | Chrome extensions, imported data, vertical tabs, and strong ad blocking | [Docs](docs/features/vertical-tabs.mdx) |

## Why Pane is different

Most AI tools ask you to bring your work to them. Pane brings the assistant to your work.

- **It has better context.** Pane can see the page, the tab, the browser session, and optionally your files. You spend less time explaining the setup.
- **It acts where the work happens.** It can use the web apps you are already logged into instead of a synthetic remote browser.
- **It works with developer tools.** Pane is also an MCP server, so your coding agent can inspect localhost, reproduce UI bugs, and operate the browser directly.
- **It can become personal.** The roadmap is built around local memory, context buckets, automatic skills, meeting capture, and learning from your browsing — all because Pane is the browser.
- **It stays open and local-first.** No required Pane account. No required Pane server. You decide which models and services to connect.

## What comes next

Pane's long-term direction is to become the browser that understands your work over time:

- **Context buckets** for projects, topics, and workflows.
- **Local memory** that remembers preferences and past work.
- **Auto-created skills** from workflows you repeat.
- **Meeting notes and browsing learnings** captured locally.
- **Safer agent actions** with previews, approvals, and an action log.

See the [specs](specs/README.md) for the current product and architecture plan.

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

- **[BrowserOS](https://github.com/browseros-ai/BrowserOS)** — Pane is a fork of BrowserOS, an amazing open-source browser-agent project in its own right. We forked because we wanted to take a different product trajectory: a more personal, local-first browser where the agent is part of the everyday browsing experience. If you are interested in the original project, definitely check out BrowserOS.
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
