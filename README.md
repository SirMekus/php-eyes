# PHP Eyes

Shows a clickable **"N references"** hint above PHP classes, interfaces, enums, methods and functions, the way VS Code already does for TypeScript. Click it to peek at every place the symbol is used.

```php
    3 references
    public function execute(User $user): BankAccount
    {
```

PHP extensions that offer this CodeLens usually keep it behind a premium licence. PHP Eyes adds it for free on top of whichever PHP extension you already use.

## Requirements

You need a PHP extension that supports **Find All References** (Shift+F12). Any of these will do, including their free versions:

- [PHP Intelephense](https://marketplace.visualstudio.com/items?itemName=bmewburn.vscode-intelephense-client)
- [PHP by DEVSENSE](https://marketplace.visualstudio.com/items?itemName=DEVSENSE.phptools-vscode)
- [Phpactor](https://marketplace.visualstudio.com/items?itemName=phpactor.vscode-phpactor)

PHP Eyes doesn't parse or index your code itself. It asks that extension for the symbols in each file and for their references, then shows the count. **If Shift+F12 finds a usage, the lens counts it. If Shift+F12 misses it, so does the lens.**

## Usage

Install the extension and open a PHP file. The counts show up above each symbol after the PHP extension finishes indexing your workspace.

- **Click** "N references" to open the references peek. The list is looked up fresh on every click.
- **Save** any PHP file and every count is marked out of date. The old numbers stay on screen while new ones are counted in the background, then update in place.
- Run **PHP Eyes: Recount References** from the Command Palette to force a full recount.

Magic methods such as `__construct` and `__get` are skipped, because PHP calls them implicitly and their counts would be misleading.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `phpEyes.enabled` | `true` | Show reference counts above PHP symbols. |
| `phpEyes.symbolKinds` | `["class", "interface", "enum", "method", "function"]` | Which symbols get a count. Also available: `property`, `constant`. |
| `phpEyes.showZero` | `true` | Show "0 references" on unused symbols. Turn this off to hide those lenses. |
| `phpEyes.maxConcurrentLookups` | `2` | How many reference lookups run at once. Takes effect after reloading the window. |

CodeLens must also be on in VS Code itself (`editor.codeLens`, which is on by default).

## Performance

Finding references is the slow part, and it's done by your PHP extension, not this one. To keep the lenses quick:

- **Counts are cached** per symbol and kept between sessions. After the first count, a lens shows its last known number immediately and is rechecked in the background.
- **Lookups run a few at a time.** Language servers answer them one by one anyway, so sending everything at once would only make each lens wait longer. The symbols you're looking at are counted first.
- **Lookups nobody needs any more are dropped**, for example when you scroll past them before they run.

The first count after opening a workspace can still take a while, because the PHP extension has to finish indexing first.

## Troubleshooting

**No lenses appear.** Check that Shift+F12 on a method name lists results. If it doesn't, the PHP extension hasn't finished indexing or isn't running. Also check that `editor.codeLens` is on.

**Counts are slow.** If you have more than one PHP extension installed (for example Intelephense *and* DEVSENSE), VS Code asks all of them and waits for the slowest. Disabling one for the workspace usually helps a lot. To see how long each lookup takes, run **Developer: Set Log Level...**, choose **PHP Eyes**, set it to **Debug**, and open the **PHP Eyes** output channel.

**A count looks wrong.** The count matches what Shift+F12 finds. In Laravel projects that means calls through facades, `__call`/`__callStatic`, container string bindings, and route strings like `'Controller@method'` usually aren't counted, unless something like [Laravel IDE Helper](https://github.com/barryvdh/laravel-ide-helper) lets the PHP extension resolve them.

**Duplicate lenses.** If your PHP extension also shows its own reference CodeLens (for example a licensed Intelephense or DEVSENSE), turn one of them off.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright (C) 2026 SirMekus

PHP Eyes is licensed under the [GNU General Public License v3.0](LICENSE). You're free to use, study, change and share it, but any version you distribute, including a modified one, must also be released under GPL-3.0 with its source code available.