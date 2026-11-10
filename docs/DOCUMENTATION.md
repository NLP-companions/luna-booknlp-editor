# How the editor works: code and data

This is the technical companion to the [user guide](guide.md) (which is about *using* the editor; installing and starting it are in the [README](../README.md)). It explains how the program is put together and, above all, **where every piece of data comes from, how it is stored, processed, edited and passed on**.

Contents: [1 Folder map](#1-folder-map) · [2 The data at a glance](#2-the-data-at-a-glance) · [3 Where the data comes from](#3-where-the-data-comes-from-import) · [4 How it is stored](#4-how-it-is-stored) · [5 Data that is worked out, not stored](#5-data-that-is-worked-out-not-stored) · [6 How edits work](#6-how-edits-work) · [7 Settings and other stores](#7-settings-and-other-stores) · [8 Export and the analyser](#8-export-and-the-analyser) · [9 The web layer](#9-the-web-layer) · [10 Tests](#10-tests) · [11 Adding a feature](#11-adding-a-feature) · [12 Working at scale](#12-working-at-scale)

---

## 1 Folder map

```
luna-booknlp-editor/
  pyproject.toml         the package: name, version, Python version, dependencies (core and optional extras), the `luna` command
  README.md  LICENSE     what it is and how to install and start it; MIT licence
  THIRD_PARTY_NOTICES.md BookNLP's licence, for the code of its that luna/core/bookfile.py contains
  docs/guide.md          how to use it
  docs/DOCUMENTATION.md  this file
  docs/DESIGN.md         the design language: tokens, components, interaction and copy rules, decision log (checked by tests/test_design.py)
  examples/              a short public-domain book with its BookNLP output, to try Luna with (see examples/README.md)
  .github/workflows/     the tests, run on every push

  luna/                  the package (everything below, up to the tests, is inside it)
    app.py               web layer: FastAPI routes + command line (`luna`, `python -m luna`)
    localonly.py         middleware: answers only requests for this computer, and changes only from Luna's own page (§9)

    core/                  the engine; knows nothing about the web
      store.py             Store: one open working copy. Reading, editing, undo/redo,
                           groups, tokens/sentences, spaCy suggestions, Export
      schema.py            the SQLite tables; which fields count as "edited by hand"
      tagsets.py           BookNLP's tag lists (POS, dependency, entity types, supersenses)
      errors.py            EditError = a refused edit, shown to the user as a message
      speakers.py          the mention of a group nearest to a quote, found by binary search (linking many quotes to a speaker)
      library.py           which books and working copies exist (folders, projects/), and their exports
      collections_store.py collections and their lists (collections.json)
      jsonfile.py          reading library.json / collections.json safely (an unreadable one is kept aside) and saving them atomically
      profiles.py          character profiles: their layout, adding them up over books, a readable summary
      matching.py          matching a book's groups to collection characters by evidence (scores, settings)
      suggest.py           which evidence each kind of suggestion uses and its weights (settings, defaults)
      names.py             personal names: titles, name words, a name without titles, the gender titles imply
      embed.py             optional transformer speech embeddings (downloaded models only; torch loaded on use)
      bookfile.py          rebuilds BookNLP's .book and .book.html on Export
      cleanup_import.py    names plural groups / flags unsettled turns from the extra files of a pre-cleaned folder, if it has them
      tools/               feature areas, each a mixin class combined into Store
        coref.py             select by scope, quote rule (+ its per-quote pronoun moves), nearby groups, merge suggestions, fragments
        quote.py             speaker suggestions for quotes
        rule.py              narrator rule, checks for impossible links, pronoun pass, quote pass
        focus.py             the Speaker-Attribution view: one quote with its attribution and the passages around it
        eattr.py             the Entity-Attribution view: one entity mention with its sentence, the marked text around it and suggested entities
        split.py             the Split tab: groups likely to be two entities (with reasons), one group's mentions walked with what a move takes along
        carry.py             carrying corrections between the books of a collection
        find.py              Find: search, phrase search, filters, bulk change / create / delete
        profile.py           a character profile of every group, read from the corrected book
        flag.py              flags ("check this later" + an optional note) on a mention, quote, group or sentence

    static/                the pages (plain HTML/JS/CSS, no build step)
      index.html           the editor page   library.html   the library page   settings.html   the Settings page
      js/                  theme.js (light/dark, loaded first on every page); app.js (core), bulk.js, entities.js, corefui.js, rules.js,
                           quotesug.js, passui.js (the passes' shared engine + the pronoun pass), qpassui.js (the quote pass and what it shares with the Speaker-Attribution view: speaker keys, settings), qfocusui.js (the Speaker-Attribution view and `fitReading`), eattrui.js (the Entity-Attribution view), fragui.js (Entities → Fragments), splitui.js (Entities → Split), flagsui.js (the Flags list), sidepane.js (resize/collapse the right column) (editor); library.js + libfilter.js (library);
                           settings.js (settings); pageui.js ($, api, toast, modal, browse…,
                           shared by library.js and settings.js)
      css/                 app.css (all three pages), library.css (library and settings)

  tests/                 unittest suite (see §10); synthetic.py makes books of any size, scale.py times them (§12)

  luna-data/             YOUR DATA: git-ignored, never overwritten by an update; made in the folder you start Luna from
                         (or the folder given with --data / LUNA_DATA)
    books/                 Luna's own books folder: always scanned (before the folders you add), made at start; put BookNLP output here
    projects/              one SQLite file per working copy (+ .discarded/)
    exports/               one folder per Export: exports/BOOK-YYYYMMDD-HHMMSS/
    collections.json       collections, their characters / retyped names / rules
    library.json           the folders to scan, and where each book's original .txt is
```

Rule of thumb: **`core/` decides, `app.py` transports, `static/` displays** (all inside `luna/`). All rules about what an edit does live in `core/`; the browser never changes data by itself, it always asks the server.

---

## 2 The data at a glance

```
 BookNLP run                           this editor                              analyser
 ───────────                           ───────────                              ────────
 BOOK.txt ──┐
            ├─► BookNLP ─► output/BOOK.tokens, .entities,   Library.start()
            │              .supersense, .quotes, .book,     create_project()
            │              .book.html                       (checks tokens against the .txt)
            │                       │                              │
            │                       └──────── read-only ───────────▼
            │                                          projects/NAME.sqlite   ← every edit, undo, redo,
            │                                          (the working copy)        suggestion, setting
            │                                                      │
            │                                          Store.export()          exports/BOOK-DATE/…
            │                                                      └────────────────► reads the newest export
            └─ the original text is only ever READ (offsets are checked against it)
```

* BookNLP's output folder and the `.txt` are **never modified**.
* The working copy (`projects/*.sqlite`) is the only thing edits change. It is a normal SQLite file: you can copy it as a backup while the editor is stopped.
* Export writes a new dated folder every time; earlier exports stay.

---

## 3 Where the data comes from (import)

`core/store.py → create_project()` reads one book's BookNLP output. BookNLP itself produced these files from the plain text: it tokenises and parses with spaCy (`en_core_web_sm`), then adds its own models for entities, coreference, supersenses, quote attribution and events. The editor treats all of it as *BookNLP's opinion, to be corrected*.

| BookNLP file | What is in it | Becomes (SQLite table) | Notes |
|---|---|---|---|
| `BOOK.tokens` | one row per token: word, lemma, character offsets, POS, fine POS, dependency relation, head, event, plus paragraph/sentence numbers | `tokens` | `token_ID_within_document` must run 0…n-1. Sentence and paragraph *starts* become flags (`sent_start`, `para_start`); heads become the head token's `uid`. Unknown extra columns are kept in `extra` and written back on export |
| `BOOK.entities` | mentions: start/end token, type (`cat`: PER, LOC, FAC, GPE, VEH, ORG), mention type (`prop`: PROP name, NOM noun, PRON pronoun), coreference group number (`COREF`), text | `entities` | The group number is BookNLP's coreference chain. There is no table of groups: a group *is* the set of entities sharing a `coref` number |
| `BOOK.supersense` | spans with a WordNet supersense (`noun.person`, `verb.motion`…) | `supersenses` | |
| `BOOK.quotes` | quote span, the speaker's group (`char_id`) and the mention that attributes it (`mention_start/end/phrase`) | `quotes` | The speaker mention is BookNLP's evidence for the speaker |
| `BOOK.book`, `BOOK.book.html`, any other `BOOK.*` | BookNLP's character summary and report | `meta.passthrough` (as text) | Kept so Export can hand them back; `.book` is also read for BookNLP's pronoun guess per group |
| the original `BOOK.txt` | the text BookNLP was run on | `meta.text` + `meta.text_path` | Used to check offsets (a wrong file is refused), to keep the exported text identical, and to recompute offsets after splits |

Checks during import: every token's character span must reproduce the token's word in the text (BookNLP replaces spaces/newlines/tabs inside tokens with `S`/`N`/`T`; `filter_ws` undoes that). More than max(20, 1%) mismatches means "wrong text file" and nothing is created. Any other trouble inside a BookNLP file (a missing column, a short row, a word where a number belongs) is reported as a message naming the book, and the half-made working copy is deleted again (`create_project` → `_import_book`, `_read_token_rows`).

`meta.join_style` records whether each layer's `text` column equals the tokens joined by spaces (true for normal BookNLP output). Export only rebuilds span text for layers where that holds.

**A pre-cleaned folder** (one where a separate step rewrote BookNLP's coreference and speaker attribution before you point the editor at it) needs no changes here: it is the same file formats, so it imports like any other BookNLP folder. Such a step may also write `ID.groups.tsv` (the plural entities it made for "we/us/our": id, name, member ids) and `ID.cleanup_log.tsv` (every change it made, plus `file="review"` rows for dialogue it couldn't settle) — these land in `meta.passthrough` like any other extra file. Right after import, `core/cleanup_import.py → apply_cleanup_metadata` reads them back out and, if present, names those plural groups (`Store.edit_group`) and flags the unsettled turns (`Store.set_flag`, one per `review` row, matched to a quote by token span), so a cleaned import starts with that work already done. Turning `ID.groups.tsv`'s member ids into an actual plural-group declaration is the analyser's job, not this editor's.

**How the library finds books** (`core/library.py`): the data folder's `books/` (`Library.books`, always scanned, so there is always a place to put books) and every folder you add are scanned, plus the folders directly inside it, for `ID.tokens` + `ID.entities`. Folders with `ID.changes.md` are editor exports and are skipped. The `.txt` is guessed (`ID.txt` next to or near the output, in `input/`, `texts/` …) or chosen by you; the choice is remembered in `library.json → texts`. Settings → Folders lists the books folder and the data folder (`books_dir`, `data_dir` in `/api/library`) with "Show", and the empty library shows the books folder with "Open books folder". Both use `POST /api/library/reveal`, which shows only the data folder and what is inside it (the books folder is made again if it is missing), the exports folder and the source folders, and answers 400 naming the folder when the computer has no file browser to ask.

---

## 4 How it is stored

One SQLite file per working copy. Schema: `core/schema.py`.

### 4.1 Content tables

| Table | Key columns | Meaning |
|---|---|---|
| `tokens` | `uid` (stable id), `ord` (position 0…n-1), `word`, `lemma`, `char_start/end`, `pos`, `tag` (fine POS), `dep`, `head` (a token uid), `event`, `sent_start`, `para_start`, `reviewed`, `manual`, `extra` | The text, token by token. `ord` is always the rank by `char_start`, so it is recomputed after a split or merge; **everything else refers to tokens by `uid`** so positions can change without breaking anything |
| `entities` | `uid`, `tok_start`, `tok_end`, `coref`, `prop`, `cat`, `text`, `manual` | Mentions. `coref` is the coreference group number |
| `supersenses` | `uid`, `tok_start`, `tok_end`, `cat`, `text`, `manual` | |
| `quotes` | `uid`, `tok_start`, `tok_end`, `char_id` (speaker group), `m_start`, `m_end`, `m_phrase` (speaker mention), `text`, `manual` | Quotes never overlap each other. When you set a speaker the editor links the nearest mention of that group *outside* the quote |
| `groups` | `uid` (= the coref number), `name`, `pronoun`, `hidden`, `checked`, `carry`, `manual` | **Only what you set** on a group: its name, pronouns, "not a character", "checked", and the link to a collection character. Created on first use. (Working copies used with an earlier version may have an unused `members` column; groups of several characters are declared in the analyser.) |
| `flags` | `uid`, `kind` (`entities`/`quotes`/`groups`/`sentence`), `target` (that row's uid, or a sentence's first token's uid), `note`, `auto` (1 for a flag the cleanup import set; older flags read 0), `created` | A "check this later" mark with an optional note, one per (`kind`, `target`); see `core/tools/flag.py`. Like `checked` and `reviewed`, it's a personal marker: undoable but never exported |

`manual` (on every row) is a JSON list of the fields you changed by hand, for the "tracked" fields in `schema.TRACKED`. It has two jobs: spaCy re-tagging never suggests changes to a manually edited field, and the table shows a blue dot for it. `flags` isn't tracked this way (`insert`/`update` are always called with `manual=False` for it): a flag isn't book content, so hand-editing has no meaning for it.

### 4.2 History

| Table | Meaning |
|---|---|
| `batches` | one row per undoable step: `label` (shown in History and the change log), `ts`, `undone`, `kind` (`review` for review ticks / checked marks, which are undoable but left out of the exported change log) |
| `changes` | the full **before** and **after** row (JSON) of every row a batch touched |

Undo replays a batch's `before` rows backwards, redo its `after` rows forwards, and flips the batch's `undone` mark in the same commit, so a replay that fails leaves the book as it was. History survives closing the program. Starting a new edit after an undo discards the undone steps (like any editor).

Besides the primary keys, `Store.__init__` makes sure these indexes exist (added to working copies made before them, at no cost to their data): `tokens(ord)`, `tokens(char_start)`, `tokens(head)`, `entities(coref)`, `entities(tok_start)`, `entities(tok_end)`, `quotes(tok_start)`, `quotes(char_id)`, `quotes(m_start, m_end)` and `changes(tbl, uid)`. The last four are what keep merging a group, moving mentions, linking speakers and handing out the next free id from scanning a whole table once per item.

### 4.3 Suggestions and confirmations (not part of undo)

| Table | Meaning |
|---|---|
| `proposals` | spaCy re-tagging suggestions waiting for you: token, field, old value, new value, and a signature of the sentence they were made for (they vanish if the sentence or the field changes) |
| `confirmed` | pronouns you kept with Enter in the pronoun pass (mention, group at that time). Not an edit: not in History, not exported |
| `confirmed_quotes` | quotes you kept with Enter in the quote pass (quote, speaker at that time). Not an edit: not in History, not exported |

### 4.4 `meta` (key → JSON)

Facts about the book and small settings that belong to *this* book:

| Key | Set by | Meaning |
|---|---|---|
| `book_id`, `source_dir`, `text_path`, `text`, `created`, `tokens_header`, `layers`, `join_style`, `passthrough`, `offset_mismatches`, `n_offset_mismatches` | import | where the book came from and what BookNLP wrote |
| `spacy_model` | `luna open --spacy-model` | model used for re-tagging |
| `narrator` | narrator rule | `{cid, passages:[{a, b, cid}]}`: the book's narrator group and passages with another narrator |
| `hotkeys` | number-key pins | `{"1": group id, …}` |
| `ppass` | pronoun pass | which pronouns to show, what to skip, how to advance |
| `eattr` | Entity-Attribution view | `advance` ('auto'/'manual'), `suggest` (offer nearby groups on the free number keys) |
| `qpass` | quote pass and Speaker-Attribution view | what to skip (pass only), how to advance, `keys` (up to 5 group ids pinned to the Quote tool's keys 1.., kept only while the group exists), `suggest` (offer speakers on the keys after them), `sources` (which of `evidence`, `conversation`, `nearby`; default all), `reasons` (print the suggestions' reasons under the bar) |
| `coref_next` | any new group | the next group number to hand out: past every group number the book has ever had, so one is never given twice (`Store._new_coref`) |
| `dismissed_pairs` | "Not the same" | merge suggestions you rejected |
| `dismissed_quote_sugs` | "Keep BookNLP's" | speaker suggestions you rejected |
| `check_ok` | "It's right" | checks you reviewed |
| `book_types` | Entities overview | entity types in the exported `.book` (default PER) |
| `carry_offered` | Collection tool | the collection's suggestions were shown once |
| `speech_embeddings` | "Compute speech embeddings" | `{model, groups: {group: {vec, quotes, sig}}}`: each speaker's transformer vector and a fingerprint of the quotes it was made from (a profile uses it only while the fingerprint matches). Not an edit, not exported |

---

## 5 Data that is worked out, not stored

Nothing below is saved; it is computed from the tables, cached in memory (`Store._memo`) and thrown away when an edit makes it stale. So it can never disagree with the data. Which edit drops what (`Store._after`):

* an ordinary step (groups, mentions, speakers, tokens…) drops everything, except that a step that leaves the tokens table alone keeps what is read from the parse alone (`TOKEN_MEMOS`: the token columns as lists, who depends on whom, and each quote's content words, whose cache key is every quote's bounds), since rebuilding those reads the whole book;
* a step that only sets review marks (a sentence reviewed, a group checked) drops only the pronoun and quote pass lists and the collection matches (`REVIEW_MEMOS`);
* a flag changes nothing derived and drops nothing.

`tests/test_edits.py` pins this policy down and `tests/test_fuzz.py` checks after random edits that every cache equals a fresh computation (groups, mention positions, token arrays, dependents, quote words, speaker scores, pass lists), so a rule that keeps too much shows up there.

Two caches outside `_memo` hold pure functions of their arguments and never go stale: `names.name_tokens`/`bare_name` (a long book parses the same few thousand names tens of thousands of times) and `coref.similar_spellings` (the spelling variants among one block of name words; an edit seldom changes which name words exist, only who has them).

| What | Computed in | How |
|---|---|---|
| **Groups** (name, type, counts, pronouns) | `Store.clusters` | group entities by `coref`. Name = most common proper name (else noun, else pronoun) unless you renamed it. Type = most common `cat` (`cats` has all of them). Pronouns = yours, else BookNLP's from `.book` |
| **Merge suggestions** | `tools/coref.py` | candidate pairs from shared/nested names, spelling variants (`similar_spellings`), lone nouns beside a name; scored with evidence for (pronouns agree, profiles alike: descriptions, relations, actions, speech) and against (titles Mr./Mrs., different first names, named together, speak to each other). Every weight and the listing threshold come from the settings (`core/suggest.py`, type `merge`) |
| **Fragments** | `tools/coref.py` | groups with ≤ N mentions, in reading order, with candidate targets (merge-suggestion partners, groups mentioned nearby and groups also called by one of its names), each scored from the settings (`core/suggest.py`, type `fragments`: merge score, nearness halving every 20 words, same type, established group, pronouns, same name elsewhere, profiles alike over a book-wide Matcher). `fragment_detail` opens one group (any size, paged): every mention with its sentence and N tokens of marked context before and after (`_eattr_reading`, shared with Entity-Attribution) and its quotes (inside one / its speaker mention), nine candidates, and `same_name` (the other groups and fragments using its names, from the cached `_name_index` of non-pronoun mention texts, lower-cased without a leading article: `name_key`) |
| **Speaker suggestions** | `tools/quote.py` | for each quote: attribution tag (speech verb + its subject from the dependency parse), continuation in the same paragraph, turn-taking (return to the speaker two turns back), a name just before, "sounds like" (the quote's content words against the candidate's other quotes and its collection character's, tf-idf; `SoundsLike`); evidence against (addressed by name inside the quote, BookNLP's mention inside the quote or far away, the same candidate having spoken the untagged turn right before with nothing narrated in between). Weights, margin and minimum from the settings (`core/suggest.py`, type `speaker`). Listed when the best candidate differs from BookNLP's. What every quote's scoring needs from the whole book (the parse, mentions, conversations, "sounds like" statistics) is gathered once per edit (`SpeakerContext`); each quote is then scored when first asked for (`_quote_score`): the Quotes tab asks for all (`_scored`), the Quote tool only for the quote it shows |
| **Checks** | `tools/rule.py` | pronoun class vs the group's expected pronoun class, reflexive/object-pronoun vs the verb's subject (dependency parse), apposition in two groups |
| **Pronoun pass list** | `tools/rule.py` | all pronouns of the chosen kinds minus those skipped by your settings |
| **`.book` content** | `Store._build_book` | BookNLP's own `get_syntax` run on the corrected tokens/entities/groups (§8) |
| **Character profiles** | `tools/profile.py` | per group: proper names, name words, titles, head nouns of common-noun mentions, pronoun classes and gender, relations from possessives ("his wife"), named characters and places in the same paragraphs, actions from the parse (agent, patient, possessions, descriptions) and stylometric counts of its quotes. Layout in `core/profiles.py`; `profile_summary(cid)` (`core/profiles.py` `summary`) reads as short lists, for `/api/group/{cid}/profile` and the Entities Compare pane |
| **Search results** | `tools/find.py` | SQL against the tables ("contains" is the SQL function `CONTAINS_CI`, registered by `Store`: it folds case the way Python does, so *évariste* finds *Évariste*, and `_`/`%` are ordinary characters); phrase search and the two context filters in Python over cached masks |
| **Collection review** | `tools/carry.py` | every group of the book matched against every character of its collection (`carry_review`, kept until an edit here or a change to the collections) |
| **Entity excerpts** | `tools/coref.py` `entity_context` | a page of `window()`s around a group's mentions and quotes, padded by the display setting's `context_sentences` and merged where they touch; the annotation view's entity-filter mode |

`nearby_groups` (used by every picker) ranks groups by distance to a position, weighting a name as closer than a noun and a noun as closer than a pronoun.

---

## 6 How edits work

### 6.1 The one rule: everything goes through a batch

```python
with store.batch("Set POS to NOUN on 12 tokens"):      # one undoable step
    store.update("tokens", uid, {"pos": "NOUN"})       # records before/after, marks the field as hand-edited
    store.insert("entities", {...})
    store.delete("supersenses", uid)
```

`batch` collects every `update/insert/delete`, writes the batch and its changes on success, rolls back on any error, and clears the caches. Feature code (`core/tools/*`) never writes SQL directly for edits; that is why every feature is undoable, shows up in History and lands in the change log.

### 6.2 Kinds of edit

| Edit | Function | What it changes |
|---|---|---|
| a token's field | `edit_token` | lemma, POS, fine POS, dependency, event, head |
| span fields / bounds | `edit_span`, `create_span`, `delete_span` | boundaries, type, mention type, group, speaker, speaker mention. Quotes attributed through an entity follow its group and bounds (`_sync_quotes_for_entity`) |
| groups | `edit_group`, `merge_groups`, `regroup`, `move_variant`, `set_variants_prop` (`POST /api/group/{id}/variants/prop`: retype whole names), `edit_entities`, `delete_entities` | name, pronouns, hidden, checked; moving mentions between groups; merging |
| tokenisation | `split_token`, `merge_tokens` | changes the text units. Spans that ended on a split token now cover all its parts; boundaries inside merged tokens snap outward; character offsets are recomputed from the original text; then the sentence is re-tagged |
| sentences, paragraphs | `split_sentence`, `merge_sentence`, `set_paragraph` | flags on the first token; re-tagging follows |
| speakers | `set_speakers`, `_set_speaker` | a quote's speaker group + the nearest mention of that group outside the quote; `set_speakers(quote_rule=True)` also moves I/me/…/you/… inside each reassigned quote (`_quote_pronoun_moves`, `_other_side`, `core/tools/coref.py`) |
| review marks | `set_reviewed` | `tokens.reviewed` on a sentence's first token (`kind='review'`) |
| flags | `set_flag`, `clear_flag`, `clear_flags` (several, one step) | a row in `flags`, keyed by (kind, target); `kind='review'`, like checked and reviewed marks |
| Find, bulk | `bulk_edit`, `bulk_create`, `bulk_delete` | the same edits over all results in one step |
| rules and rules of thumb | quote rule, narrator rule, checks, pronoun pass, quote pass, collection carry-over | all end in `regroup`/`update` inside one batch |

**Group numbers are never reused.** A group is just a number on its mentions, and several things remember a group by its number outside the undo history: flags, "not the same" pairs, number keys, the narrator, the Quote tool's keys. So a new group (`_new_coref`) gets a number past every group the book has (the entities and `groups` tables), every one handed out before (`meta.coref_next`, saved with the step that uses it) and, the first time in an older working copy, every one in the recorded history.

### 6.3 spaCy suggestions

After a structural edit (split/merge/new sentence) `Store.retag` re-parses the affected sentences with spaCy *on the book's own tokens* and stores differences (lemma, POS, fine POS, dependency, head) in `proposals`. Nothing is applied until you accept it (`accept_proposals` is one undoable step). Fields in `manual` are never suggested. If spaCy or the model is missing, structural edits still work and you get no suggestions.

### 6.4 What "edited by hand" protects

`schema.TRACKED` lists which fields are tracked per table. `update(..., manual=True)` (the default) adds every changed tracked field to the row's `manual` list. Accepting a spaCy suggestion passes `manual=False`, so a later re-tag may improve it again.

---

## 7 Settings and other stores

| Where | What | Scope |
|---|---|---|
| `projects/NAME.sqlite` | everything in §4 | one working copy |
| `library.json` | (written atomically; a file that can't be read, or doesn't have the shape this version reads, is renamed `library.unreadable-TIME.json` rather than overwritten: `core/jsonfile.py`, as for `collections.json`) `sources` (folders to scan), `texts` (book key → original .txt path), `books` (book key → title, author, year, tags; empty fields are not stored), `exports_dir` (where Export writes to; absent means the default `exports/` next to the editor, see `Library.set_exports_dir`) | all books |
| `collections.json` | (read and written like `library.json`, `core/jsonfile.py`) `collections`, `members` (book key → collection), `lists` (per collection and `*` = all books): `characters` (each with `profiles` per book), `retypes`, `rules`; `settings.matching` (weights, thresholds and switched-off kinds for matching groups to characters, see `core/matching.py`), `settings.suggestions` (the same for the other suggestions, see `core/suggest.py`) and `settings.display` (small display settings, e.g. `context_sentences`, see `core/collections_store.py`'s `DISPLAY_DEFAULTS`) — all three edited on the Settings page (`/api/library/suggestions`, `/api/library/display-settings`) and saved as the differences from the defaults (so improved defaults reach every setting left alone). Saved atomically, indented so it can be read and compared, except that each character's profile of a book sits on one line (profiles are most of the file in a big collection; `Collections._text`). The list dialog shows each character's profiles added up (`Collections.summaries`; the list itself is sent without the profiles, `get_list(profiles=False)`) and exports a list (`export_list`: CSV summary or JSON in full, `/api/library/list/{id}/export`) | all books |
| browser `localStorage` | `bne.view`, `bne.textView`, `bne.n` (sentences per page), `bne.cols`, `bne.layers`, `bne.gside`, `bne.lastLayer`, `bne.pos.<working copy>` (last position), `bne.sideW`, `bne.sideOpen` (the side panel), `bne.qfTokens`, `bne.eaTokens` (context sizes), `bne.lib` (library: collection + sort), `bne.theme` (Settings' Appearance toggle: `light` or `dark`; absent means Auto, follow the OS) | this browser only; purely conveniences, safe to clear. The editor page reads them through `stored`/`storedNumber`/`storedObject` and writes them with `remember` (`app.js`), so a value it can't read, or a browser that keeps nothing, falls back to the default |

A **book key** is `"<output folder>::<book id>"` (e.g. `/home/you/books/output/emma::emma`). It identifies a *BookNLP book*, not a working copy, so all working copies of a book share collection membership. (These keys contain absolute paths: if you move the output folder, add it again and re-assign collections.)

**Collections** (`core/collections_store.py`, `core/tools/carry.py`): a list fills itself as you work: marking a group of a character type (PER and the types chosen for the `.book`) *checked* adds a character (names + counts, pronouns, type, and its profile for this book in `profiles[book id]`; *Update profiles from this book* and applying the collection's suggestions refresh the profiles of all linked groups); giving *every* mention of a name a new type by hand adds a retyped name; "Save as rule" in Find adds a rule (search + change, tag/type fields only, so it means the same in every book). Opening another book of the collection *offers* these for review (`carry_review`); nothing is applied without `carry_apply`. Groups are matched to characters by evidence (`core/matching.py`), against the characters' names from every book but their profiles from the *other* books only (`CarryTools._elsewhere`): within one book, neighbours and places say how close two groups are in the text, not who they are.

---

## 8 Export and the analyser

`Store.export(dest)` (button *Export*, route `POST /api/export`) writes `exports/BOOK-YYYYMMDD-HHMMSS/`:

| File | Built from |
|---|---|
| `BOOK.tokens`, `.entities`, `.supersense`, `.quotes` | the current tables, in BookNLP's exact column layout (sentence/paragraph numbers recomputed from the flags, heads as positions, span text rebuilt from tokens where `join_style` allows) |
| `BOOK.book`, `BOOK.book.html` | rebuilt: `bookfile.load()` uses the installed BookNLP's `get_syntax` (or the bundled verbatim copy) on the corrected data. Extra entity types you chose are shown to it as PER; each character also gets `name`, `collection_id`, and `type` fields. Pronouns are BookNLP's evidence combined for merged groups, or yours |
| any other `BOOK.*` kept at import | copied unchanged |
| `BOOK.changes.md` | every batch still applied, oldest first (review marks left out) |
| `BOOK.validation.tsv` | every tagged value outside the tag lists (`tagsets.py`) |
| `BOOK.characters.tsv` | every group: id, name, type, pronouns, mentions, quotes, "not a character", collection character |
| `BOOK.txt` | a copy of the original text (`meta.text`), unchanged |

`Store.export` makes the folder and then calls `_write_export`, which does one step at a time (`_export_tokens`, `_export_layers`, `_export_book`, `_export_validation`, `_export_changes`, `_export_characters`). If any step fails the folder is removed again, because the analyser (aLex) takes the newest folder of a book for its export and must never find half of one.

With no edits, `.tokens`, `.entities`, `.supersense` and `.quotes` are identical to BookNLP's, and `.book` is too apart from the added `name` fields (a test checks this).

The library page lists each working copy's exports from the exports folder, read once per page (`Library.exports_by_book`): a folder belongs to a book when its name is exactly `BOOK-YYYYMMDD-HHMMSS` (`EXPORT_RE`), so book `hound` never claims the exports of `hound-of-the-baskervilles`.

**The analyser** (aLex, a separate, optional project) never touches the editor's data files. You point it at the folder the exports are written to (`exports/` in your data folder, or the one set on the Settings page); it reads the newest dated export of each book. So the path `exports/BOOK-DATE/` and the file names above are an interface: renaming them breaks it.

---

## 9 The web layer

`luna/app.py` builds a FastAPI app around a `Holder` (the one open book + the library + the collections). Every book route starts with `cur()` (the open `Store`, or 409 "open one from the library") and converts `EditError` to a 400 with a readable message. The routes read their bodies directly (`int(body["a"])`), so a request with a field missing or of the wrong kind raises `KeyError`/`ValueError`/`TypeError`; those become a 400 naming what was wrong too, never a bare 500. Opening a file that isn't a working copy (`Holder.open`) is refused the same way and leaves the open book open.

* **Local only** (`localonly.py`). The server listens on 127.0.0.1, but a web page open in your browser can still reach it. Two header checks close that: only the `Host` names `127.0.0.1` and `localhost` are answered (against DNS rebinding), and a request that changes something is refused when its `Origin` is not this very server. Requests without an `Origin` (scripts, `curl`) pass.
* **One at a time, for long lists.** The suggestion queues (`/api/merge-suggestions`, `/api/quote-suggestions`) take `offset` and `limit`, and their pages ask for the one item they show, so every item can be reached however many there are; `/api/quote-suggestions?bundles=0` leaves out the bundles' quotes (most of the reply on a long book) for the tab's count. The front end asks for extras that cost the server a moment on a long book only when the page has been still for a moment (`whenIdle` in `app.js`): the count on the Speaker suggestions tab and the Speaker-Attribution side panel's "Possibly the same as". The server answers one request at a time per book, so asking for them on every step of a quick walk through quotes would hold up the next step.
* **One book at a time.** The page sends `X-Book: <working copy>` with every call; if another book was opened meanwhile the server answers 409 and the page shows a banner instead of editing the wrong book.
* **Save status.** Every `/api/…` reply of an open book carries `X-Last-Saved` (the working copy file's last write time). Every edit is committed immediately, so that *is* the last save. The header badge shows it.
* **Route groups:** `/api/library*` (library, collections, suggestion/display settings, exports folder), `/api/fs` (folder picker) · `/api/info`, `/api/window`, `/api/token`, `/api/span`, `/api/token/…/split` … (reading and editing text) · `/api/groups`, `/api/group`, `/api/mentions/*` (coreference) · `/api/merge-suggestions`, `/api/fragments`, `/api/fragment/{id}`, `/api/checks`, `/api/ppass*`, `/api/qpass*`, `/api/qfocus`, `/api/eattr*`, `/api/split*`, `/api/narrator*`, `/api/quote-*` (tools) · `/api/search`, `/api/bulk*` (Find) · `/api/carry*` (collections, character profiles) · `/api/flags`, `/api/flag`, `/api/flags/clear` (flags) · `/api/history`, `/api/undo`, `/api/redo`, `/api/export`. `/api/library*` and `/api/fs` work with no book open (the library and Settings pages need that); every other route needs one.
* **Pages:** `/` the editor (redirects to `/library` when no book is open), `/library` the library, `/settings` the Settings page (`static/settings.html`) — reachable from the library's sidebar and, once a book is open, from the editor header's Settings tab.
* **Header and navigator** (`index.html`, `app.css`): the top bar (`.bar`) is brand, view tabs and `.actions` (Find/Undo/Redo icon buttons, save status, Suggestions, the `⋯` menu `#moreMenu` with Settings, History, Export; `setMoreMenu` in `app.js` closes it on choosing an entry, outside click or Escape; its Theme buttons keep it open). `.actions` has `margin-left:auto`, so the gap after the tabs shrinks first and the group then wraps to a second row. The sentence navigator and Columns live in `#navbar`, shown by `renderMain` only in the Table and Annotation views (not with the entity filter on).
* **Front end** (`static/js`): `app.js` holds the state object `S`, the API helper, table and annotation views, the side panel and Find; the other files add tabs and tools to it (`entities.js` the Entities tab and Back navigation, `rules.js` checks/narrator/collection panes, `corefui.js` selection/paint/number keys/groups sidebar/entity filter, `quotesug.js` speaker suggestions, `fragui.js` the Fragments pane, `splitui.js` the Split pane, `passui.js` the engine both passes share (`makePass`) with the pronoun pass, `qpassui.js` the quote pass, `bulk.js` bulk actions on Find results). All scripts share one global scope, so names are prefixed by area. Data flow is always: click → `api(...)` → server edits → `refresh()` redraws from the server's answer. A side panel's group/speaker field is always a coloured chip (`groupFieldChip`, `entities.js`) that opens the shared group picker (`groupPicker`); the picker normally has one button, or `chosen` (group ids, a "Ticked" row of quick picks, used by the Entities list's Merge…, which also passes `near` = the first ticked group's first mention from `/api/group/{id}/step`, so the ticked groups can be merged into one of themselves or any other group), or `actions` (a list of {key, label}) for more than one way to apply the same choice, as the Quote side panel and the Quotes view use for "Assign + Quote-Rule" (the default for a quick pick) / "Assign". The pronoun and quote passes are one piece of code with two descriptions: `makePass(spec)` in `passui.js` is the engine (start, stop, fetch an item, the bar, the settings popup, the keys) and each kind is a `spec` saying what differs (its API calls, what a "move" does, the sentence in the bar, what can be skipped); `PRONOUN_PASS` is in `passui.js`, `QUOTE_PASS` in `qpassui.js` (which also holds `QUOTE_TOOL`, the spec parts the quote pass and the Speaker-Attribution view share: the speaker keys and suggestions as `choices`, the settings rows, `moveTo`), `QUOTE_FOCUS` in `qfocusui.js`, and every pass registers in `PASSES`, which the rest of the page goes through (`stopPasses`, `syncPassItems`). A spec's API calls are written out with literal URLs so that `tests/test_static.py` can still match them with the routes. The passes share one `#banner` bar and are mutually exclusive with each other and with paint mode; `renderMain`'s `syncPassBanner` hides that bar away from the annotation/table view (the pass itself stays paused, not stopped) and `refresh()` re-fetches each running pass's current item after any edit (`syncPassItems`), so a manual change elsewhere is reflected without leaving the pass. Each pass's settings also carry an `advance` ('auto', the original behaviour: Keep/a candidate calls the engine's `on`, which goes on with `go(ord=…&dir=next)`; or 'manual': they stay put via `go(uid=…)` instead, and the bar's Skip button is relabelled Next — the same `→`/`data-[q]p="next"` action either way, since advancing was already independent of deciding) — set in the settings popup below Skip, independent of the preset and carried over when it changes (`set_pass_settings`/`set_qpass_settings`, `core/tools/rule.py`). The Find bar closes with its results: `runFind` marks `S.find.shown` and `renderMain` calls `hideFindBar` once `S.mode` is no longer `'find'`, so every route out of the results (Back, a hit, another view) is covered in one place. Entities' Compare pane (`comparePaneHTML`, `entities.js`) holds two groups picked from the list (`S.ch.cmpA`/`cmpB`) and shows their profiles side by side (`profileHTML`, the same layout as the library's "Full profile"), with a menu to merge them (into either one, or into a third — existing or brand new, via `groupPicker`'s `allowNew`).
* **Shift-click range select** (`static/js/rangetick.js`, loaded by index.html and library.html): a tick box's change handler calls `tickRange(box, 'datakey', set, {num, excl})`; it applies the box's state to all boxes `data-<key>` between the last-clicked box (`rangeAnchor`, by value, survives redraws) and this one when Shift was held on the click (`shiftHeld`). `excl` is for lists where the set holds the unticked rows. Not used for the sentence-suggestion accept boxes (`data-sid`).
* **Group page mention list** (`groupDetailHTML` in `entities.js`, `Store.group_detail`, `GET /api/group/{id}?props&cats&q&sort&by`): filtered, sorted and grouped on the server over the whole group, then paged. Besides the page it returns `shown` (what passes the filters; `total` stays the group's size), `uids` (all shown, in order, for select-all), `groups` (runs of equal `by` value with their uids, for header ticks) and `facets` (count per mention type and entity type of the whole group, for the "Show" drop-down: tick boxes, an empty `S.ch.mf` set = show all, `toggleShown`). State `S.ch.mf`, reset by `resetGroupPage`; ticked mentions (`S.ch.mchecked`) survive paging and are pruned to `uids` on every draw. The group's entity type menu (`#gtype`, per-type `data-remap` menus when mixed) calls `Store.retype_group(cid, {old: new})` (`POST /api/group/{id}/retype`), one undo step.
* **Speaker-Attribution view** (a tab of Quotes: `quotesNav` draws the tabs above it, `setQPane('focus')` is `setView('qfocus')`, and the top row highlights Quotes; `QUOTE_FOCUS`, `qfocusui.js`; data from `tools/focus.py`, `GET /api/qfocus`): the pass engine used a third way. A spec with `view: 'qfocus'` lives in its own view instead of the annotation view (`S.view`; `renderMain` drops the pass when the view changes, `stop` returns to the text view), has no skip rules and walks all quotes, or one speaker's (`speaker` on `/api/qfocus`, `qfSpeaker`; the walk is over the filtered list, the attribution and context always over all quotes) (`reading: true`: `←` is the previous quote in the book, not the previous one visited), and draws the bar itself into `#qfBar` (`barHost`) with `spec.draw`. The server answers with the quote pass's item plus `before`/`after` (the rest of the sentence either side of the quote, cut at a neighbouring quote or `ATTRIBUTION_MAX` tokens) and `above`/`below` (the `tokens` asked for, cut into passages: each quote with its speaker read from the quotes table, the narration between), words with a "space before" flag taken from the token offsets. Nothing is cached, so the speakers in the margin are as current as the last edit. The side panel (`renderQFPanel`, reached through `renderPanel`) shows the speaker's group page extracts (`/api/group/{id}`, and, once the view is still, `/api/merge-suggestions?group=` into `#qfSame`, the last list staying up meanwhile) with merge into another, a new entity from the speaker mention (`mention.uid` of the reply, moved with `/api/mentions/regroup`) and Open in Entities. The Speaker suggestions page (`quotesug.js`) reuses its reading area: `qfReading(x, marks, who)` draws context, quote and attribution from `GET /api/qfocus?uid=` for the current suggestion, `marks` (`qfMarks` here, `sqMarks` there) are the highlighted mentions (BookNLP's bold, the suggested one dashed), and the card above it (`sqCardHTML`) stays the page's own. Its side panel is the Speaker-Attribution one too: `qfCur()` names the quote the panel is about (`S.qf.cur`, or `S.qv.sqCur` on that page), and `renderPanel` hands over to `renderQFPanel` for both. The context size is the browser's (`bne.qfTokens`), not the book's, and is shared by both (`setQfTokens`); `fitReading('qf')` shrinks the quote (30 px at most) and then the context (at most 85% of the quote) until they fit. The Quote tool's settings (`meta.qpass`: `keys`, `suggest`, `advance`; skip belongs to the pass) are shared by both uses: `quoteChoices` puts the pinned speakers on keys 1.. and the suggestions (`_qpass_item` → `QuoteTools.quote_candidates`: at most 5, never the speaker or a pinned one) after them. The sources fill in a fixed order: *evidence* (the Speaker suggestions' scoring of this one quote, `_quote_score` over the edit's `SpeakerContext`; after an edit, gathering the context costs about 0.15 s at 190k tokens and the quote itself next to nothing), *conversation* (neighbouring quotes of the same run, `CONVERSATION_MAX` 3), *nearby* (`nearby_groups`, as before).
* **Entity-Attribution view** (`ENTITY_ATTR`, `eattrui.js`; data from `tools/eattr.py`, `GET /api/eattr`, settings `PUT /api/eattr/settings` in `meta.eattr`): the same engine and layout as the Speaker-Attribution view, for entity mentions. Two engine hooks exist for it: `spec.at(x)` (the order position the server walks by, here `x.pos`, the mention's index in the book's mention list, because nested mentions can start on the same token; the server's `ord` is such a position, `dir=here` returns the first one at or after `ord + 1`, and `startQuery` begins a walk from a token with `tok=`) and `c.key` on a choice (a choice tied to its own number key). The walk is over the filtered list (`group`, `prop`, `cat` on the route; `eaGroup`/`eaProp`/`eaCat`); the reply carries the mention, its `core` (the sentence it sits in), `above`/`below` (`tokens` each side) as regions `{start, words, space, brk, marks}` (`brk`: paragraph breaks; `marks`: every mention overlapping the region, with group, type and mention type), and the filters' counts. `eaParagraph` nests the marks per paragraph (a mention crossing the end of the one it starts in is cut there) and draws each as `.em` with a label `.eml` stacked above its inner ones. The side panel is not special: `drawEAttr` sets `S.sel` to the mention's entity span and `renderPanel` draws the annotation view's `spanPanel`, whose actions (via `refresh` → `syncPassItems`) keep the view current; if the mention was deleted, `eaFetch` shows the one that took its place. Choices (`eaChoices`): the groups in `S.hotkeys` stay on their keys, the free keys in order take the suggestions (`_eattr_candidates`: `_gender_candidates` over nearby groups, kept to the mention's own entity type, never its group or a pinned one, at most 5). Moving and confirming are `MENTION_TOOL` (`passui.js`), shared with the Pronoun pass. The context size is the browser's (`bne.eaTokens`). While such a pass runs, `refresh()` after an edit leaves the view and its side panel to the pass's own refresh (`viewPass()`; `syncPassItems` redraws both with the fresh item), instead of drawing them first with the old one. A pass with its own view remembers its last item (`me.last`, per book, in memory only): `start()` without a place resumes there (`uid=`), falling back to the usual start if the item is gone; `spec.leave` gives back what the view borrowed (this view's selection) when it is left.
* **Fragments pane** (`fragui.js`; data from `tools/coref.py`, `GET /api/fragments` for the list, `GET /api/fragment/{id}` for one): the queue on the left replaces the groups list (`renderChars` asks `fragAsideHTML` for the aside and adds `.listread`/`.reading`, the layout any tool with its own list gets), the middle is a reading view with an attribution-style bar drawn by `frPaneInner`/`frBarHTML` (not `makePass`: see DESIGN.md OP-11). State is `S.ch.fr` (list page, fetched details by id + size + tokens, the mention shown `at`, the offer, the panel item) with `S.ch.fskip` (place in the queue) and `S.ch.frag` (details, set through `frSet`, which also redraws the side panel: `qfCur()` returns `S.ch.fr.panel` there, so `renderQFPanel` shows the fragment as an entity; `qfPanelLeft()` in `renderMain`/`renderChars` puts the usual panel back when the page is left). Each mention of a detail has `core`/`above`/`below` regions (`_eattr_reading`, shared with the Entity-Attribution view) drawn with `eaRows`, its `quotes` (inside one / its speaker mention), and the detail has nine `candidates` and `same_name`. Moving (`fragGo`) redraws only the aside and the middle and prefetches the next fragment's details; an edit on the whole fragment (`fragDo`: merge with the bigger group keeping its number, keep = checked, hide, delete) drops it from the page, shows the prefetched next one at once (unless the edit touched it) and then `refresh()`es, which redraws the pane from the server. An edit on the mention shown (`fragSplit`: Shift; `/api/mentions/regroup` or delete) keeps the fragment and, by the browser's `bne.frAdvance`, goes on to the fragment that came next or stays, either found again by id (`fr.goId`) since the fragment can move down the queue. After a whole-fragment assign, `frOfferFor` builds the same-name offer from the details fetched before it; `Y` merges the ticked ones into the surviving group in one `/api/groups/merge`. Keys: `fragKey` (called from the Entities key handler; digits read from `e.code` so Shift+digit works), clicks: `fragClick`, fields: `fragChange`.
* **Split pane** (`splitui.js`; data from `tools/split.py`: `GET /api/split/groups[?q=]`, `GET /api/split?group=&ord=&dir=|uid=|n=&tokens=`, `PUT /api/split/settings` in `meta.split`): an `EXTRA_PANES` tool that uses the hooks `renderChars` offers any tool (`aside()` for its own list instead of the groups, `reading` for the `.listread`/`.reading` layout, `drawn()`, and `count()`/`card(n)` for its badge and overview card). The likely groups come from `_split_reasons` (the "mixed" pronoun check of `_group_genders`, and `_name_reasons` over the group's proper names: male and female titles via `title_gender`, two `first_names`, and `_name_parts`: names joined into sets by a shared capitalised word, two or more sets meaning no word in common); checked and hidden groups are left out, a search (`groups_list`) finds any. The walk is the Entity-Attribution view's over one group (`pos` = index in the book's mentions; `dir=here` as there), without mentions confirmed in the group (`confirmed` table, `_kept`) when `skip_kept` is on; each item has `_eattr_reading`'s regions, `candidates` (`_gender_candidates` of its type, never its group) and `scopes` (`text`, `pron` via `PRON_CLASS`, `para` via `_para_bounds`; never a kept mention). The front end keeps `S.sp` (search and list, group, the query for what to show next `want`, last reply, scope, lanes per group, panel item). Choices (`spChoices`): "back to" the group when the mention shown has left it, the lanes, then the candidates, at most nine. Moving is `/api/mentions/regroup` with the scope's uids (`spUids`), keeping is `/api/ppass/confirm`; a move ends with `refresh()` (`want` = the next mention, or the same with Manual), which redraws the pane; ←/→, scopes and Keep redraw only the list and the middle (`spGo`/`spDraw`). The side panel is `renderQFPanel` through `qfCur()` (`S.sp.panel`).
* **Entity filter** (`S.ef`, `corefui.js`): picking a group combines its page of `/api/entity-context/{gid}` excerpts into one synthetic `S.win` (same shape `loadWindow` builds), so `renderAnnot` draws it — and everything in it edits — unchanged; a divider marks where two excerpts aren't adjacent sentences. The left-hand picker (`efListHTML`) is the same `/api/groups` list the Entities tab uses.
* **Flags** (`S.flags`, `app.js`): every flag is fetched once (`loadFlags`, alongside `loadClusters` in `init`) into a `Map` keyed `"kind:target"`, so a flag button (`flagButton`) can show its state without a call per target; the count badge sits on the header's flag icon (`#flagsBtn`, which toggles the view). `openFlagPopup` (the shared `pop` element) adds, edits or removes one; any change (`afterFlagChange`) refetches the map and redraws whatever view is open. The Flags view is `flagsui.js`: it reads `/api/flags` fresh when drawn into `S.fl.items`, and filtering (kinds, note, set-by, search), ordering and selection (`S.fl.sel`, keys `"kind:target"`) only redraw the list from that copy (`flDraw`). A filter change drops the selected flags it hides; only "Select all N flags" can select hidden ones, and the bar then counts them. Delete (one or the selection) is `POST /api/flags/clear`, one undoable step.
* **Library page** (`library.js`, `libfilter.js`): search box, collection sidebar and sort are pure browser-side filtering (`LibFilter`, unit-tested under node). The server reads each working copy's summary (changes, review progress, token count) only when the file has changed since it last did (`Library.project_info`, keyed by the file's modified time and size), so the page stays quick with dozens of long books.
* **Settings page** (`settings.js`): folders with BookNLP output, where exports are written, display settings, an Appearance toggle (Auto/Light/Dark) and suggestion settings (collection matching, merge, fragments, speaker) — everything that applies to every book, in one place. Shares `pageui.js` ($, `api`, `toast`, the modal, the folder/file browser) with `library.js`, since both are separate pages from the editor. A table of contents (`#settingsToc`, `.setwrap`/`.stoc` in `library.css`) sits beside the scrolling `.lib` column; only `.lib` scrolls, so the table of contents stays in view and highlights the section nearest the top as you scroll (`trackToc`).
* **Theme** (`theme.js`, `app.css`): `theme.js` also owns reading and writing the setting (`getTheme`, `setTheme`, `markTheme`), shared by the editor's [...] menu and the Settings page; every page (`index.html`, `library.html`, `settings.html`) loads `theme.js` first, in `<head>`, before its stylesheet — it reads `bne.theme` from `localStorage` and sets `<html data-theme>` before the page paints, so there's no flash of the wrong theme. `app.css`'s colours are CSS variables in `:root` (light) with a dark set under `@media (prefers-color-scheme:dark)`; `data-theme="light"`/`"dark"` (set by the Settings page's Appearance toggle) override that default in either direction. No `data-theme` (Auto, the default) just follows the OS.

---

## 10 Tests

`python -m unittest discover -s tests -t .` (about 20 s; uses Python's `unittest`, and needs only `pip install -e ".[dev]"`: FastAPI's test client wants httpx. Tests that need an optional part (spaCy, torch, node, the working copies in `projects/`) skip themselves when it is missing; CI runs the suite on Python 3.10 and 3.13). `BNE_SCALE=1` adds the 190,000-token book (+15 s); `BNE_REAL_BOOKS=all` runs the real-book checks on every working copy. `tests/synthetic.py` writes BookNLP output of any size (`python -m tests.synthetic OUT SENTENCES`) and `python -m tests.scale book|library` times the editor on it (§12).

| File | Covers |
|---|---|
| `fixture.py` | a tiny hand-annotated book in BookNLP's file formats + the `BookCase` base class |
| `test_edits.py` | tokens, spans, quotes, history/undo/redo, search & bulk basics, tokenisation, suggestions |
| `test_find.py` | phrase search, context filters, batch create/delete of entities, supersenses and quotes |
| `test_groups.py` | groups, merging, moving mentions, new group numbers never reused, scopes, suggestions (and a page of them), fragments, hotkeys, the quote rule and its per-quote pronoun moves on speaker reassignment, entity-filter excerpts |
| `test_embed.py` | transformer speech embeddings: computing, dropping stale ones, combining, matching, settings (a real small BERT when downloaded) |
| `test_imports.py` | every core module imports on its own (no circular imports) |
| `test_matching.py` | matching groups to collection characters by evidence; recording checked groups with it |
| `test_rules.py` | speaker suggestions (and a page of them), narrator rule, checks, pronoun pass, quote pass (keys, suggestions), Speaker-Attribution view |
| `test_eattr.py` | Entity-Attribution view: walk, filters, sentence and marked context, suggestions, settings |
| `test_split.py` | Split tab: the likely groups and their reasons, search, the walk over one group, kept mentions, scopes, settings |
| `test_carry.py` | collections, carry-over, saved rules (a hand-edited rule that may not run), a `collections.json` that can't be read or has the wrong shape |
| `test_profiles.py` | character profiles read from a book, adding them up, keeping them in the collection |
| `test_speakers.py` | the nearest-mention lookup (`core/speakers.py`) against the plain rule, on random books |
| `test_degenerate.py` | books with no mentions or quotes, or a single sentence: every view and tool answers |
| `test_scale.py` | a synthetic book of 3,000 sentences always (big edits undo exactly, speaker links are the nearest mentions, export re-imports); with `BNE_SCALE=1` one of 20,000 sentences with time limits on what used to be slow |
| `test_flags.py` | flags on a mention, quote, group or sentence: set/update/clear, clearing several in one step, the `auto` mark, every kind, only existing targets, undo, orphans dropping out of the list |
| `test_cleanup_import.py` | parsing a cleaned folder's `.groups.tsv`/`.cleanup_log.tsv` (rows that can't be read are skipped), naming plural groups and flagging unsettled quotes from them, both directly and through `create_project`, and importing with a broken one |
| `test_export.py` | export files, `.book` rebuild, no-edit export equals BookNLP's, re-import |
| `test_fuzz.py` | random edit sequences keep every invariant (spans line up with the text), undo/redo restore exactly, and every cache equals a fresh computation |
| `test_app.py` | the web API end to end, library (a book's own exports only; a `library.json` of the wrong shape; the books folder is always scanned; reveal shows only library folders), collections, pages served; malformed requests get a readable 400; a file that isn't a working copy is refused; the local-only guard; the `--data` folder |
| `test_example.py` | the example book in `examples/` imports (its offsets match its text) and exports |
| `test_static.py` | every script parses; every `api('METHOD', '/api/…')` call matches a route and every route has a caller |
| `test_library_view.py` | library search/sort/collection filter (runs `libfilter.js` under node) |
| `test_real_books.py` | runs on **copies** of your own working copies in `projects/` (originals never opened for writing; skipped when there are none); `BNE_REAL_BOOKS=all` uses all of them |

---

## 11 Adding a feature

1. **Data first.** Decide whether it is *derived* (compute it from the tables in a `core/tools` mixin; cache with `_memo`) or *stored* (a `meta` key for a small setting; a table only if it is real content).
2. **Edits go through `batch`** with a human label; that gives undo, History and the change log for free.
3. **Route** in `luna/app.py`: a thin function calling `cur().your_method(...)`, with a one-line docstring.
4. **Front end**: call it with a literal `api('METHOD', '/api/…')` (the contract test looks for literal URLs), redraw with `refresh()`.
5. **Tests**: store-level in `tests/test_*.py` using `BookCase`; one API-level test in `test_app.py`.
6. **Design**: follow `docs/DESIGN.md` (its §13 is the checklist) and add a row to its decision log when you decide something.
7. **Docs**: a docstring on every function (what and how), a line in this file if it adds data, and `guide.md` if a user should know.

---

## 12 Working at scale

The editor works on one book at a time, but a corpus is many books: a long novel is 150,000–250,000 tokens (a few thousand groups, ten thousand quotes), and a series in one collection can reach dozens of books and a thousand characters. `tests/synthetic.py` writes BookNLP output of any size with a realistic shape (a few large groups and a long tail of small ones, tagged and untagged quotes, names, pronouns and descriptions), `tests/scale.py` times the editor on it and `tests/test_scale.py` guards the results. All numbers below are from one laptop and say what order to expect.

**One long book** (`python -m tests.scale book 20000 3000`: 188,000 tokens, 34,000 mentions, 9,000 quotes, 2,300 groups):

| | time |
|---|---|
| import (`create_project`), open, `info` | 1.6 s, 0.2 s, 0.2 s |
| a page of sentences, the groups list, a group's page, the quotes list | 0.01 s each |
| a search with 100,000 hits (one page of it), a phrase search | 0.06 s, 0.2 s |
| merge suggestions (first time after an edit; 2,300 groups, 1,600 suggestions), speaker suggestions | 1.3 s, 0.45 s |
| give 3,000 quotes to a speaker (with the quote rule) | 0.14 s (0.3 s); was 21 s (13 s) |
| move 3,000 mentions, merge 50 groups | 0.1 s, 0.4 s |
| change every noun's POS in bulk, make an entity of every *said* | 0.9 s, 0.2 s; the second was 14 s |
| undo, redo, mark 5,000 sentences reviewed | 0.05 s, 0.07 s, 0.2 s |
| export (including the rebuilt `.book`) | 2.7 s |
| a step in the Quote tool: a new speaker, then the next quote with its suggestions | 0.3 s; was 0.6 s |
| a step in the Pronoun pass / Entity-Attribution view: move a mention, then the next one | 0.2 s |
| … the Speaker-Attribution side panel's merge suggestions, the Speaker suggestions tab's count | 0.85 s, 0.3 s, asked for only once the view is still (they were asked for on every step, adding about 2 s to each) |

**A collection over many books** (`python -m tests.scale library 45`, 4,000 sentences per book, 30 characters marked checked per book): marking a group as checked, which records it in the collection, takes 0.35 s with 988 characters in the collection (0.14 s with 29); opening a book to review what the collection offers takes 2 s (0.1 s); `collections.json` is 3 MB. Both grow in step with the number of characters, not faster.

What makes this hold, and what to keep in mind when changing code:

* **Never scan a table per item.** The slow cases were all one query per quote, mention or new row: finding the nearest mention of the speaker's group for each of 3,000 quotes (now `core/speakers.py`: the group is read once, then a binary search per quote), and choosing the next free id for each of thousands of new rows (now the `changes(tbl, uid)` index). Loops that touch many rows read what they need once before the loop.
* **Derived values are cached, and the cache policy is deliberately fine-grained** (§5): rebuilding the token arrays or the profiles of a 190,000-token book takes a second, so a step that cannot change them must not drop them. Marking a sentence reviewed or a group checked, and flagging, are the most frequent steps and leave the expensive caches alone.
* **Only ask for what is shown.** The Entities view asks for the collection review (every group against every character) only where it is displayed; the `.book` preview of a group builds the character data, not the HTML report; the library list is sent without character profiles and the list dialog draws the first 150 characters that match its filter ("Show all" for the rest); the type-ahead list of groups holds the 800 biggest plus the 200 newest (a group you just created is always offered).
* **Write once, write cheaply.** `collections.json` is saved after every change, so its writer keeps profiles on one line (ten times faster than indenting everything); a working copy's summary on the library page is read again only when the file changed.
* **Quadratic by nature, and bounded:** comparing every pair of spelling variants of a name within a type and first letter (merge suggestions) runs only over distinct words of similar length and gives up beyond 4,000 words of one block (`SPELLING_MAX_WORDS`); comparing a group with every character of a collection (`Matcher.rank`) skips building the readable reasons for the thousands it discards.
* **What a step costs is what to watch.** In the passes and attribution views you edit and move on hundreds of times in a row, and every edit drops most caches, so whatever the next item asks for is worked out again: the Quote tool scores only the quote it shows (`SpeakerContext`), the views redraw once per step (`viewPass`), and extras wait until the view is still (`whenIdle`). `tests/scale.py` times these loops.
* **One item at a time.** A long book has thousands of merge and speaker suggestions: their pages fetch the one they show (`offset`), never a capped list.
* **Known limits.** The first merge-suggestion computation after an edit takes about a second on a book with thousands of groups (mostly the character profiles of every group), and while it runs another request waits (one connection, one lock per book). The profile function-word statistics are English. The library page lists every book at once (searchable and sortable, fine for a hundred books). Settings kept in `meta` rather than in the undo history (the narrator, number keys, dismissed suggestions, confirmations) aren't undone with a step: merging the narrator's group into another moves the narrator setting to it, and undoing the merge leaves it there.
