#!/usr/bin/env node

const { Command } = require('commander');
const fs = require('fs-extra');
const path = require('path');
const inquirer = require('inquirer');
const { exec } = require('child_process');

const pkg = require('../package.json');
const {
  findProjectRoot,
  isAstroProjectDir,
  detectAstroRoutes,
} = require('./lib/detection');
const { fetchTemplates, fetchPresetManifest } = require('./lib/registry');
const { installVaultCms } = require('./lib/installer');

const program = new Command();

program
  .name('create-vaultcms')
  .description('Official installer for Vault CMS')
  .version(pkg.version);

program
  .allowExcessArguments(true)
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

      // Default: src/content when Astro project detected or preset specifies it, . for root fallback
      let defaultInstallPath = '.';

      if (!targetPath) {
        // When template selected, use manifest install target and skip path prompt
        if (template) {
          const manifest = await fetchPresetManifest();
          const presetConfig = manifest?.presets?.[template.toLowerCase()];
          targetPath = presetConfig?.installTarget || 'src/content';
        } else {
          // No template: detect from cwd, then prompt for path
          const cwd = process.cwd();
          const detectionBase = path.resolve(cwd);
          const projectRoot = await findProjectRoot(detectionBase);
          const isAstroProject = await isAstroProjectDir(projectRoot);
          const detectedRoutes = isAstroProject ? await detectAstroRoutes(projectRoot) : [];

          if (isAstroProject) {
            defaultInstallPath = 'src/content';
            console.log(`\n📂 Detected Astro project at ${projectRoot}`);

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

            if (detectedRoutes.length > 0) {
              console.log('\n📍 Route detection:');
              for (const route of detectedRoutes) {
                console.log(`   ${route.collection.padEnd(12)} →  ${route.urlPrefix.padEnd(10)} (from ${route.sourceFile})`);
              }
            }

            console.log('\n📂 Default install target: src/content (use . for project root)\n');
          }

          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'path',
              message: 'Where should we install Vault CMS? (src/content or . for root)',
              default: defaultInstallPath,
            }
          ]);
          targetPath = answers.path;
        }
      }

      const targetDir = path.resolve(targetPath);

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

      console.log(`\n🚀 Installing Vault CMS${template ? ` (template: ${template})` : ''}...`);

      // Lib's log lines are unprefixed; the CLI adds the conventional 2-space indent
      // to keep the output identical to the previous version.
      const log = (msg) => console.log(`  ${msg}`);
      const result = await installVaultCms({
        targetDir,
        template,
        projectRoot: resolvedProjectRoot,
        log,
      });

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
        await openInObsidian(result.targetDir);
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

program.parse();
