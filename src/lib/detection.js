/**
 * Project & Astro detection helpers shared by the CLI and the MCP server.
 *
 * No console output here — callers (CLI / MCP) decide how to surface findings.
 */

const fs = require('fs-extra');
const path = require('path');

const ASTRO_CONFIG_NAMES = [
  'astro.config.mjs', 'astro.config.ts', 'astro.config.js',
  'astro.config.mts', 'astro.config.cjs',
];

/**
 * Walk up from startDir looking for a project marker (package.json, astro
 * config, or .git). Mirrors the behavior used by the interactive CLI so the
 * MCP-driven flow lands on the same project root.
 */
async function findProjectRoot(startDir) {
  let current = startDir;
  let depth = 0;
  while (current !== path.parse(current).root && depth < 6) {
    const hasPkg = await fs.pathExists(path.join(current, 'package.json'));
    const hasAstro = await isAstroProjectDir(current);
    const hasGit = await fs.pathExists(path.join(current, '.git'));
    if (hasPkg || hasAstro || hasGit) return current;
    current = path.dirname(current);
    depth++;
  }
  return startDir;
}

async function isAstroProjectDir(dir) {
  for (const name of ASTRO_CONFIG_NAMES) {
    if (await fs.pathExists(path.join(dir, name))) return true;
  }
  return false;
}

// Folders under src/content/ that are Vault CMS / Obsidian install artifacts,
// not real Astro content collections. Filtered from the `contentCollections`
// list so agents don't treat them as user-authored content.
const VAULT_ARTIFACT_NAMES = new Set(['.obsidian', '_bases']);

/**
 * List immediate subfolders of src/content/ — the conventional Astro content
 * collection roots. Skips dot-folders and known Vault CMS install artifacts.
 */
async function listContentCollections(projectRoot) {
  const contentDir = path.join(projectRoot, 'src', 'content');
  if (!(await fs.pathExists(contentDir))) return [];
  const entries = await fs.readdir(contentDir);
  const collections = [];
  for (const entry of entries) {
    if (entry.startsWith('.') || VAULT_ARTIFACT_NAMES.has(entry)) continue;
    try {
      const stat = await fs.stat(path.join(contentDir, entry));
      if (stat.isDirectory()) collections.push(entry);
    } catch { /* ignore */ }
  }
  return collections;
}

/**
 * Detect whether Vault CMS is already installed somewhere reasonable in the
 * project. Looks for the `.obsidian/plugins/vault-cms/` directory at the
 * project root or under `src/content/`. Returns the install path or null.
 */
async function detectVaultCmsInstall(projectRoot) {
  const candidates = [
    path.join(projectRoot, '.obsidian', 'plugins', 'vault-cms'),
    path.join(projectRoot, 'src', 'content', '.obsidian', 'plugins', 'vault-cms'),
  ];
  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) {
      // Return the vault root (parent of .obsidian), not the plugin dir.
      return path.resolve(candidate, '..', '..', '..');
    }
  }
  return null;
}

/**
 * Scan src/pages/ for dynamic route files ([...slug].astro, [slug].astro)
 * and map them to content collection URL prefixes.
 */
async function detectAstroRoutes(projectRoot) {
  const pagesDir = path.join(projectRoot, 'src', 'pages');
  const routes = [];
  if (!(await fs.pathExists(pagesDir))) return routes;

  const collections = await listContentCollections(projectRoot);
  await scanPagesDir(pagesDir, pagesDir, collections, routes);
  return routes;
}

async function scanPagesDir(dir, pagesRoot, collections, routes) {
  const items = await fs.readdir(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {
      if (!item.startsWith('[')) {
        await scanPagesDir(fullPath, pagesRoot, collections, routes);
      }
    } else if (item.match(/^\[\.\.\..*\]\.(astro|ts|js)$/) || item.match(/^\[.*\]\.(astro|ts|js)$/)) {
      const relativeDirPath = path.relative(pagesRoot, dir);
      const urlPrefix = relativeDirPath === '' ? '/' : `/${relativeDirPath.replace(/\\/g, '/')}/`;
      const relativeFilePath = path.relative(pagesRoot, fullPath).replace(/\\/g, '/');

      const dirName = path.basename(dir);
      const matchedCollection = dirName === path.basename(pagesRoot)
        ? null
        : collections.find((c) => c.toLowerCase() === dirName.toLowerCase());

      if (matchedCollection) {
        routes.push({
          collection: matchedCollection,
          urlPrefix,
          sourceFile: `src/pages/${relativeFilePath}`,
        });
      } else if (relativeDirPath === '') {
        const routedCollections = routes.map((r) => r.collection);
        const unrouted = collections.filter((c) => !routedCollections.includes(c));
        const pagesCollection = unrouted.find((c) => c.toLowerCase() === 'pages');
        if (pagesCollection) {
          routes.push({
            collection: pagesCollection,
            urlPrefix: '/',
            sourceFile: `src/pages/${relativeFilePath}`,
          });
        }
      }
    }
  }
}

/**
 * Detect the project's package manager from lockfile presence. Best-effort.
 */
async function detectPackageManager(projectRoot) {
  const checks = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
  ];
  for (const [lockfile, pm] of checks) {
    if (await fs.pathExists(path.join(projectRoot, lockfile))) return pm;
  }
  return null;
}

/**
 * Inspect a path and return a structured snapshot of what's there. Used by
 * the MCP `detect_project` tool — all read-only, no side effects.
 */
async function inspectProject(targetPath) {
  const resolved = path.resolve(targetPath);
  const exists = await fs.pathExists(resolved);
  if (!exists) {
    return {
      path: resolved,
      exists: false,
      isAstroProject: false,
      projectRoot: null,
      packageManager: null,
      contentCollections: [],
      routes: [],
      hasGit: false,
      hasPackageJson: false,
    };
  }

  const projectRoot = await findProjectRoot(resolved);
  const isAstroProject = await isAstroProjectDir(projectRoot);
  const collections = isAstroProject ? await listContentCollections(projectRoot) : [];
  const routes = isAstroProject ? await detectAstroRoutes(projectRoot) : [];
  const packageManager = await detectPackageManager(projectRoot);
  const hasGit = await fs.pathExists(path.join(projectRoot, '.git'));
  const hasPackageJson = await fs.pathExists(path.join(projectRoot, 'package.json'));
  const vaultCmsInstallPath = await detectVaultCmsInstall(projectRoot);

  return {
    path: resolved,
    exists: true,
    projectRoot,
    isAstroProject,
    hasGit,
    hasPackageJson,
    packageManager,
    contentCollections: collections,
    routes,
    vaultCmsInstalled: vaultCmsInstallPath !== null,
    vaultCmsInstallPath,
  };
}

module.exports = {
  ASTRO_CONFIG_NAMES,
  VAULT_ARTIFACT_NAMES,
  findProjectRoot,
  isAstroProjectDir,
  listContentCollections,
  detectAstroRoutes,
  detectPackageManager,
  detectVaultCmsInstall,
  inspectProject,
};
