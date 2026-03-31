# Applyron Manager

Desktop manager for Antigravity and VS Code Codex.

Applyron Manager brings account switching, quota visibility, proxy routing, update awareness, and workspace automation into a single desktop app for:

- `antigravity`
- `vscode-codex`

For the Turkish version of this document, see [README.tr.md](README.tr.md).

## Features

- Manage multiple Antigravity accounts and local backups from one desktop UI.
- Monitor VS Code Codex installation status, sessions, and quota snapshots.
- Run a local OpenAI/Anthropic-compatible proxy with configurable routing.
- Track update state, service health, and dashboard announcements in-app.
- Preserve compatibility with legacy Antigravity storage locations while using Applyron Manager branding for new local data.

## Requirements

- Node.js 22 or newer
- npm
- Windows is recommended for full feature coverage
- VS Code Codex integration currently targets Windows stable VS Code with the official `openai.chatgpt` extension

## Development

Install dependencies and start the Electron app in development mode:

```bash
npm install
npm start
```

Common quality gates:

```bash
npm run lint
npm run format
npm run type-check
npm test
```

Packaged Electron smoke tests:

```bash
npm run package:e2e
npm run test:e2e
```

Platform packaging requires the platform-specific maker toolchain:

```bash
npm run install:release-tools -- --platform=win32 --arch=x64
npm run make -- --platform=win32 --arch=x64
```

On Windows, the primary distribution path is the Squirrel `Setup.exe` package. MSI output is optional and only generated when the required packaging toolchain is available.

## Update Behavior

- Packaged Windows and macOS builds support the managed in-app update flow.
- Linux builds remain manual-update only.
- Development builds do not use the production updater flow.

Internal infrastructure details, deployment hosts, and environment-specific configuration are intentionally omitted from this public README.

## Repository Automation

The repository includes automated workflows for:

- lint and formatting checks
- unit test validation
- packaged smoke validation
- release automation
- publish and update distribution

The exact infrastructure configuration, deployment credentials, and environment wiring are intentionally kept out of this public document.

## Dashboard Announcements

Dashboard announcements are sourced from `deploy/announcements.json` and published by the release pipeline.

Each announcement item must contain:

- `id`
- `publishedAt`
- `level`
- `url`
- localized `title`
- localized `body`

Example shape:

```json
{
  "announcements": [
    {
      "id": "release-2026-03-25",
      "publishedAt": "2026-03-25T12:00:00Z",
      "level": "info",
      "url": "https://example.com/release-notes",
      "title": {
        "tr": "Baslik",
        "en": "Title"
      },
      "body": {
        "tr": "Icerik",
        "en": "Body"
      }
    }
  ]
}
```

## Screenshots

![Applyron Manager dashboard](docs/assets/screenshot-main.png)

## License

This repository is licensed under `CC-BY-NC-SA-4.0`. See [LICENSE](LICENSE).
