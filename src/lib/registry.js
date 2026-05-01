/**
 * Preset registry + archive download helpers. No console output — callers
 * decide how to surface progress.
 */

const fs = require('fs-extra');
const https = require('https');

const PRESETS_REPO_API = 'https://api.github.com/repos/davidvkimball/vaultcms-presets/contents';
const PRESETS_MANIFEST = 'https://raw.githubusercontent.com/davidvkimball/vaultcms-presets/master/manifest.json';
const PRESETS_ZIP = 'https://github.com/davidvkimball/vaultcms-presets/archive/refs/heads/master.zip';
const MAIN_ZIP = 'https://github.com/davidvkimball/vaultcms/archive/refs/heads/master.zip';
const FALLBACK_TEMPLATES = ['chiri', 'slate', 'starlight'];

const USER_AGENT = 'vaultcms-installer';

/** Fetch the list of preset directories from the GitHub contents API. */
function fetchTemplates() {
  return new Promise((resolve) => {
    https
      .get(PRESETS_REPO_API, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const contents = JSON.parse(data);
            const dirs = Array.isArray(contents)
              ? contents
                  .filter((item) => item.type === 'dir' && !item.name.startsWith('.'))
                  .map((item) => item.name)
              : FALLBACK_TEMPLATES;
            resolve(dirs);
          } catch {
            resolve(FALLBACK_TEMPLATES);
          }
        });
      })
      .on('error', () => resolve(FALLBACK_TEMPLATES));
  });
}

/** Fetch the typed manifest.json for presets — preferred over name-only listing. */
function fetchPresetManifest() {
  return new Promise((resolve) => {
    https
      .get(PRESETS_MANIFEST, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      })
      .on('error', () => resolve(null));
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
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
      })
      .on('error', reject);
  });
}

module.exports = {
  PRESETS_REPO_API,
  PRESETS_MANIFEST,
  PRESETS_ZIP,
  MAIN_ZIP,
  FALLBACK_TEMPLATES,
  fetchTemplates,
  fetchPresetManifest,
  downloadFile,
};
