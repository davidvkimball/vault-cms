# Vault CMS MCP Server

`vaultcms-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server bundled with the `create-vaultcms` package. It lets AI agents — Claude Code, Cursor, Codex, Claude Desktop, etc. — install and configure Vault CMS through structured tool calls instead of shell commands.

## What it exposes

| Tool | Mutates? | What it does |
|---|---|---|
| `detect_project` | No | Inspects a path and returns whether it's an Astro project, the resolved project root, the package manager, content collections under `src/content`, and detected dynamic routes. |
| `list_presets` | No | Lists preset templates (Slate, Starlight, Chiri, etc.) from the [vaultcms-presets registry](https://github.com/davidvkimball/vaultcms-presets), including manifest metadata when available. |
| `install_vaultcms` | **Yes** | Installs Vault CMS into a target directory: downloads the vault config (and optionally a preset), copies `_bases/` and `.obsidian/`, fixes paths, and updates `.gitignore`. |

`install_vaultcms` writes to disk. Agents should confirm with the user before invoking it.

## Quick start

The server speaks stdio. Most clients spawn it as a subprocess.

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "vaultcms": {
      "command": "npx",
      "args": ["-y", "-p", "create-vaultcms@latest", "vaultcms-mcp"]
    }
  }
}
```

### Cursor

`Settings → Cursor Settings → MCP → Add new MCP server`:

- Name: `vaultcms`
- Type: `command`
- Command: `npx -y -p create-vaultcms@latest vaultcms-mcp`

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vaultcms": {
      "command": "npx",
      "args": ["-y", "-p", "create-vaultcms@latest", "vaultcms-mcp"]
    }
  }
}
```

### Local development

If you've cloned this repo:

```json
{
  "mcpServers": {
    "vaultcms": {
      "command": "node",
      "args": ["/absolute/path/to/vaultcms/src/mcp.js"]
    }
  }
}
```

## Recommended agent workflow

A good agent flow when a user says "set up Vault CMS in my Astro project":

1. **`detect_project`** with the user's project path — confirm it's an Astro project, surface the detected routes and collections to the user.
2. **`list_presets`** if the user mentions a theme by name (e.g. "use Starlight") — pick the matching preset.
3. **Confirm** with the user: target path, preset, what will be modified.
4. **`install_vaultcms`** with `target_path` (typically `src/content` for a non-preset install, or whatever the preset manifest specifies) and optional `template`.
5. Tell the user to open Obsidian → "Open folder as vault" → select the target directory. The MCP server intentionally does **not** launch GUI applications.

## Design notes

- **Stdio cleanliness.** The server never writes to stdout outside the JSON-RPC stream. All installer log lines are captured into a buffer and returned in the `install_vaultcms` response under the `logs` array. Errors and the boot banner go to stderr.
- **No interactive prompts.** The MCP install flow skips inquirer entirely. Defaults: when `template` is set, the preset manifest's `installTarget` is used; otherwise `target_path` is required.
- **Shared code with the CLI.** Both surfaces (`create-vaultcms` and `vaultcms-mcp`) call into `src/lib/{detection,registry,installer}.js`. There is one install path, not two.

## Smoke test

```sh
npm run test:smoke
```

Spawns the server, runs `initialize` + `tools/list` + a `detect_project` call against this repo, exits non-zero on any failure.

## Versioning

The server's reported version matches the `create-vaultcms` package version. Both are released together.
