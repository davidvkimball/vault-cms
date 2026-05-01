/**
 * Vault CMS installer — non-interactive, side-effecting. Used by both the
 * CLI (with `console.log`) and the MCP server (with a buffered logger).
 *
 * Does NOT call console.log directly: every progress line goes through the
 * `log` callback so MCP stdout stays JSON-RPC clean.
 */

const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');

const { findProjectRoot, detectObsidianVault, detectVaultCmsInstall } = require('./detection');
const { downloadFile, resolvePresetsRepo, MAIN_ZIP } = require('./registry');

/**
 * Install Vault CMS into `targetDir`. Resolves project root, downloads the
 * archive (or preset), copies the vault config, fixes paths, and writes
 * .gitignore entries.
 *
 * Returns a structured result describing what was modified.
 *
 * @param {Object} opts
 * @param {string} opts.targetDir         Absolute path where the vault config lands.
 * @param {string} [opts.template]        Optional preset name (e.g. "starlight").
 * @param {string} [opts.projectRoot]     Override project-root detection.
 * @param {string} [opts.presetsRepo]     Override the presets registry source
 *                                        ("owner/repo" or "owner/repo@branch").
 *                                        Defaults to davidvkimball/vaultcms-presets.
 * @param {boolean} [opts.force]          Overwrite an existing Obsidian vault that
 *                                        lacks the vault-cms plugin. Off by default
 *                                        so an agent doesn't silently clobber a user's
 *                                        pre-plugin Obsidian config.
 * @param {(msg: string) => void} [opts.log]  Progress logger.
 */
async function installVaultCms(opts) {
  const log = opts.log || (() => {});
  const targetDir = path.resolve(opts.targetDir);
  const template = opts.template || null;
  const force = opts.force === true;
  const presetsRepo = opts.presetsRepo || null;

  await fs.ensureDir(targetDir);

  const resolvedProjectRoot = path.resolve(opts.projectRoot || (await findProjectRoot(targetDir)));

  // Safety guard: if the project already has an Obsidian vault but no vault-cms
  // plugin, refuse unless the caller explicitly forces. Older Obsidian-authored
  // sites (pre-vault-cms-plugin) would otherwise get their workspace, hotkeys,
  // theme, and plugin list silently overwritten.
  const existingObsidianVault = await detectObsidianVault(resolvedProjectRoot);
  const existingVaultCms = await detectVaultCmsInstall(resolvedProjectRoot);
  if (existingObsidianVault && !existingVaultCms && !force) {
    const err = new Error(
      `Existing Obsidian vault detected at "${existingObsidianVault}" without the vault-cms plugin. ` +
      `Installing would overwrite the user's existing Obsidian configuration ` +
      `(workspace, hotkeys, theme, plugin list). ` +
      `Pass force=true to overwrite, or install the vault-cms plugin into the existing vault to upgrade in place.`
    );
    err.code = 'EXISTING_OBSIDIAN_VAULT';
    err.existingVaultPath = existingObsidianVault;
    throw err;
  }
  const tempZip = path.join(targetDir, 'vaultcms-temp.zip');
  const extractDir = path.join(targetDir, '.vaultcms-temp-extract');
  const modified = [];

  try {
    log(`📍 Target directory: ${targetDir}`);
    let zipUrl;
    if (template) {
      const source = resolvePresetsRepo(presetsRepo);
      zipUrl = source.zip;
      if (!source.isDefault) {
        log(`📦 Using custom presets repo: ${source.repo}@${source.branch}`);
      }
    } else {
      zipUrl = MAIN_ZIP;
    }
    log('📦 Downloading archive...');
    await downloadFile(zipUrl, tempZip);

    log('📂 Extracting files...');
    new AdmZip(tempZip).extractAllTo(extractDir, true);

    const items = await fs.readdir(extractDir);
    const folders = items.filter((item) => fs.statSync(path.join(extractDir, item)).isDirectory());
    if (folders.length === 0) {
      throw new Error('Could not find content in the downloaded archive.');
    }

    const innerFolder = path.join(extractDir, folders[0]);
    const sourcePath = template ? path.join(innerFolder, template) : innerFolder;
    if (!(await fs.pathExists(sourcePath))) {
      throw new Error(`Template "${template}" not found in presets repository.`);
    }

    const toKeep = template ? ['_bases', '.obsidian'] : ['_bases', '.obsidian', '_GUIDE.md'];
    for (const item of toKeep) {
      const src = path.join(sourcePath, item);
      const dest = path.join(targetDir, item);
      if (await fs.pathExists(src)) {
        await fs.copy(src, dest, { overwrite: true });
        modified.push(dest);
        log(`✓ Added ${item}`);
      }
    }

    // For preset installs: always fetch _GUIDE.md from main repo (never from preset).
    if (template) {
      try {
        const mainTempZip = path.join(targetDir, 'vaultcms-main-temp.zip');
        const mainExtractDir = path.join(targetDir, '.vaultcms-main-temp-extract');
        await downloadFile(MAIN_ZIP, mainTempZip);
        new AdmZip(mainTempZip).extractAllTo(mainExtractDir, true);

        const mainItems = await fs.readdir(mainExtractDir);
        const mainFolders = mainItems.filter((item) =>
          fs.statSync(path.join(mainExtractDir, item)).isDirectory()
        );
        if (mainFolders.length > 0) {
          const guideSrc = path.join(mainExtractDir, mainFolders[0], '_GUIDE.md');
          if (await fs.pathExists(guideSrc)) {
            const guideDest = path.join(targetDir, '_GUIDE.md');
            await fs.copy(guideSrc, guideDest, { overwrite: true });
            modified.push(guideDest);
            log('✓ Added _GUIDE.md (from main vaultcms repo)');
          }
        }
        await fs.remove(mainTempZip);
        await fs.remove(mainExtractDir);
      } catch (error) {
        log(`⚠️  Could not fetch _GUIDE.md from main repo: ${error.message}`);
      }
    }

    // Path fixups depending on install mode.
    if (template) {
      await fixPresetPaths(targetDir, resolvedProjectRoot, log);
    } else {
      const isRootInstall = path.resolve(targetDir) === path.resolve(resolvedProjectRoot);
      await adjustConfigs(targetDir, isRootInstall, log);
    }

    // .gitignore handling — write at project root when reasonable.
    const gitignorePath = path.join(resolvedProjectRoot, '.gitignore');
    const ignores =
      '\n# Vault CMS / Obsidian\n.obsidian/workspace.json\n.obsidian/workspace-mobile.json\n.ref/\n';
    const isExternalRoot =
      resolvedProjectRoot !== targetDir && !targetDir.startsWith(resolvedProjectRoot);
    let gitignoreAction = 'skipped';
    if (await fs.pathExists(gitignorePath)) {
      const content = await fs.readFile(gitignorePath, 'utf8');
      if (!content.includes('.obsidian/workspace.json')) {
        await fs.appendFile(gitignorePath, ignores);
        modified.push(gitignorePath);
        gitignoreAction = 'updated';
        log(`✓ Updated .gitignore at ${path.relative(process.cwd(), gitignorePath)}`);
      } else {
        gitignoreAction = 'already-configured';
      }
    } else if (!isExternalRoot) {
      await fs.writeFile(gitignorePath, ignores.trim() + '\n');
      modified.push(gitignorePath);
      gitignoreAction = 'created';
      log(`✓ Created .gitignore at ${path.relative(process.cwd(), gitignorePath)}`);
    } else {
      log('⚠️  Skipped .gitignore (could not find a safe project root)');
    }

    return {
      success: true,
      targetDir,
      projectRoot: resolvedProjectRoot,
      template,
      modifiedPaths: modified,
      gitignore: gitignoreAction,
    };
  } finally {
    await fs.remove(tempZip).catch(() => {});
    await fs.remove(extractDir).catch(() => {});
  }
}

/**
 * Rewrite absolute paths in vault-cms data.json to be vault-relative. Run
 * after a preset install since the preset ships with its own absolute paths.
 */
async function fixPresetPaths(targetDir, projectRoot, log = () => {}) {
  const dataJsonPath = path.join(targetDir, '.obsidian', 'plugins', 'vault-cms', 'data.json');
  if (!(await fs.pathExists(dataJsonPath))) return;

  try {
    const data = JSON.parse(await fs.readFile(dataJsonPath, 'utf8'));
    const relativeProjectRoot =
      path.relative(targetDir, projectRoot).split(path.sep).join('/') || '.';
    data.projectRoot = relativeProjectRoot;

    if (data.configFilePath) {
      const oldConfigPath = data.configFilePath.replace(/\\/g, '/');
      const configPatterns = [
        'src/config.ts', 'src/config.js', 'src/config.mjs',
        'astro.config.mjs', 'astro.config.ts', 'astro.config.js',
      ];
      let relativeConfig = null;
      for (const pattern of configPatterns) {
        if (oldConfigPath.endsWith(pattern)) {
          relativeConfig = pattern;
          break;
        }
      }
      if (relativeConfig) {
        const absoluteConfigPath = path.join(projectRoot, relativeConfig);
        data.configFilePath = path
          .relative(targetDir, absoluteConfigPath)
          .split(path.sep)
          .join('/');
      }
    }

    await fs.writeFile(dataJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    log('✓ Updated vault-cms config paths for this project');
  } catch (error) {
    log(`⚠️  Could not fix preset paths: ${error.message}`);
  }
}

/** Post-install: adjust configs based on root vs subfolder install. */
async function adjustConfigs(targetDir, isRootInstall, log = () => {}) {
  if (isRootInstall) {
    log('🔧 Adjusting configs for project root install...');
    await adjustHomeBase(targetDir, log);
    await adjustAppJson(targetDir, log);
    await adjustExplorerFocus(targetDir, {
      showRightClickMenu: true,
      showFileExplorerIcon: true,
      focusLevel: 'custom',
      customFolderPath: 'src/content',
      hideAncestorFolders: false,
    }, log);
    log('✓ Configured for project root install');
  } else {
    await adjustExplorerFocus(targetDir, {
      showRightClickMenu: true,
      showFileExplorerIcon: true,
      focusLevel: 'parent',
      hideAncestorFolders: false,
    }, log);
  }
}

async function adjustHomeBase(targetDir, log = () => {}) {
  const homeBasePath = path.join(targetDir, '_bases', 'Home.base');
  if (!(await fs.pathExists(homeBasePath))) return;

  try {
    let content = await fs.readFile(homeBasePath, 'utf8');
    content = content.replace(
      /file\.ext == "md"/g,
      'file.ext == "md" && file.folder.startsWith("src/content")'
    );
    const folderNames = ['posts', 'pages', 'special', 'projects', 'docs'];
    for (const folder of folderNames) {
      const pattern = new RegExp(`file\\.folder == "${folder}"`, 'g');
      content = content.replace(pattern, `file.folder == "src/content/${folder}"`);
    }
    content = content.replace(/file\.folder == "\/"/g, 'file.folder == ""');
    await fs.writeFile(homeBasePath, content, 'utf8');
  } catch (error) {
    log(`⚠️  Could not adjust Home.base: ${error.message}`);
  }
}

async function adjustAppJson(targetDir, log = () => {}) {
  const appJsonPath = path.join(targetDir, '.obsidian', 'app.json');
  if (!(await fs.pathExists(appJsonPath))) return;

  try {
    const appJson = JSON.parse(await fs.readFile(appJsonPath, 'utf8'));
    appJson.newFileFolderPath = 'src/content';
    appJson.attachmentFolderPath = 'src/content/attachments';
    await fs.writeFile(appJsonPath, JSON.stringify(appJson, null, 2) + '\n', 'utf8');
  } catch (error) {
    log(`⚠️  Could not adjust app.json: ${error.message}`);
  }
}

async function adjustExplorerFocus(targetDir, config, log = () => {}) {
  const dataJsonPath = path.join(targetDir, '.obsidian', 'plugins', 'explorer-focus', 'data.json');

  try {
    await fs.ensureDir(path.dirname(dataJsonPath));
    let existingData = {};
    if (await fs.pathExists(dataJsonPath)) {
      try {
        existingData = JSON.parse(await fs.readFile(dataJsonPath, 'utf8'));
      } catch {
        // start fresh
      }
    }
    const mergedData = { ...existingData, ...config };
    await fs.writeFile(dataJsonPath, JSON.stringify(mergedData, null, 2) + '\n', 'utf8');
  } catch (error) {
    log(`⚠️  Could not adjust Explorer Focus config: ${error.message}`);
  }
}

module.exports = {
  installVaultCms,
  fixPresetPaths,
  adjustConfigs,
  adjustHomeBase,
  adjustAppJson,
  adjustExplorerFocus,
};
