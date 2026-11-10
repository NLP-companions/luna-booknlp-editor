# Luna — BookNLP editor

Luna lets you correct what [BookNLP](https://github.com/booknlp/booknlp) got wrong, in your browser: tokens (lemma, POS, dependencies), entities and who they refer to (coreference), quotes and their speakers, supersenses. It runs on your own computer; nothing is uploaded anywhere.

- **Two views of a book:** a table, one row per token, and an annotation view with entities, quotes and speakers drawn above the words.
- **Coreference tools:** merge and split groups of mentions, with suggestions that give their reasons; a pronoun pass and a quote pass that go through the book one item at a time, and a Speaker-Attribution view that shows one quote large with the text around it and who speaks each passage, an Entity-Attribution view that does the same for entity mentions; checks for links that can't be right; rules for *I* inside a quote and for the narrator.
- **Find and bulk changes** over every layer, with undo and redo that survive a restart, and flags to come back to later.
- **Collections:** what you confirm in one book of a series is offered in the next.
- **Export** writes the same files BookNLP does (plus a change log), so the corrected book can go straight into your analysis. BookNLP's own output is never changed.

Luna is built for corpora: books of 200,000 tokens and series of dozens of books stay fast.

## What you need

- **Python 3.10 or newer.**
- **BookNLP output for your books, and the text it was run on.** Luna does not run BookNLP and does not need it installed. For each book it needs `<book>.tokens` and `<book>.entities` and the original `<book>.txt`; it also uses `.quotes`, `.supersense` and `.book` when they are there. No BookNLP output yet? Run BookNLP on your text first, or try the example below.

Luna is developed and tested on macOS.

## Install

In a terminal:

```bash
python3 -m venv luna-env
source luna-env/bin/activate        # on Windows: luna-env\Scripts\activate
python -m pip install --upgrade pip
pip install git+https://github.com/sapphophonic/luna-booknlp-editor.git
```

That creates a separate Python environment so Luna doesn't disturb anything else, brings its installer (pip) up to date, and installs Luna and what it needs (FastAPI and uvicorn). To update later, run the `pip install` line again with `--upgrade`.

Prefer to work from a copy of the code? Clone the repository and run `pip install .` inside it (or `pip install -e .` if you want to change the code).

**Optional: re-tagging suggestions.** When you split or merge tokens or sentences, Luna can re-parse them with [spaCy](https://spacy.io) and suggest new lemmas, POS tags and dependencies, which you accept or reject. Without spaCy those edits still work, you just get no suggestions:

```bash
pip install spacy
python -m spacy download en_core_web_sm
```

If you ran BookNLP with another spaCy model, start Luna with `--spacy-model NAME`.

## Start it

With the environment active, in the folder where you want Luna to keep its files:

```bash
luna
```

It opens the library at <http://127.0.0.1:8765/library> in your browser. Luna answers only your own computer: other computers can't reach it, and neither can other web pages you have open (it refuses requests that don't come from its own page). Stop it with Ctrl+C. Every edit is saved at once, so there is nothing to save first.

Other options: `--port` (default 8765), `--no-browser` and `--data FOLDER` (see below). `python -m luna` does the same as `luna`.

### Try it with the example

The folder [`examples/`](examples) of the repository holds a short public-domain story with its BookNLP output (download it from GitHub, or clone the repository). In Luna, open **Settings → Folders with BookNLP output → Add a folder…**, choose the `examples` folder, go back to the library and choose **Start editing** on the book. For your own books, add the folder BookNLP wrote its output to in the same way, or put the output (with the original `.txt`) in Luna's **books folder**: the empty library has an **Open books folder** button, and Settings shows the books and data folders with "Show" buttons.

### Where Luna keeps its files

Luna only reads your BookNLP folders. Its own files (your working copies, what Export writes, your book details and your collections) are kept in a folder called **`luna-data`**, made in the folder you start Luna from: `books/` (a place to put BookNLP output, always searched), `projects/` (one working copy per book), `exports/`, `library.json` (the folders to search and your book details) and `collections.json` (what carries over between books). **Start it from the same folder each time** to find your work again, or choose the place once and for all with `--data FOLDER` or the `LUNA_DATA` environment variable. The start-up message tells you which folder is in use. Back this folder up if your work matters to you.

## Next steps

- **[User guide](docs/guide.md):** the library, every view and tool, collections, and export.
- **[Technical documentation](docs/DOCUMENTATION.md):** how it is built, where the data comes from and how it is stored, how to change it.
- **[Design language](docs/DESIGN.md):** colours, type, components, interaction and wording rules, and how to carry them to a companion project.

## Companion analyser

Luna works on its own. A separate companion analyser, [aLex](https://github.com/NLP-companions/aLex-analyser-for-bookNLP), explores books processed by BookNLP: entities, dialogue, corpus tools and more. It reads Luna's exports directly: point it at the folder Luna's exports are written to, and the newest export of each book is used.

## Development

From a clone of the repository:

```bash
python -m pip install --upgrade pip
pip install -e ".[dev]"
python -m unittest discover -s tests -t .
```

The tests (about 20 seconds; the workflow in `.github/workflows` runs them on macOS and Linux with Python 3.10 and 3.13) use their own generated books and temporary folders and never touch your data. Some skip themselves when an optional part is missing (spaCy, torch, Node, working copies of your own). `BNE_SCALE=1` adds a synthetic novel of 190,000 tokens with time limits, and `python -m tests.scale book` / `python -m tests.scale library` time the editor on a long book and on a collection of many books ([technical documentation §12](docs/DOCUMENTATION.md#12-working-at-scale)).


## Disclaimer

Luna was vibe-coded: it was written with [Claude](https://www.anthropic.com/claude), an AI model by Anthropic, under my direction. It has been tested, both with an automated test suite and by hand on real BookNLP output. However, **no human has reviewed the code in detail.**

The software is provided **as is**, without warranty of any kind, express or implied. You use it **at your own risk**. Luna changes your annotation files, so keep backups of your originals and check its output before relying on it, especially in research or publications.


## Licence

[MIT](LICENSE). Luna contains a copy of some of BookNLP's code (MIT, © David Bamman); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
