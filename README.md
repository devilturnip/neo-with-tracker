# NEO (with litrpg-tracker)

**A distraction-free word processor for authors, by a wannabe author.**

This is a personal fork of [hughhowey/neo](https://github.com/hughhowey/neo) with [litrpg-tracker](https://github.com/devilturnip/litrpg-tracker) embedded as a side panel — a companion app for tracking a litRPG novel's stats, inventory, and quests alongside the manuscript. Everything below describes upstream NEO; the tracker integration is this fork's own addition (see `scripts/launch-with-tracker.sh`).

NEO understands from the moment you install it that you are writing *books* and nothing else. No bloat, no distractions, with manuscripts that look like books as you write them.

NEO runs locally. WIPs are saved in plain files on your disk. No accounts or subscriptions. And it's free!

## Download

Get the latest installer from the **[Releases page](../../releases)**:

- **macOS** — download the `.dmg` for older Intel machines or the arm64 file for Mac silicon. Open it and drag NEO to Applications.
- **Windows** — get `NEO-Setup` (the installer, which keeps itself up to date) and run it, or the `portable` `.exe`, which runs without installing.

  Your library lives in `Documents\NEO Library`. If OneDrive backs up your Documents folder, that puts your books in OneDrive too; File → Library Folder… moves the library anywhere you like. If Windows Security's *Controlled folder access* is on, Windows won't let NEO save in Documents: NEO says so when it starts, and you can allow NEO there or pick another folder.
- **Linux** — download the `.AppImage`, make it executable, and run it:

  ```
  chmod +x NEO-*.AppImage
  ./NEO-*.AppImage
  ```

  If it complains about a sandbox (common on Ubuntu 24.04 and newer), run it as `./NEO-*.AppImage --no-sandbox`. Your library lives in `~/Documents/NEO Library`; File → Library Folder… moves it anywhere you like.

## Why NEO?

**The bookshelf** 

Your library looks like a bookshelf, not a file list. Labeled shelves you organize however you like — by series, by status, by pen name. Progress bars on the covers show how far you are from your word goals. You can drag-and-drop books anywhere. You can also drag shelves around and put cover art on your titles.

**Just a blank page** 

There's a white page by default or a dark mode (which I now prefer!). Controls fade until you mouse over them. Chapters number and renumber themselves automatically. Drop caps mark chapter openings, because I'm a sucker for drop-caps. Em dashes, true ellipses, and curly quotes sort themselves out as you type. Spellcheck exists only when you invoke it — no more red squiggles mid-sentence triggering your imposter syndrome.

**Enter, Enter, Enter** 

One Enter: new paragraph. Two: a `***` section break. Three: a new chapter. The goal is to KEEP WRITING.

Right-click the first chapter's heading to make it a prologue, or the last one's to make it an epilogue: they step out of the numbering, and everything renumbers.

**Darlings** 

The writing advice is "kill your darlings" — but I say: *keep the bodies*. Drag any beautiful-but-in-the-way passage onto the Darlings tab. It leaves your manuscript but isn't lost. Darlings restore to the exact spot it came from. More like zombies than darlings.

**Placeholders** 

Mid-flow and need a name, a fact, a date? ⌘⇧X drops a mark and a sticky note. The left panel shows a red dot on every chapter that you need to get back to. The right panel will list all these to-do items.

**Outlining with index cards** 

The Outline tab lays your book out as index cards, set like a page: they read left to right, line after line, so forty short chapters or a story of thirty scenes both fill the window. Each chapter starts at its big numeral, with its sections following on the same mat. Click a card and write a few lines on it. A section's note shows up in the manuscript as a gray ghost paragraph, and once you start writing, it rides one line below your words until you dismiss it. Drag a card to move it and the writing moves with it (⌘Z puts it back). Pantsers get cards too: every chapter and every *** section is already a card, showing its first line until you give it a note. Ideas without a home wait on loose cards in the right-hand panel. ⌘− shrinks the cards until a whole novel fits on one screen, and the old list is one click away. Pantsers can ignore all of it or learn to draw a freakin' map for the first time. Try it. You might like it!

**Cover Art** 

Every book gets a cover! New books are dressed in a seeded abstract (six art styles, six type templates, typefaces bundled with NEO) so no two stories on the shelf look alike. Once a story passes 1,000 words, NEO can read it and paint an abstract cover from the text. This is a bit more work but totally worth it. Get an OpenAI API key from their website and paste it into **File → Cover Art…**. The art is generated in the background for about a penny a picture. (These are not meant for publication, just writing inspiration!) The API key is stored encrypted in NEO's own settings, never in your library folder. The title and author are always set in real type on top, so the lettering is never left to a gen-AI model. The ↻ on any book re-rolls its type and colors, or paints it again. And you can always switch back and forth from the seeded modern look to the painted variety.

**Goals and momentum** 

Daily word goals, word sprints, and a NaNoWriMo-style progress chart. Needs more testing, but I think it works okay!

**A shelf can become one book** 

Right-click a shelf's name and choose **Bind into one book** for an omnibus, a trilogy, or a story collection. Hover over the bound shelf and the pages a published book carries show up faintly in their places: copyright, dedication, epigraph, prologue, epilogue, acknowledgments, about the author. A small + before each title starts a Part. Click a page and type it the way it will print; a prologue or epilogue opens in the editor like any story. The export is one EPUB, Word file, or PDF with a single cover and one table of contents, and chapters can number straight through the whole book. Unbind any time. Nothing is lost.

**Screenplays, too!**

A lot of you have asked for this feature, so here it is! Right-click the + on any shelf and choose **New Script**. Scripts sit on the same shelves as your books, on white card stock with two brass brads. Inside, the page is set the way it will print: Courier Prime, pages, page numbers, a proper title page.

You never have to pick a formatting element. Start a line with INT. or EXT. and it's a scene heading. Type a name in capitals, hit Enter, and the next line is dialogue. Hit Enter twice after a speech and you're on the next speaker, with whoever is being answered already there in gray. Tab or Enter fills it in. ⌘1 through ⌘7 will let you pick an element yourself, the same keys Final Draft uses. The left panel lists your scenes and how long each one runs, in eighths of a page. Drag a scene to move it. (CONT'D) happens automatically. The Outline tab lays every scene out as an index card: its heading, its length, who's in it, and a note you can write on it. Drag the cards to restructure the script, or start a script as a stack of cards and write it from there.

Export an industry-format PDF, or a Fountain or Final Draft (.fdx) file. Drop a .fountain or .fdx file on a shelf to import a script. Notes, Darlings, placeholders, sprints, and NEO Pocket all work the same as they do for books.

**Exports** 

EPUB 3 with a proper table of contents built to KDP's guidelines, Word .docx, PDF with page numbers and bookmarks, HTML, markdown, and plain text. Email a timestamped PDF snapshot to yourself with a SHA-256 fingerprint of the text in the body. Might come in handy someday.

**Import** 

Bring in existing .docx, .txt, and .md manuscripts; chapters and scene breaks are detected automatically. This is still a bit rough and might require you to tweak things. It will try to grab your title and remove that from the body, and it seems to be working okay.

**Backups** 

Continuous autosave, daily zip backups kept for two weeks, everything stored as plain files. Set up your NEO library folder on your iCloud if you want for extra safety. You can also email copies of your WIP to yourself with a keystroke: ⌘E.

## Your files

Everything lives in `~/Documents/NEO Library` — one folder per book, chapters as readable HTML, metadata as JSON. Open them in your favorite text editor.

## Languages

NEO speaks English, French, Spanish, Portuguese, German, Italian, Dutch, Polish, Romanian and Russian. Pick one under **View → Language**; on first launch NEO follows your system language when it has it. Adding a language is a single file, no programming needed: see [TRANSLATING.md](TRANSLATING.md).

## Building from source (for the eggheads):

Requires [Node.js](https://nodejs.org).

```
git clone https://github.com/devilturnip/neo-with-tracker.git
cd neo-with-tracker
npm install
npm start
```

**View → Keyboard Shortcuts…** opens the shortcut reference. You can also press `Cmd+/` on macOS or `Ctrl+/` on Windows and Linux, or use **Help → NEO Shortcuts**.

To build installers: `npm install electron-builder --save-dev`, then `npm run package` (macOS, also `npm run package:mac`), `npm run package:win` (Windows), or `npm run package:all`. Output lands in `dist/`.

The app is very simple: an Electron shell (`main.js`), a preload bridge (`preload.js`), and a renderer (`app.js` + `styles.css` + `index.html`). If you know JavaScript, you can change NEO. Have at it.

## The tracker bridge (this fork)

Everything the fork adds lives in three files of its own, so upstream NEO can be merged with `git merge upstream/main` and only a handful of one-line hooks ever collide:

- `tracker-bridge.js` — the renderer side: the right-edge pane's tracker mode (beside Stickies), the embedded dev-server iframe, and all NEO ↔ tracker traffic. Loaded by `index.html` right after `app.js`; not loaded in Pocket.
- `tracker.css` — the fork's styles, loaded after `styles.css`.
- `tracker-main.js` — the main-process side: finds or spawns the tracker's Vite dev server (`~/Projects/litrpg-tracker`, port 5173) and answers the `tracker:ensure` IPC call.

The lines upstream files carry for it, to re-apply by hand if a merge ever loses one (each is tagged `litrpg-tracker` in a trailing comment, so `git grep litrpg-tracker -- app.js main.js preload.js index.html` lists them):

| File | Where | Line |
|---|---|---|
| `index.html` | `<head>` / end of `<body>` | `<link rel="stylesheet" href="tracker.css" />` and `<script src="tracker-bridge.js"></script>` |
| `main.js` | after `let backupRunning = false;` | `require('./tracker-main.js')({ app, ipcMain, logError });` |
| `preload.js` | the `neo` API | `trackerEnsure: () => ipcRenderer.invoke('tracker:ensure'),` |
| `app.js` | `createChapterAt()`, before `return chId` | `window.neoHooks?.chapterCreated?.(chId);` |
| `app.js` | `focusSticky()`, after the pane opens | `window.neoHooks?.stickyFocused?.();` |
| `app.js` | `wireHoverPane()`, in `pinned()` | `\|\| !!window.neoHooks?.paneLocked?.(pane, 'hover')` |
| `app.js` | `closeUnpinnedPanes()`, the side-pane condition | `&& !window.neoHooks?.paneLocked?.($('#side-pane'), 'blur')` |
| `app.js` | `sidePaneForTab()`, last line | `window.neoHooks?.tabShown?.(name);` |
| `app.js` | `renderDarlings()`, once `content` is filled | `window.neoHooks?.darlingRendered?.(el, content, d);` |
| `app.js` | `updateCounters()`, after the `!book` guard | `window.neoHooks?.countersUpdated?.();` |

The bridge installs `window.neoHooks` at the bottom of `tracker-bridge.js`, where each hook is documented; without the bridge every hook is a no-op. It also owns the fork's one shortcut, **Ctrl+D / ⌘D**: select a passage, Ctrl+D, type part of a name, Enter — the selection is filed as a reference on that character, item, ability, quest or location and the cursor is back where it was (Shift+Enter opens the thing in the drawer instead). The palette talks to the tracker's dev server directly, so it never waits on the drawer. **Alt+D / ⌥D** (or the ◎ Refs button in the bottom bar) tints every passage the tracker already has a reference on; hovering one names what it's a reference on, and **Ctrl+click** (⌘-click) opens that entity's properties in the drawer. `npm run test:tracker` drives the pane's mode switching end to end — run it (and `npm test`, `npm run lint`) after every upstream merge.

## Roadmap (things I'm dreaming up but may never get to):

Chapter version history · manuscript format for agent submissions (Times New Roman, double-spaced, address block, just to make Kristin Nelson happy) · global end matter that updates every book at once (same for copyright pages, bios, etc).

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Fair warning: NEO is opinionated by design, and bloat killed every writing app I've ever tried. If you want complex, try Scrivener. It really is a great application beloved by many! There are so many wonderful writing apps out there! Nobody needs to use this but me.

## License

[MIT](LICENSE) — free to use, free to modify, free to share.

## Philosophy

If you didn't know, I opened up the Silo universe to fan fiction years ago. And not just to put on fan fiction sites, but you can charge money for the things you write and keep every penny of the income! Lots of incredible Silo Stories out there. But readers are forever looking for more.
