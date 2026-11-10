// PHP Eyes: free "N references" CodeLens for PHP.
// Copyright (C) 2026 SirMekus
// SPDX-License-Identifier: GPL-3.0-only

const vscode = require('vscode');

const KIND_MAP = {
    class: [vscode.SymbolKind.Class],
    interface: [vscode.SymbolKind.Interface],
    enum: [vscode.SymbolKind.Enum],
    method: [vscode.SymbolKind.Method],
    function: [vscode.SymbolKind.Function],
    property: [vscode.SymbolKind.Property, vscode.SymbolKind.Field],
    constant: [vscode.SymbolKind.Constant, vscode.SymbolKind.EnumMember],
};

// Skip magic methods: their call sites are implicit, so the count is always misleading.
const IGNORED_NAMES = /^__/;

const CACHE_STATE_KEY = 'phpEyes.counts';
const MAX_CACHED_COUNTS = 5000;

class ReferenceLens extends vscode.CodeLens {
    constructor(range, uri, position, cacheKey) {
        super(range);
        this.uri = uri;
        this.position = position;
        this.cacheKey = cacheKey;
    }
}

// Runs reference lookups a few at a time. Language servers answer them one by one
// anyway, so firing every visible lens at once only makes each of them wait longer.
// Visible lenses go first, newest request first (that's where the user is looking);
// background recounts of stale counts only run when nothing visible is waiting.
class LookupQueue {
    constructor(concurrency) {
        this.concurrency = concurrency;
        this.running = 0;
        this.visible = [];
        this.background = [];
    }

    push(job, isVisible) {
        (isVisible ? this.visible : this.background).push(job);
        this._next();
    }

    promote(job) {
        const index = this.background.indexOf(job);
        if (index !== -1) {
            this.background.splice(index, 1);
            this.visible.push(job);
        }
    }

    _next() {
        while (this.running < this.concurrency) {
            const job = this.visible.pop() || this.background.shift();
            if (!job) {
                return;
            }
            if (job.isAbandoned()) {
                job.skip();
                continue;
            }
            this.running++;
            job.run().finally(() => {
                this.running--;
                this._next();
            });
        }
    }
}

class PhpEyesProvider {
    constructor(context, output) {
        this._context = context;
        this._output = output;
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this._onDidChange.event;
        // VS Code caches lens command arguments and drops them whenever lenses are
        // re-requested, so a still-visible lens can point at a missing entry
        // ("Actual command not found"). Each lens instead gets its own
        // argument-free command, kept until its document closes.
        this._commands = new Map();

        // Counts are keyed by file + symbol path (not position, which shifts while
        // typing) and kept across restarts, so a lens can show its last known count
        // straight away while it's recounted in the background. Saving any PHP file
        // bumps the generation, which marks every count as stale.
        this._generation = 1;
        this._counts = new Map(
            Object.entries(context.workspaceState.get(CACHE_STATE_KEY, {})).map(([key, count]) => [
                key,
                { count, generation: 0 },
            ])
        );
        this._jobs = new Map();
        this._queue = new LookupQueue(
            vscode.workspace.getConfiguration('phpEyes').get('maxConcurrentLookups', 2)
        );
        this._refreshTimer = undefined;
        this._persistTimer = undefined;
    }

    disposeCommandsFor(uri) {
        const prefix = `${uri.toString()}#`;
        for (const [key, registration] of this._commands) {
            if (key.startsWith(prefix)) {
                registration.dispose();
                this._commands.delete(key);
            }
        }
    }

    dispose() {
        clearTimeout(this._refreshTimer);
        clearTimeout(this._persistTimer);
        this._persist();
        this._commands.forEach((registration) => registration.dispose());
        this._commands.clear();
        this._onDidChange.dispose();
    }

    invalidate() {
        this._generation++;
        this.refresh();
    }

    refresh() {
        this._onDidChange.fire();
    }

    async provideCodeLenses(document, token) {
        const config = vscode.workspace.getConfiguration('phpEyes');
        if (!config.get('enabled')) {
            return [];
        }

        const allowedKinds = new Set(
            config.get('symbolKinds', []).flatMap((name) => KIND_MAP[name] || [])
        );

        const symbols = await vscode.commands.executeCommand(
            'vscode.executeDocumentSymbolProvider',
            document.uri
        );
        if (!symbols || token.isCancellationRequested) {
            return [];
        }

        const lenses = [];
        const seen = new Set();

        const visit = (symbol, parents) => {
            const path = [...parents, symbol.containerName, symbol.name].filter(Boolean);
            if (allowedKinds.has(symbol.kind) && !IGNORED_NAMES.test(symbol.name)) {
                const position = this._namePosition(document, symbol);
                const key = position && `${position.line}:${position.character}`;
                if (key && !seen.has(key)) {
                    seen.add(key);
                    const line = document.lineAt(position.line).range;
                    const cacheKey = `${document.uri.toString()}#${path.join('.')}`;
                    lenses.push(new ReferenceLens(line, document.uri, position, cacheKey));
                }
            }
            (symbol.children || []).forEach((child) => visit(child, [...parents, symbol.name]));
        };
        symbols.forEach((symbol) => visit(symbol, []));

        return lenses;
    }

    async resolveCodeLens(lens, token) {
        const cached = this._counts.get(lens.cacheKey);

        if (cached) {
            if (cached.generation !== this._generation) {
                // Show the last known count now; refresh the lenses once the recount lands.
                this._lookup(lens, false, undefined).catch(() => {});
            }
            return this._withCount(lens, cached.count);
        }

        try {
            const count = await this._lookup(lens, true, token);
            return this._withCount(lens, count);
        } catch {
            // Abandoned (scrolled away or lenses re-requested); it'll be resolved again if needed.
            return lens;
        }
    }

    // One lookup per symbol at a time; callers asking for the same symbol share it.
    _lookup(lens, isVisible, token) {
        let job = this._jobs.get(lens.cacheKey);

        if (!job) {
            job = this._createJob(lens);
            this._jobs.set(lens.cacheKey, job);
            this._queue.push(job, isVisible);
        } else if (isVisible) {
            this._queue.promote(job);
        }

        if (isVisible) {
            job.waiters++;
            if (token) {
                token.onCancellationRequested(() => job.waiters--);
            }
        } else {
            job.background = true;
        }

        return job.promise;
    }

    _createJob(lens) {
        const job = { waiters: 0, background: false };
        const generation = this._generation;

        job.promise = new Promise((resolve, reject) => {
            job.isAbandoned = () => job.waiters <= 0 && !job.background;
            job.skip = () => {
                this._jobs.delete(lens.cacheKey);
                reject(new Error('abandoned'));
            };
            job.run = async () => {
                const started = Date.now();
                try {
                    const references = await this._references(lens.uri, lens.position);
                    const previous = this._counts.get(lens.cacheKey);
                    // Re-insert so the Map's order doubles as least-recently-counted first.
                    this._counts.delete(lens.cacheKey);
                    this._counts.set(lens.cacheKey, { count: references.length, generation });
                    this._schedulePersist();
                    this._output.debug(`${this._label(lens)}: ${references.length} in ${Date.now() - started}ms`);

                    if (job.background && previous && previous.count !== references.length) {
                        this._scheduleRefresh();
                    }
                    resolve(references.length);
                } catch (error) {
                    this._output.warn(`${this._label(lens)}: failed after ${Date.now() - started}ms (${error})`);
                    reject(error);
                } finally {
                    this._jobs.delete(lens.cacheKey);
                }
            };
        });

        return job;
    }

    _withCount(lens, count) {
        const showZero = vscode.workspace.getConfiguration('phpEyes').get('showZero');
        if (count === 0 && !showZero) {
            lens.command = { title: '', command: '' };
            return lens;
        }

        lens.command = {
            title: count === 1 ? '1 reference' : `${count} references`,
            command: count > 0 ? this._commandFor(lens.uri, lens.position) : '',
        };

        return lens;
    }

    _commandFor(uri, position) {
        const key = `${uri.toString()}#${position.line}:${position.character}`;
        const id = `phpEyes.show:${key}`;

        if (!this._commands.has(key)) {
            this._commands.set(
                key,
                vscode.commands.registerCommand(id, () => this._showReferences(uri, position))
            );
        }

        return id;
    }

    async _showReferences(uri, position) {
        const references = await this._references(uri, position);
        // Called from the extension host, so the arguments are passed directly, not cached.
        await vscode.commands.executeCommand('editor.action.showReferences', uri, position, references);
    }

    async _references(uri, position) {
        const locations = await vscode.commands.executeCommand(
            'vscode.executeReferenceProvider',
            uri,
            position
        );

        return this._dedupe(locations || []).filter(
            (location) => !(location.uri.toString() === uri.toString() && location.range.contains(position))
        );
    }

    _scheduleRefresh() {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => this.refresh(), 500);
    }

    _schedulePersist() {
        clearTimeout(this._persistTimer);
        this._persistTimer = setTimeout(() => this._persist(), 2000);
    }

    _persist() {
        const entries = [...this._counts.entries()].slice(-MAX_CACHED_COUNTS);
        const counts = Object.fromEntries(entries.map(([key, value]) => [key, value.count]));
        this._context.workspaceState.update(CACHE_STATE_KEY, counts);
    }

    _label(lens) {
        return `${vscode.workspace.asRelativePath(lens.uri)} ${lens.cacheKey.split('#')[1]}`;
    }

    // Document symbols from some servers point at the whole declaration
    // ("public function foo"), so find where the name itself starts.
    _namePosition(document, symbol) {
        const range = symbol.selectionRange || (symbol.location && symbol.location.range) || symbol.range;
        if (!range) {
            return null;
        }

        const name = symbol.name.replace(/^\$/, '');
        const text = document.getText(range);
        const index = text.indexOf(name);
        if (index === -1) {
            return range.start;
        }

        return document.positionAt(document.offsetAt(range.start) + index);
    }

    // Multiple PHP extensions (e.g. Intelephense + DEVSENSE) both answer, giving duplicates.
    _dedupe(locations) {
        const unique = new Map();
        for (const location of locations) {
            const uri = location.uri || location.targetUri;
            const range = location.range || location.targetSelectionRange || location.targetRange;
            if (!uri || !range) {
                continue;
            }
            const key = `${uri.toString()}#${range.start.line}:${range.start.character}`;
            if (!unique.has(key)) {
                unique.set(key, new vscode.Location(uri, range));
            }
        }
        return [...unique.values()];
    }
}

function activate(context) {
    // A log channel, so timings only show up after "Developer: Set Log Level..." → Debug.
    const output = vscode.window.createOutputChannel('PHP Eyes', { log: true });
    const provider = new PhpEyesProvider(context, output);

    context.subscriptions.push(
        output,
        provider,
        vscode.languages.registerCodeLensProvider({ language: 'php' }, provider),
        vscode.workspace.onDidCloseTextDocument((document) => provider.disposeCommandsFor(document.uri)),
        // References in other files change on save, so every count becomes stale.
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'php') {
                provider.invalidate();
            }
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('phpEyes')) {
                provider.refresh();
            }
        }),
        vscode.commands.registerCommand('phpEyes.refresh', () => provider.invalidate())
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
