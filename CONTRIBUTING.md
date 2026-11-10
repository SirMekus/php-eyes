# Contributing

Thanks for helping out. The extension is a single file of plain JavaScript, [src/extension.js](src/extension.js), with no build step and no runtime dependencies.

## Getting started

You need Node.js 20 or later and VS Code.

```sh
git clone https://github.com/SirMekus/php-eyes.git
cd php-eyes
npm install
```

To try your changes, open the folder in VS Code and press **F5**. A second VS Code window (the Extension Development Host) opens with your copy of the extension loaded. Open a PHP project there. Remember that it needs a PHP extension such as Intelephense installed in that window too.

## How it works

1. `provideCodeLenses` asks VS Code for the document's symbols (`vscode.executeDocumentSymbolProvider`), which the installed PHP extension supplies, and creates one lens per allowed symbol.
2. `resolveCodeLens` fills in the count. It shows a cached count when there is one. Otherwise it queues a reference lookup (`vscode.executeReferenceProvider`) and waits.
3. Clicking a lens runs a command registered for that lens alone. It looks up the references again and opens them with `editor.action.showReferences`.

Two things in there are less obvious than they look:

- **Lens commands take no arguments.** VS Code stores a CodeLens command's arguments in a cache and clears it whenever it re-requests lenses. A lens still on screen can then point at a missing entry, and clicking it fails with "Actual command not found". Registering an argument-free command per lens avoids that cache entirely.
- **Lookups go through a queue.** Language servers answer reference requests one at a time. Sending one per visible symbol at once makes every lens wait for all the others.

## Before opening a pull request

```sh
npm run check     # syntax check
npm run package   # builds php-eyes-<version>.vsix
```

Install the built package with `code --install-extension php-eyes-<version>.vsix --force` and test it in a real PHP project. Add a line describing your change under a new heading at the top of [CHANGELOG.md](CHANGELOG.md).

## Releasing

Maintainers only:

1. Bump `version` in `package.json` and move the changelog entries under the new version.
2. Run `npx vsce login sirmekus` once, using a Personal Access Token from Azure DevOps with the **Marketplace (Manage)** scope.
3. Run `npm run publish`.
