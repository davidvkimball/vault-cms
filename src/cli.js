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
  .name('create-vault-cms')
  .description('Official installer for Vault CMS')
  .version(pkg.version);

program
  .argument('[target]', 'target directory')
  .option('-t, --template <name>', 'template to use (from vault-cms-presets)')
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
          message: 'Would you like to use a preset template (e.g. Starlight, Slate)?',
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

      if (!targetPath) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'path',
            message: 'Where should we install Vault CMS?',
            default: 'src/content',
          }
        ]);
        targetPath = answers.path;
      }

      const targetDir = path.resolve(targetPath);
      const tempZip = path.join(targetDir, 'vault-cms-temp.zip');
      const extractDir = path.join(targetDir, '.vault-cms-temp-extract');

      const repoName = template ? 'vault-cms-presets' : 'vault-cms';
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

      // Smart .gitignore logic: Look for project root
      const projectRoot = await findProjectRoot(targetDir);
      const gitignorePath = path.join(projectRoot, '.gitignore');
      const ignores = '\n# Vault CMS / Obsidian\n.obsidian/workspace.json\n.obsidian/workspace-mobile.json\n.ref/\n';

      const isExternalRoot = projectRoot !== targetDir && !targetDir.startsWith(projectRoot);

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

      if (projectRoot === targetDir) {
        console.log('\n  ⚠️  Note: No Astro project or package.json found in parent directories.');
        console.log('     Installation completed, but you may need to move these files into your content folder manually.');
      }

      console.log('\n✨ Vault CMS is ready!');

      const { openObsidian } = await inquirer.prompt([{
        type: 'confirm',
        name: 'openObsidian',
        message: 'Would you like to open this folder in Obsidian now?',
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
  // Obsidian URIs require forward slashes
  const normalizedPath = targetPath.replace(/\\/g, '/');

  // Adding a trailing slash often helps Obsidian recognize it as a folder/vault
  const folderUri = `obsidian://open?path=${encodeURIComponent(normalizedPath + '/')}`;

  const anchors = [
    path.join('_bases', 'Home.base'),
    '_GUIDE.md'
  ];

  let anchorFile = '';
  for (const a of anchors) {
    if (await fs.pathExists(path.join(targetPath, a))) {
      anchorFile = a;
      break;
    }
  }

  const fileUri = anchorFile
    ? `obsidian://open?path=${encodeURIComponent(normalizedPath + '/' + anchorFile.replace(/\\/g, '/'))}`
    : folderUri;

  return new Promise((resolve) => {
    const command = process.platform === 'win32'
      ? `start "" "${fileUri}"`
      : process.platform === 'darwin'
        ? `open "${fileUri}"`
        : `xdg-open "${fileUri}"`;

    console.log(`  📂 Opening Obsidian: ${fileUri}`);

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

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'vault-cms-installer' } }, (res) => {
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
    const url = 'https://api.github.com/repos/davidvkimball/vault-cms-presets/contents';
    https.get(url, { headers: { 'User-Agent': 'vault-cms-installer' } }, (res) => {
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
          resolve(['starlight', 'slate', 'chiri']);
        }
      });
    }).on('error', () => resolve(['starlight', 'slate', 'chiri']));
  });
}

program.parse();
