# Vault CMS

The open-source headless content management system that turns [Obsidian](https://obsidian.md) into a publishing platform for your [Astro](https://astro.build) website.

![Vault CMS cover with Obsidian and Astro logos at the bottom.](https://github.com/user-attachments/assets/fb5d8368-71dd-4bf8-8851-36ada6d4f530)

## Features 

- **Auto-detection and automation**: Understands your content structure and lets you focus on writing.
- **CMS-like homepage**: See your content in a visual grid and perform bulk actions.
- **Preconfigured**: Optimized settings, hotkeys, and plugins for the Astro workflow.
- **Headless and flexible**: Just Markdown files and a workspace ready to be customized by you.
- **Compatability**: Works with almost any Astro theme.

## Quick Start

The fastest way to install Vault CMS into your Astro project is via the CLI at your project root:

```bash
pnpm create vault-cms
```

*Follow the prompts to install into `src/content` or your desired sub-directory.*

### Manual Installation

If you prefer to install manually, you can download the latest version of Vault CMS and place it directly into your Astro project.

1. **Download the source**: [Clone this repository](https://github.com/davidvkimball/vault-cms) or [download the ZIP archive](https://github.com/davidvkimball/vault-cms/archive/refs/heads/master.zip).
2. **Locate your content directory**: In most Astro projects, this is `src/content`.
3. **Move the files**: Copy the `.obsidian` and `_bases` folders (and `_GUIDE.md`) from the Vault CMS source into your content directory.
4. **Open in Obsidian**: Open the content directory as a new vault in Obsidian.

### Presets

If you are using a supported theme like **Starlight**, **Slate**, or **Chiri**, you can use a preconfigured preset:

```bash
pnpm create vault-cms -- --template starlight
```

See all available presets at the [Presets Repo](https://github.com/davidvkimball/vault-cms-presets).

## Deep Dive

- **Documentation**: [docs.vaultcms.org](https://docs.vaultcms.org)
- **Video Guide**: [Set Up Guide on YouTube](https://www.youtube.com/watch?v=3zeqJ5tqmaQ)
- **Community**: [Join the Discord](https://discord.gg/gyrNHAwHK8)

> [!NOTE]
> To see Vault CMS combined with an Astro site specifically designed with it in mind, check out the [Astro Modular](https://github.com/davidvkimball/astro-modular) theme.

![Vault CMS Showcase.](https://github.com/user-attachments/assets/0d1ea89e-9d6b-40b1-944d-cfe6143e222e)
