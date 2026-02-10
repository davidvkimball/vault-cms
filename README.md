# Vault CMS

An open-source headless content management system that turns [Obsidian](https://obsidian.md) into a publishing platform for your [Astro](https://astro.build) website.

![Vault CMS cover with Obsidian and Astro logos at the bottom.](https://github.com/user-attachments/assets/fb5d8368-71dd-4bf8-8851-36ada6d4f530)

## Quick Start

The fastest way to install Vault CMS into your Astro project is via the CLI:

```bash
pnpm create vault-cms
```

*Follow the prompts to install into `src/content` or your desired directory.*

## Documentation

For full installation guides, plugin details, and customization options, read the [Vault CMS documentation](https://docs.vaultcms.org).

## Features 

- Easy integration into Astro website projects
- **Auto-detection** of your Astro theme and content structure
- Preconfigured plugins, hotkeys and settings optimized for Astro workflows
- CMS-like homepage using Obsidian Bases
- Works with any Astro theme by automatically detecting content types and frontmatter properties
- Optional instant-publish option via the Git plugin

![Vault CMS Showcase.](https://github.com/user-attachments/assets/0d1ea89e-9d6b-40b1-944d-cfe6143e222e)

## Video Set Up Guide

📺 [Video Guide](https://www.youtube.com/watch?v=3zeqJ5tqmaQ)

> [!NOTE]
> To see Vault CMS combined with an Astro site specifically designed with it in mind, check out my theme [Astro Modular](https://github.com/davidvkimball/astro-modular).

## Presets

If you are using a supported theme like **Starlight**, **Slate**, or **Chiri**, you can use a preconfigured preset:

```bash
pnpm create vault-cms -- --template starlight
```

See all available presets at the [Presets Repo](https://github.com/davidvkimball/vault-cms-presets).
