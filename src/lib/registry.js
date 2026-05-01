/**
 * Preset registry + archive download helpers. No console output — callers
 * decide how to surface progress.
 *
 * The presets repo defaults to davidvkimball/vaultcms-presets but can be
 * overridden in three converging ways (priority order):
 *   1. Explicit override passed by the caller (e.g. CLI flag, MCP arg)
 *   2. VAULTCMS_PRESETS_REPO env var
 *   3. Default constant
 *
 * The override syntax is `owner/repo` or `owner/repo@branch`. Branch defaults
 * to `master`. This lets community / private fork users point at their own
 * preset bundles without forking the installer.
 */

const fs = require('fs-extra');
const https = require('https');

const DEFAULT_PRESETS_REPO = 'davidvkimball/vaultcms-presets';
const DEFAULT_BRANCH = 'master';
const MAIN_ZIP = 'https://github.com/davidvkimball/vaultcms/archive/refs/heads/master.zip';
const FALLBACK_TEMPLATES = ['chiri', 'slate', 'starlight'];

const USER_AGENT = 'vaultcms-installer';

/**
 * Resolve a presets-repo override string (or env / default) into the URLs
 * needed to read its manifest, list its directories, and download its zip.
 * Throws on malformed input — the caller surfaces the error to the user.
 *
 * @param {string} [override]  "owner/repo" or "owner/repo@branch"
 */
function resolvePresetsRepo(override) {
  const raw = (override || process.env.VAULTCMS_PRESETS_REPO || DEFAULT_PRESETS_REPO).trim();
  const atIndex = raw.indexOf('@');
  const repo = atIndex >= 0 ? raw.slice(0, atIndex) : raw;
  const branch = atIndex >= 0 ? raw.slice(atIndex + 1) : DEFAULT_BRANCH;

  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error(
      `Invalid presets repo "${raw}". Expected "owner/repo" or "owner/repo@branch".`
    );
  }
  if (!/^[\w.\-/]+$/.test(branch)) {
    throw new Error(`Invalid presets branch "${branch}".`);
  }

  const branchEnc = encodeURIComponent(branch);
  return {
    raw,
    repo,
    branch,
    isDefault: repo === DEFAULT_PRESETS_REPO && branch === DEFAULT_BRANCH,
    api: `https://api.github.com/repos/${repo}/contents?ref=${branchEnc}`,
    manifest: `https://raw.githubusercontent.com/${repo}/${branchEnc}/manifest.json`,
    zip: `https://github.com/${repo}/archive/refs/heads/${branchEnc}.zip`,
  };
}

/** Fetch the list of preset directories from the GitHub contents API. */
function fetchTemplates(override) {
  let source;
  try {
    source = resolvePresetsRepo(override);
  } catch {
    return Promise.resolve(FALLBACK_TEMPLATES);
  }
  return new Promise((resolve) => {
    https
      .get(source.api, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const contents = JSON.parse(data);
            const dirs = Array.isArray(contents)
              ? contents
                  .filter((item) => item.type === 'dir' && !item.name.startsWith('.'))
                  .map((item) => item.name)
              : source.isDefault ? FALLBACK_TEMPLATES : [];
            resolve(dirs);
          } catch {
            resolve(source.isDefault ? FALLBACK_TEMPLATES : []);
          }
        });
      })
      .on('error', () => resolve(source.isDefault ? FALLBACK_TEMPLATES : []));
  });
}

/** Fetch the typed manifest.json for presets — preferred over name-only listing. */
function fetchPresetManifest(override) {
  let source;
  try {
    source = resolvePresetsRepo(override);
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    https
      .get(source.manifest, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
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
  DEFAULT_PRESETS_REPO,
  DEFAULT_BRANCH,
  MAIN_ZIP,
  FALLBACK_TEMPLATES,
  resolvePresetsRepo,
  fetchTemplates,
  fetchPresetManifest,
  downloadFile,
};
