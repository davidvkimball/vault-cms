#!/usr/bin/env node

const { Command } = require('commander');
const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const AdmZip = require('adm-zip');
const inquirer = require('inquirer');
const { exec } = require('child_process');

const pkg = require('../package.json');

const program = new Command();

program
  .name('create-vaultcms')
  .description('Official installer for Vault CMS')
  .version(pkg.version);

program
  .argument('[target]', 'target directory')
  .option('-t, --template <name>', 'template to use (from vaultcms-presets)')
  .action(async (target, options) => {
    try {
      console.log('🚀 Initializing Vault CMS Installer...');

      const availableTemplates = await fetchTemplates();

      let template = options.template;
      let targetPath = target;

      if (targetPath && availableTemplates.includes(targetPath.toLowerCase()) && !template) {
        template = targetPath.toLowerCase();
        targetPath = null;
      }

      if (!template) {
        const { useTemplate } = await inquirer.prompt([{
          type: 'confirm',
          name: 'useTemplate',
          message: 'Would you like to use a preset template (e.g. Chiri, Starlight)?',
          default: false
        }]);

        if (useTemplate) {
          const { selectedTemplate } = await inquirer.prompt([{
            type: 'list',
            name: 'selectedTemplate',
            message: 'Select a template:',
            choices: availableTemplates
          }]);
          template = selectedTemplate;
        }
      }

      // Always default to project root — presets are configured for root installs
      const defaultInstallPath = '.';

      if (!targetPath) {
        // When no target specified, detect from cwd for the interactive prompt
        const cwd = process.cwd();
        const detectionBase = path.resolve(cwd);
        const projectRoot = await findProjectRoot(detectionBase);
        const isAstroProject = await isAstroProjectDir(projectRoot);
        const detectedRoutes = isAstroProject ? await detectAstroRoutes(projectRoot) : [];

        if (isAstroProject && !template) {
          console.log(`\n📂 Detected Astro project at ${projectRoot}`);

          // Show detected content collections
          const contentDir = path.join(projectRoot, 'src', 'content');
          if (await fs.pathExists(contentDir)) {
            const collections = (await fs.readdir(contentDir))
              .filter(item => {
                try {
                  return fs.statSync(path.join(contentDir, item)).isDirectory();
                } catch { return false; }
              });
            if (collections.length > 0) {
              console.log(`   Found content collections: ${collections.join(', ')}`);
            }
          }

          // Show detected routes
          if (detectedRoutes.length > 0) {
            console.log('\n📍 Route detection:');
            for (const route of detectedRoutes) {
              console.log(`   ${route.collection.padEnd(12)} →  ${route.urlPrefix.padEnd(10)} (from ${route.sourceFile})`);
            }
          }

          console.log('\n📂 Installing at project root (.) ensures all images and assets');
          console.log('   display correctly in Obsidian.\n');
        }

        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'path',
            message: 'Where should we install Vault CMS? (use . for current folder)',
            default: defaultInstallPath,
          }
        ]);
        targetPath = answers.path;
      }

      const targetDir = path.resolve(targetPath);
      const tempZip = path.join(targetDir, 'vaultcms-temp.zip');
      const extractDir = path.join(targetDir, '.vaultcms-temp-extract');

      // Detect project from the actual resolved target directory
      const resolvedProjectRoot = await findProjectRoot(targetDir);
      const targetIsAstroProject = await isAstroProjectDir(resolvedProjectRoot);

      // Show route detection if target was provided as argument (skipped the prompt)
      if (target && targetIsAstroProject && !template) {
        const detectedRoutes = await detectAstroRoutes(resolvedProjectRoot);
        console.log(`\n📂 Detected Astro project at ${resolvedProjectRoot}`);

        const contentDir = path.join(resolvedProjectRoot, 'src', 'content');
        if (await fs.pathExists(contentDir)) {
          const collections = (await fs.readdir(contentDir))
            .filter(item => {
              try {
                return fs.statSync(path.join(contentDir, item)).isDirectory();
              } catch { return false; }
            });
          if (collections.length > 0) {
            console.log(`   Found content collections: ${collections.join(', ')}`);
          }
        }

        if (detectedRoutes.length > 0) {
          console.log('\n📍 Route detection:');
          for (const route of detectedRoutes) {
            console.log(`   ${route.collection.padEnd(12)} →  ${route.urlPrefix.padEnd(10)} (from ${route.sourceFile})`);
          }
        }
      }

      const repoName = template ? 'vaultcms-presets' : 'vaultcms';
      const zipUrl = `https://github.com/davidvkimball/${repoName}/archive/refs/heads/master.zip`;

      console.log(`\n🚀 Installing Vault CMS${template ? ` (template: ${template})` : ''}...`);
      console.log(`  📍 Target directory: ${targetDir}`);

      await fs.ensureDir(targetDir);

      console.log('  📦 Downloading archive...');
      await downloadFile(zipUrl, tempZip);

      console.log('  📂 Extracting files...');
      const zip = new AdmZip(tempZip);
      zip.extractAllTo(extractDir, true);

      const items = await fs.readdir(extractDir);
      const folders = items.filter(item => fs.statSync(path.join(extractDir, item)).isDirectory());

      if (folders.length === 0) {
        throw new Error('Could not find content in the downloaded archive.');
      }

      const innerFolder = path.join(extractDir, folders[0]);
      const sourcePath = template ? path.join(innerFolder, template) : innerFolder;

      if (!(await fs.pathExists(sourcePath))) {
        throw new Error(`Template "${template}" not found in presets repository.`);
      }

      const toKeep = ['_bases', '.obsidian', '_GUIDE.md'];
      for (const item of toKeep) {
        const src = path.join(sourcePath, item);
        const dest = path.join(targetDir, item);

        if (await fs.pathExists(src)) {
          await fs.copy(src, dest, { overwrite: true });
          console.log(`  ✓ Added ${item}`);
        }
      }

      // For preset installs: fetch _GUIDE.md from main repo if preset didn't include it
      if (template && !(await fs.pathExists(path.join(targetDir, '_GUIDE.md')))) {
        try {
          const mainZipUrl = 'https://github.com/davidvkimball/vaultcms/archive/refs/heads/master.zip';
          const mainTempZip = path.join(targetDir, 'vaultcms-main-temp.zip');
          const mainExtractDir = path.join(targetDir, '.vaultcms-main-temp-extract');

          await downloadFile(mainZipUrl, mainTempZip);
          const mainZip = new AdmZip(mainTempZip);
          mainZip.extractAllTo(mainExtractDir, true);

          const mainItems = await fs.readdir(mainExtractDir);
          const mainFolders = mainItems.filter(item => fs.statSync(path.join(mainExtractDir, item)).isDirectory());

          if (mainFolders.length > 0) {
            const mainInner = path.join(mainExtractDir, mainFolders[0]);
            const guideSrc = path.join(mainInner, '_GUIDE.md');
            if (await fs.pathExists(guideSrc)) {
              await fs.copy(guideSrc, path.join(targetDir, '_GUIDE.md'), { overwrite: true });
              console.log('  ✓ Added _GUIDE.md (from main repo)');
            }
          }

          await fs.remove(mainTempZip);
          await fs.remove(mainExtractDir);
        } catch (error) {
          console.warn(`  ⚠️  Could not fetch _GUIDE.md from main repo: ${error.message}`);
        }
      }

      // For preset installs: fix absolute paths in vault-cms data.json
      if (template) {
        await fixPresetPaths(targetDir, resolvedProjectRoot);
      } else {
        // Non-preset installs: adjust configs based on install location
        const isRootInstall = path.resolve(targetDir) === path.resolve(resolvedProjectRoot);
        await adjustConfigs(targetDir, isRootInstall);
      }

      // Smart .gitignore logic: Look for project root
      const gitignorePath = path.join(resolvedProjectRoot, '.gitignore');
      const ignores = '\n# Vault CMS / Obsidian\n.obsidian/workspace.json\n.obsidian/workspace-mobile.json\n.ref/\n';

      const isExternalRoot = resolvedProjectRoot !== targetDir && !targetDir.startsWith(resolvedProjectRoot);

      if (await fs.pathExists(gitignorePath)) {
        const content = await fs.readFile(gitignorePath, 'utf8');
        if (!content.includes('.obsidian/workspace.json')) {
          await fs.appendFile(gitignorePath, ignores);
          console.log(`  ✓ Updated .gitignore at ${path.relative(process.cwd(), gitignorePath)}`);
        }
      } else if (!isExternalRoot) {
        await fs.writeFile(gitignorePath, ignores.trim() + '\n');
        console.log(`  ✓ Created .gitignore at ${path.relative(process.cwd(), gitignorePath)}`);
      } else {
        console.log(`  ⚠️  Skipped .gitignore (could not find a safe project root)`);
      }

      await fs.remove(tempZip);
      await fs.remove(extractDir);

      if (!targetIsAstroProject) {
        console.log('\n  ⚠️  Note: No Astro project found at or above the target directory.');
        console.log('     Installation completed, but you may need to move these files into your content folder manually.');
      }

      console.log('\n✨ Vault CMS is ready!');

      const { openObsidian } = await inquirer.prompt([{
        type: 'confirm',
        name: 'openObsidian',
        message: 'Would you like to open Obsidian and add this folder as a vault?',
        default: true
      }]);

      if (openObsidian) {
        await openInObsidian(targetDir);
      }

      process.exit(0);
    } catch (err) {
      console.error('\n❌ Installation failed:', err.message);
      process.exit(1);
    }
  });

async function openInObsidian(targetPath) {
  const obsidianUri = 'obsidian://choose-vault';

  return new Promise((resolve) => {
    const command = process.platform === 'win32'
      ? `start "" "${obsidianUri}"`
      : process.platform === 'darwin'
        ? `open "${obsidianUri}"`
        : `xdg-open "${obsidianUri}"`;

    console.log(`\n  📂 Opening Obsidian Vault Manager...`);
    console.log(`  📍 Action: Click "Open folder as vault" and select:`);
    console.log(`     ${targetPath}\n`);

    exec(command, (error) => {
      if (error) {
        console.error(`  ❌ Failed to open Obsidian: ${error.message}`);
      }
      resolve();
    });
  });
}

async function findProjectRoot(startDir) {
  let current = startDir;
  // Look up to 6 levels up for a project root (Astro config, package.json, or .git)
  let depth = 0;
  while (current !== path.parse(current).root && depth < 6) {
    const hasPkg = await fs.pathExists(path.join(current, 'package.json'));
    const hasAstro = await fs.pathExists(path.join(current, 'astro.config.mjs')) || await fs.pathExists(path.join(current, 'astro.config.ts'));
    const hasGit = await fs.pathExists(path.join(current, '.git'));

    if (hasPkg || hasAstro || hasGit) return current;

    current = path.dirname(current);
    depth++;
  }
  return startDir; // Fallback to target dir
}

/**
 * Check if a directory is an Astro project root by looking for config files.
 */
async function isAstroProjectDir(dir) {
  const astroConfigNames = [
    'astro.config.mjs', 'astro.config.ts', 'astro.config.js',
    'astro.config.mts', 'astro.config.cjs'
  ];
  for (const name of astroConfigNames) {
    if (await fs.pathExists(path.join(dir, name))) return true;
  }
  return false;
}

/**
 * Scan src/pages/ for dynamic route files ([...slug].astro, [slug].astro)
 * and map them to content collection URL prefixes.
 */
async function detectAstroRoutes(projectRoot) {
  const pagesDir = path.join(projectRoot, 'src', 'pages');
  const contentDir = path.join(projectRoot, 'src', 'content');
  const routes = [];

  if (!(await fs.pathExists(pagesDir))) return routes;

  // Get content collection names for cross-referencing
  let collections = [];
  if (await fs.pathExists(contentDir)) {
    collections = (await fs.readdir(contentDir))
      .filter(item => {
        try {
          return fs.statSync(path.join(contentDir, item)).isDirectory();
        } catch { return false; }
      });
  }

  // Recursively scan src/pages/ for dynamic route files
  await scanPagesDir(pagesDir, pagesDir, collections, routes);

  return routes;
}

/**
 * Recursively scan a directory within src/pages/ for dynamic route files.
 */
async function scanPagesDir(dir, pagesRoot, collections, routes) {
  const items = await fs.readdir(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {
      // Recurse into subdirectories (skip dynamic dirs like [slug])
      if (!item.startsWith('[')) {
        await scanPagesDir(fullPath, pagesRoot, collections, routes);
      }
    } else if (item.match(/^\[\.\.\..*\]\.(astro|ts|js)$/) || item.match(/^\[.*\]\.(astro|ts|js)$/)) {
      // Found a dynamic route file like [...slug].astro or [slug].astro
      const relativeDirPath = path.relative(pagesRoot, dir);
      const urlPrefix = relativeDirPath === '' ? '/' : `/${relativeDirPath.replace(/\\/g, '/')}/`;
      const relativeFilePath = path.relative(pagesRoot, fullPath).replace(/\\/g, '/');

      // Try to match this route to a content collection
      // The directory name often matches the collection name
      const dirName = path.basename(dir);
      const matchedCollection = dirName === path.basename(pagesRoot)
        ? null // Top-level catch-all, could match multiple collections
        : collections.find(c => c.toLowerCase() === dirName.toLowerCase());

      if (matchedCollection) {
        routes.push({
          collection: matchedCollection,
          urlPrefix: urlPrefix,
          sourceFile: `src/pages/${relativeFilePath}`
        });
      } else if (relativeDirPath === '') {
        // Top-level catch-all — try to find collections that don't have dedicated routes
        // Common pattern: pages collection renders at root
        const routedCollections = routes.map(r => r.collection);
        const unroutedCollections = collections.filter(c => !routedCollections.includes(c));

        // "pages" collection at root is the most common pattern
        const pagesCollection = unroutedCollections.find(c => c.toLowerCase() === 'pages');
        if (pagesCollection) {
          routes.push({
            collection: pagesCollection,
            urlPrefix: '/',
            sourceFile: `src/pages/${relativeFilePath}`
          });
        }
      }
    }
  }
}

/**
 * Fix absolute paths in preset's vault-cms data.json after install.
 * Replaces hardcoded projectRoot and configFilePath with the actual target paths.
 */
async function fixPresetPaths(targetDir, projectRoot) {
  const dataJsonPath = path.join(targetDir, '.obsidian', 'plugins', 'vault-cms', 'data.json');
  if (!(await fs.pathExists(dataJsonPath))) return;

  try {
    const data = JSON.parse(await fs.readFile(dataJsonPath, 'utf8'));

    // Set projectRoot to the actual project root
    data.projectRoot = projectRoot;

    // Fix configFilePath: preserve the relative portion (e.g. src/config.ts or astro.config.mjs)
    if (data.configFilePath) {
      // Extract just the filename or relative path from the old absolute path
      const oldConfigPath = data.configFilePath.replace(/\\/g, '/');
      // Look for common config file patterns
      const configPatterns = [
        'src/config.ts', 'src/config.js', 'src/config.mjs',
        'astro.config.mjs', 'astro.config.ts', 'astro.config.js'
      ];
      let relativeConfig = null;
      for (const pattern of configPatterns) {
        if (oldConfigPath.endsWith(pattern)) {
          relativeConfig = pattern;
          break;
        }
      }
      if (relativeConfig) {
        data.configFilePath = path.join(projectRoot, relativeConfig);
      }
    }

    await fs.writeFile(dataJsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log('  ✓ Updated vault-cms config paths for this project');
  } catch (error) {
    console.warn(`  ⚠️  Could not fix preset paths: ${error.message}`);
  }
}

/**
 * Post-install: adjust configs based on whether this is a root install or subfolder install.
 */
async function adjustConfigs(targetDir, isRootInstall) {
  if (isRootInstall) {
    console.log('  🔧 Adjusting configs for project root install...');

    // 1. Update Home.base formulas to use src/content/ prefixed paths
    await adjustHomeBase(targetDir);

    // 2. Update app.json for root install
    await adjustAppJson(targetDir);

    // 3. Set Explorer Focus to custom with src/content
    await adjustExplorerFocus(targetDir, {
      showRightClickMenu: true,
      showFileExplorerIcon: true,
      focusLevel: 'custom',
      customFolderPath: 'src/content',
      hideAncestorFolders: false
    });

    console.log('  ✓ Configured for project root install');
  } else {
    // Non-root install: reset Explorer Focus to default (parent mode)
    await adjustExplorerFocus(targetDir, {
      showRightClickMenu: true,
      showFileExplorerIcon: true,
      focusLevel: 'parent',
      hideAncestorFolders: false
    });
  }
}

/**
 * Update Home.base formulas for root-relative paths.
 * Changes folder references from "posts" to "src/content/posts" etc.
 */
async function adjustHomeBase(targetDir) {
  const homeBasePath = path.join(targetDir, '_bases', 'Home.base');
  if (!(await fs.pathExists(homeBasePath))) return;

  try {
    let content = await fs.readFile(homeBasePath, 'utf8');

    // Update the global filter to scope to src/content
    content = content.replace(
      /file\.ext == "md"/g,
      'file.ext == "md" && file.folder.startsWith("src/content")'
    );

    // Update folder references in formulas: "posts" -> "src/content/posts", etc.
    const folderNames = ['posts', 'pages', 'special', 'projects', 'docs'];
    for (const folder of folderNames) {
      // Match file.folder == "folder" pattern (with both quote styles)
      const pattern = new RegExp(`file\\.folder == "${folder}"`, 'g');
      content = content.replace(pattern, `file.folder == "src/content/${folder}"`);
    }

    // Update the view filter for root folder scope
    content = content.replace(
      /file\.folder == "\/"/g,
      'file.folder == ""'
    );

    await fs.writeFile(homeBasePath, content, 'utf8');
  } catch (error) {
    console.warn(`  ⚠️  Could not adjust Home.base: ${error.message}`);
  }
}

/**
 * Update app.json for root install.
 */
async function adjustAppJson(targetDir) {
  const appJsonPath = path.join(targetDir, '.obsidian', 'app.json');
  if (!(await fs.pathExists(appJsonPath))) return;

  try {
    const appJson = JSON.parse(await fs.readFile(appJsonPath, 'utf8'));

    // Point new file creation to src/content
    appJson.newFileFolderPath = 'src/content';

    // Point attachments to src/content/attachments
    appJson.attachmentFolderPath = 'src/content/attachments';

    await fs.writeFile(appJsonPath, JSON.stringify(appJson, null, 2) + '\n', 'utf8');
  } catch (error) {
    console.warn(`  ⚠️  Could not adjust app.json: ${error.message}`);
  }
}

/**
 * Update Explorer Focus data.json config.
 */
async function adjustExplorerFocus(targetDir, config) {
  const dataJsonPath = path.join(targetDir, '.obsidian', 'plugins', 'explorer-focus', 'data.json');

  try {
    await fs.ensureDir(path.dirname(dataJsonPath));

    let existingData = {};
    if (await fs.pathExists(dataJsonPath)) {
      try {
        existingData = JSON.parse(await fs.readFile(dataJsonPath, 'utf8'));
      } catch {
        // Start fresh if parse fails
      }
    }

    const mergedData = { ...existingData, ...config };
    await fs.writeFile(dataJsonPath, JSON.stringify(mergedData, null, 2) + '\n', 'utf8');
  } catch (error) {
    console.warn(`  ⚠️  Could not adjust Explorer Focus config: ${error.message}`);
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'vaultcms-installer' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download: ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', reject);
  });
}

function fetchTemplates() {
  return new Promise((resolve) => {
    const url = 'https://api.github.com/repos/davidvkimball/vaultcms-presets/contents';
    https.get(url, { headers: { 'User-Agent': 'vaultcms-installer' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const contents = JSON.parse(data);
          const dirs = contents
            .filter(item => item.type === 'dir' && !item.name.startsWith('.'))
            .map(item => item.name);
          resolve(dirs);
        } catch (e) {
          resolve(['chiri', 'slate', 'starlight']);
        }
      });
    }).on('error', () => resolve(['chiri', 'slate', 'starlight']));
  });
}

program.parse();
