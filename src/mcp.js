#!/usr/bin/env node
/**
 * Vault CMS MCP server (stdio transport).
 *
 * Exposes three tools:
 *   - detect_project    (read-only)  — inspect a path for Astro / project metadata
 *   - list_presets      (read-only)  — list preset templates from the registry
 *   - install_vaultcms  (mutating)   — install Vault CMS into a project
 *
 * IMPORTANT: stdio MCP servers MUST NOT write to stdout outside the JSON-RPC
 * stream. All progress logs from the installer are captured into a buffer and
 * returned in the tool response. Errors and meta info go to stderr.
 */

const path = require('path');

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const pkg = require('../package.json');
const { inspectProject } = require('./lib/detection');
const { fetchTemplates, fetchPresetManifest } = require('./lib/registry');
const { installVaultCms } = require('./lib/installer');

const TOOLS = [
  {
    name: 'detect_project',
    description:
      'Inspect a directory and report whether it is an Astro project. Returns the resolved project root, package manager hint, content collections under src/content, and any dynamic Astro routes (e.g. [...slug].astro) mapped to their content collections. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Absolute or cwd-relative path to inspect. Defaults to the current working directory.',
        },
      },
    },
  },
  {
    name: 'list_presets',
    description:
      'List the preset templates available in the vaultcms-presets registry (e.g. starlight, slate, chiri). Returns names plus manifest metadata (display name, description, install target) when the manifest is available. Read-only. Defaults to davidvkimball/vaultcms-presets but supports community / private fork registries via the `source` argument or VAULTCMS_PRESETS_REPO env var.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description:
            'Optional override for the presets registry. Format: "owner/repo" or "owner/repo@branch" (branch defaults to master). Use only with repos the user trusts — preset installs download and execute zip contents.',
        },
      },
    },
  },
  {
    name: 'install_vaultcms',
    description:
      'Install Vault CMS into an Astro project. Downloads the vault config (and optionally a preset), copies _bases/ and .obsidian/, fixes paths, and updates .gitignore. This MUTATES the filesystem — confirm with the user before invoking. Refuses if an existing Obsidian vault is detected without the vault-cms plugin (passes pre-plugin user setups through unharmed); set force=true to override. Returns a structured result describing the install.',
    inputSchema: {
      type: 'object',
      properties: {
        target_path: {
          type: 'string',
          description:
            'Destination directory for the vault config. Use "." for project root or "src/content" (the typical Astro choice). Resolved relative to cwd if not absolute.',
        },
        template: {
          type: 'string',
          description:
            'Optional preset name from list_presets (e.g. "starlight"). When set, install_target from the preset manifest is preferred unless target_path overrides it.',
        },
        project_root: {
          type: 'string',
          description:
            'Optional override for the detected Astro project root. Use when the auto-detection picks the wrong ancestor.',
        },
        force: {
          type: 'boolean',
          description:
            'Overwrite an existing Obsidian vault that lacks the vault-cms plugin. Off by default so an agent does not silently clobber a user\'s pre-plugin Obsidian config (themes, hotkeys, workspace, plugin list). Only set to true after explicit user confirmation.',
        },
        presets_repo: {
          type: 'string',
          description:
            'Optional override for the presets registry. Format: "owner/repo" or "owner/repo@branch". Defaults to davidvkimball/vaultcms-presets. Use only with repos the user trusts — preset installs download and execute zip contents on the user\'s machine.',
        },
      },
      required: ['target_path'],
    },
  },
];

const server = new Server(
  { name: 'vaultcms', version: pkg.version },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  try {
    switch (name) {
      case 'detect_project':
        return jsonResult(await handleDetectProject(args));
      case 'list_presets':
        return jsonResult(await handleListPresets(args));
      case 'install_vaultcms':
        return jsonResult(await handleInstall(args));
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return errorResult(err && err.message ? err.message : String(err));
  }
});

// --- Tool handlers ---------------------------------------------------------

async function handleDetectProject(args) {
  const target = args.path ? path.resolve(args.path) : process.cwd();
  return await inspectProject(target);
}

async function handleListPresets(args = {}) {
  const override = args.source || null;
  const [names, manifest] = await Promise.all([
    fetchTemplates(override),
    fetchPresetManifest(override),
  ]);
  const presets = names.map((name) => {
    const meta = manifest?.presets?.[name.toLowerCase()] || null;
    return {
      name,
      displayName: meta?.displayName || name,
      description: meta?.description || null,
      installTarget: meta?.installTarget || 'src/content',
      theme: meta?.theme || null,
    };
  });
  // Echo back the resolved source so the caller can confirm which registry
  // they're pulling from (especially when using env var / override).
  let resolved;
  try {
    resolved = require('./lib/registry').resolvePresetsRepo(override);
  } catch {
    resolved = null;
  }
  return {
    presets,
    manifestAvailable: manifest != null,
    source: resolved
      ? { repo: resolved.repo, branch: resolved.branch, isDefault: resolved.isDefault }
      : { repo: 'davidvkimball/vaultcms-presets', branch: 'master', isDefault: true },
  };
}

async function handleInstall(args) {
  if (!args.target_path) {
    throw new Error('target_path is required.');
  }
  const targetDir = path.resolve(args.target_path);

  const logs = [];
  const result = await installVaultCms({
    targetDir,
    template: args.template || null,
    projectRoot: args.project_root ? path.resolve(args.project_root) : undefined,
    presetsRepo: args.presets_repo || null,
    force: args.force === true,
    log: (msg) => logs.push(msg),
  });

  return {
    ...result,
    logs,
    obsidianHint:
      'Open Obsidian → "Open folder as vault" → select the targetDir to start using the install. The CLI does this interactively; the MCP server intentionally does not launch GUIs.',
  };
}

// --- Helpers ---------------------------------------------------------------

function jsonResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${message}` }],
  };
}

// --- Start -----------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe; stdout is reserved for MCP framing.
  process.stderr.write(`vaultcms-mcp ${pkg.version} ready (stdio)\n`);
}

main().catch((err) => {
  process.stderr.write(`vaultcms-mcp fatal: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
