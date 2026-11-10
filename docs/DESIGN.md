# Luna design language

The visual and interaction design of the Luna editor, written down so that new features follow it and companion projects (e.g. aLex) can adopt it. Last verified against the code: 2026-10-09 (`luna/static/css/app.css`, `library.css`, `static/js/*`).

## 0. How to read and use this document

**For people:** read §1 (principles) and §11 (decision log) for the *why*, then look up the component or pattern you need. §13 is the checklist for designing a new feature; §14 is for porting to another project.

**For tools and agents:** every normative statement has a stable ID (`DL-<AREA>-<nn>`) so it can be cited in a prompt, a review or a commit ("violates DL-COLOR-04"). Wording follows RFC 2119: **MUST** = breaking it is a bug, **SHOULD** = break it only with a reason you can state, **MAY** = optional. The design tokens are in one fenced `json` block (§3.1), which `tests/test_design.py` compares with `app.css`, so that block cannot silently go stale; everything else is prose and tables.

**Status tags** used throughout:

| Tag | Meaning |
|---|---|
| `[impl]` | Implemented in the editor and verified against the code at the date above. |
| `[rule]` | A rule for new work; existing code mostly follows it, exceptions are listed in §12. |
| `[open]` | Not decided or not yet consistent; see §12. |
| `[portable]` | Carries over to a companion project unchanged. |
| `[luna]` | Specific to the book/NLP domain; adapt rather than copy. |

When this document and the code disagree, the code is what users see; fix whichever is wrong and update §12 (do not leave the disagreement unrecorded).

## 1. Principles

These are inferred from what was built and the user's decisions (§11); they are the tie-breakers when a rule is silent.

- **DL-PRIN-01 — Text is the subject, chrome is quiet.** `[portable]` The book's words are the largest, most contrasted thing on screen; UI around it is small, grey (`--muted`) and borderline-invisible until needed. Annotations are drawn *on* the text (bars, underlines, tinted marks), not beside it.
- **DL-PRIN-02 — One colour per entity, everywhere.** `[luna]` A coreference group (entity) has one hue, derived from its id (§4.3), and that hue appears identically in annotation bars, chips, swatches, list rows, context marks and the side panel. Colour is identity; it is never decorative.
- **DL-PRIN-03 — Everything is undoable and saved at once.** `[portable]` There is no Save button. Every edit is one history step; destructive actions are therefore not confirmed unless they are large (DL-INT-05). The header shows the save state (`Saving…`, `Saved 2 min ago`, `Not saved`).
- **DL-PRIN-04 — The keyboard is first-class for repeated work.** `[portable]` Anything done hundreds of times (assign a speaker, keep, skip) has a single-key shortcut, shown on the control (`<kbd>`), and a plain button for the first-time user.
- **DL-PRIN-05 — One way to look, several ways to work.** `[portable]` New tools reuse an existing layout (reading view, list + detail, card list, bar) rather than introducing a new one. The Entity-Attribution view was built by copying the Speaker-Attribution layout, the Compare pane by reusing the side-panel group-field look; that reuse is the pattern.
- **DL-PRIN-06 — Explain, don't hide.** `[portable]` Suggestions carry their reasons (tooltip, "All reasons", reason line); thresholds and weights are user-editable on the Settings page. Automatic results are always shown as *suggestions* in a visibly different style (dashed) from confirmed values (solid).
- **DL-PRIN-07 — Plain and calm.** `[portable]` System fonts, one accent colour, no gradients, no illustrations, no animation beyond short feedback. Density is high (13 px base) because the user works for hours on long books.
- **DL-PRIN-08 — Local and honest.** `[portable]` The app edits a working copy and never touches the source files; copy and tooltips say what a control will and will not change.

## 2. Architecture constraints that shape the design `[impl]`

- **DL-ARCH-01 — No framework, no build step.** Static HTML + one global stylesheet + plain JS files loaded by `<script>`; markup is built with template literals. All user-supplied text MUST pass through `esc()` before entering markup.
- **DL-ARCH-02 — One stylesheet for the editor.** `app.css` holds tokens, base elements and every editor component; `library.css` is loaded *after* it on the library and Settings pages only and adds page-level layout. A new component's CSS goes in `app.css` under a comment banner naming its JS file (`/* ---- the Entity-Attribution view (eattrui.js) */`).
- **DL-ARCH-03 — Event delegation by data attribute.** Interactive elements carry `data-act` / `data-qact` / `data-cx` etc.; one listener per container reads them. No inline handlers except trivial navigation in banners.
- **DL-ARCH-04 — Every function has a comment above it** (JS) or a docstring (Python); `tests/test_docs.py` enforces it. UI code follows this like all other code.
- **DL-ARCH-05 — Browser-local preferences** live in `localStorage` under the prefix `bne.` (`bne.theme`, `bne.sideW`, `bne.sideOpen`, `bne.n`, `bne.cols`, `bne.qfTokens`, `bne.eaTokens`) and every access goes through helpers that fall back to the default when storage is unavailable or holds something unreadable (`stored`, `storedNumber`, `storedObject`, `remember` in `app.js`; the library page and `theme.js` wrap their few accesses in try/catch the same way). Settings that belong to the *book* are stored in the book (`meta.*`); settings for *all books* are on the Settings page and stored server-side. Never store book data in `localStorage`.
- **DL-ARCH-06 — Two pages, one shell.** The editor (`index.html`) is a single page with view switching; Library and Settings are separate pages that share the header, tokens and `pageui.js` helpers (`$`, `api`, `toast`, `modal`, `browse`).

## 3. Tokens

### 3.1 Machine-readable token set `[impl]`

Source of truth is `app.css` (`:root`, the `prefers-color-scheme: dark` block, and `:root[data-theme="dark"]`). This block is checked against it by `tests/test_design.py`; edit both together. Values with a leading `#` are sRGB hex; `*L`/`*S` entries are HSL lightness/saturation in percent; `ta` is an alpha.

```json
{
  "color": {
    "light": {
      "bg": "#E7EBEF", "surface": "#FAFBFC", "sunk": "#EEF1F4", "ink": "#17202B", "muted": "#5A6573",
      "line": "#CBD2DA", "line2": "#DEE3E8", "accent": "#2A54C6", "accent-ink": "#FFFFFF",
      "accent-bg": "#DCE5FA", "danger": "#B3312E", "warn": "#A86400"
    },
    "dark": {
      "bg": "#12161C", "surface": "#1A2029", "sunk": "#222A35", "ink": "#E3E8EE", "muted": "#9BA6B4",
      "line": "#2E3744", "line2": "#262E39", "accent": "#86A5F6", "accent-ink": "#0E1522",
      "accent-bg": "#233252", "danger": "#F08079", "warn": "#E3A857"
    }
  },
  "group-hue": {
    "light": { "cl": "40%", "cs": "60%", "ta": "0.17", "chipl": "40%" },
    "dark":  { "cl": "70%", "cs": "60%", "ta": "0.24", "chipl": "34%" },
    "fill-saturation": "80%", "fill-lightness": "55%",
    "hue-formula": "round(((id * 137.508) mod 360 + 360) mod 360)"
  },
  "fixed-color": {
    "ok-solid": "hsl(145 45% 40%)", "ok-bar": "hsl(145 45% 42%)",
    "ok-text-light": "hsl(145 45% 32%)", "ok-text-dark": "hsl(145 45% 62%)",
    "on-solid": "#fff", "scrim": "rgb(0 0 0 / .35)"
  },
  "font": {
    "ui": "-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,\"Helvetica Neue\",sans-serif",
    "mono": "ui-monospace,\"SF Mono\",Menlo,Consolas,monospace",
    "read": "\"New York\",Georgia,\"Times New Roman\",serif",
    "base-size": "13px", "base-line-height": "1.45"
  },
  "radius": { "xs": "3px", "sm": "6px", "md": "8px", "lg": "10px", "xl": "12px", "pill": "999px" },
  "shadow": {
    "popover": "0 14px 34px -14px rgb(0 0 0 / .4)",
    "drawer": "-10px 0 30px -14px rgb(0 0 0 / .35)",
    "modal": "0 24px 60px -20px rgb(0 0 0 / .5)"
  },
  "z": { "arcs": 2, "overlay": 3, "sticky-bar": 6, "drawer": 30, "popover": 40, "toast": 50, "modal": 60 },
  "breakpoint": { "stack-side-panel": "900px", "library-sidebar": "820px", "two-column-cards": "760px", "collection-row": "700px" },
  "layout": { "side-panel-default": "380px", "side-panel-min": "260px", "side-panel-max": "60vw", "side-panel-collapsed": "30px", "groups-sidebar": "232px", "entity-list": "minmax(280px,360px)", "settings-toc": "190px", "library-content-max": "1040px" }
}
```

The dark palette is defined **twice** in `app.css` (once under the media query, once under `[data-theme="dark"]`) because CSS cannot share a rule between the two conditions; the test checks both copies equal this block.

### 3.2 Using tokens

- **DL-TOK-01 — MUST** use the colour variables, never literals, for neutrals and accent. The only literals allowed are the `fixed-color` entries above (§12 lists where they are still scattered).
- **DL-TOK-02 — MUST** work in both themes. A new colour is added as a variable with a light and a dark value, in all three places in `app.css`, and in §3.1.
- **DL-TOK-03 —** Theme is `auto` (OS) / `light` / `dark`. `theme.js` is loaded in `<head>` *before* the stylesheet and sets `html[data-theme]` so the page never flashes the wrong theme; `auto` leaves no attribute. The control is a three-way segmented button (Menu → Theme, and Settings → Appearance).
- **DL-TOK-04 —** `color-scheme` is set with the theme so native controls (scrollbars, date inputs, checkboxes) match.

## 4. Colour

### 4.1 Neutrals `[impl]`

| Token | Role |
|---|---|
| `--bg` | Page background and sticky bars sitting on the reading surface (`.avbar`, grid header, sentence rows). The darkest light-mode neutral. |
| `--surface` | Everything raised above `--bg`: header, cards, panels, inputs, buttons, popovers, the reading area. |
| `--sunk` | Hover rows, code-like context boxes, selection bars, kbd keys, disabled-looking containers. One step *into* the page. |
| `--ink` | Text. Also the fill of the toast (with `--bg` text) and the multi-select outline. |
| `--muted` | Secondary text, labels, icons, chrome. Meets AA on `--surface` in both themes (verify when changing). |
| `--line` | Borders of controls and cards. |
| `--line2` | Hairlines between rows inside a container. |

- **DL-COLOR-01 — Layering order** (back to front): `--bg` → `--surface` → `--sunk`. A container on `--surface` uses `--sunk` for its hover/inset states, never `--bg`.
- **DL-COLOR-02 — Borders are 1 px.** `--line` around a thing, `--line2` between things inside it. The 2–3 px coloured *inset* shadow (`box-shadow: inset 3px 0 0 …`) is the approved way to mark a row's state or identity on its left edge (selected row, reviewed sentence, group row, chip).

### 4.2 Semantic colours `[impl]`

| Colour | Means | Used for | Never for |
|---|---|---|---|
| `--accent` (+ `--accent-bg`, `--accent-ink`) | **Current / selected / primary / interactive-active** | selected token or mention, active toggle (`.tg.on`, `.btn.on`, `.seg [aria-pressed]`), primary button, focus ring, links, manual-edit marker (dot), review progress bar, hot arcs, pinned chips | identity of an entity (that is the hue) |
| `--accent-bg` | Soft selected/active background | selected row, banners, toggles on, flash highlight, revbox | text colour |
| `--warn` | **Needs attention but not an error** | value outside the tagset (wavy underline), pending spaCy suggestion (dot/underline), `Suggestions` button, "same speaker" notice, missing book data, flag glyph when set | errors |
| `--danger` | **Error or "missing"** | save failure, errors, destructive link, a quote with no speaker (red chip/bar), negative evidence | warnings |
| ok-green (`hsl(145 45% 40%)` family) | **Done / confirmed / reviewed** | reviewed sentence edge, review chip `on`, ✓ in lists, progress fills, `.okbtn`, positive evidence text | selection |
| group hue (§4.3) | **Which entity** | see §4.3 | state |

- **DL-COLOR-03 —** Colour MUST NOT be the only carrier of a state. Pair it with shape or text: dashed outline = suggestion, wavy underline = invalid, dot = hand-edited, ✓ / "Reviewed" label = done, red chip says "No speaker".
- **DL-COLOR-04 —** One accent only. Do not introduce a second brand colour; additional emphasis uses `--ink`, weight, or an outline.
- **DL-COLOR-05 —** Text on a solid group-hue fill (`.spchip`, `.chip.q`, `.sbar.bq`) is `#fff`; on a translucent fill it is `--ink`.

### 4.3 Group hue (entity colour) `[luna]` `[impl]`

`hue(id) = round(((id × 137.508) mod 360 + 360) mod 360)` — the golden angle, so consecutive ids are well separated and the colour of an id never changes between sessions, books exports or views (`app.js: hue`). It is passed to CSS as `style="--h:<n>"` on the element; component CSS builds every variant from `--h` and four theme-dependent numbers:

| Recipe | CSS | Used for |
|---|---|---|
| Tint (fill) | `hsl(var(--h) 80% 55% / var(--ta))` | mark background, annotation bar fill, context highlight |
| Edge / outline | `hsl(var(--h) var(--cs) var(--cl))` | 1 px border of a bar, 3 px left inset of a chip, swatch fill, underline, dashed suggestion outline |
| Solid | `hsl(var(--h) var(--cs) var(--chipl))` | speaker chip, quote bar — always with white text |
| Strong tint | `… / calc(var(--ta) * 2)` | the *current* mention in a reading view |

- **DL-HUE-01 —** Colour for "no group" is `--danger` for quotes (a missing speaker is an error state), `--muted`/neutral for everything else. `hue(0)` is *not* a neutral.
- **DL-HUE-02 —** A thing that is *only a suggestion* uses the same hue with `background:none` + `outline: 1.5px dashed` (`.spchip.sugg`, `.spk.sug`). Never a different colour.
- **DL-HUE-03 —** Types that are not entities (flag kinds, supersense categories) use a fixed hue chosen per kind (`FL_KINDS`, noun/verb colours in the annotation view) through the same `--h` mechanism so they get both themes free. Keep these hues distinct from each other; they may collide with entity hues (accepted).
- **DL-HUE-04 —** The swatch (`.sw`, 12 px square, radius 3; `.sw.big` 18 px, radius 4) is the standard way to show "this is group N" in text, lists and banners.

## 5. Typography `[impl]`

Three families, three jobs:

| Family | Token | Job |
|---|---|---|
| UI sans | `--ui` | chrome, labels, buttons, chips, tables of facts |
| Reading serif | `--read` | **anything that is the book's own text or a name from it**: sentences, words, entity names, headings of a detail page, quote context, titles of books |
| Mono | `--mono` | **identifiers and machine values**: lemma/POS/dep fields, token ids (`t340`), group ids (`#12`), file paths, `<kbd>`, arc labels |

- **DL-TYPE-01 —** Base is 13 px / 1.45 in `--ui`. Do not set a different `font-size` on `body` or a page.
- **DL-TYPE-02 — Scale** (px; use these, not new values): `10–10.5` micro labels on bars and rows · `11` section labels (UPPERCASE), kbd, ids, badges · `12–12.5` secondary text, hints, table cells in dense lists · `13` body · `14` reading text in tables/cards/context, brand title · `15–16` card headings, large reading text · `17` the annotation view's word (`.wd`, line-height 24) · `18–20` stat numbers, panel `h2` · `22–26` page titles and the editable entity name. Reading views scale their own font with the context-size setting (min 9 px).
- **DL-TYPE-03 — Section label:** `font:600 11px var(--ui); text-transform:uppercase; letter-spacing:.04em; color:var(--muted)` (`.panel h3`, `.cd h3`, `.lsec h2`, `.menulbl`, `.sql`). This is the *only* use of uppercase besides table headers.
- **DL-TYPE-04 —** Numbers that change or align use `font-variant-numeric: tabular-nums` (`.num`, counts, progress, `.sn`).
- **DL-TYPE-05 —** Weight: 400 body, 500 buttons and nav, 600 emphasis/labels/names, 700 only for counts, sentence numbers and tiny badges. No 300, no 800+.
- **DL-TYPE-06 —** Italic is for the book id in the header (`.bookid`), notes the user wrote, and narration in the attribution margin; never for emphasis in UI copy.
- **DL-TYPE-07 —** Use typographic characters in UI text: `…` (not `...`) on controls that open a dialog or need more input, `“ ”` around quoted text, `’` apostrophes, `‹ ›` for previous/next, `·` as a separator in metadata, `→ ←` for key hints. Avoid emoji (flag, check and arrow glyphs are text characters or inline SVG).

## 6. Space, shape, depth

- **DL-SPACE-01 — Spacing** is eyeballed to a 2 px grid; common steps: `4, 6, 8, 10, 12, 14, 16, 18, 22`. Gaps inside a control row are `6–8`; between rows of a form `6–10`; card padding `10–14`; page padding `14` (bars, reading views) or `22` (library/detail pages). Prefer `gap` over margins.
- **DL-SPACE-02 — Radius:** `3–4` marks, kbd, annotation bars · `6` buttons, inputs, popover-level small controls · `7–9` lists, bulk bars, small cards, segmented control · `10–12` cards, menus, popovers, modals · `999` pills (chips, tags, toggles). New cards SHOULD use `10`; the single focal card on a page (suggestion card, merge card) MAY use `12`.
- **DL-SPACE-03 — Elevation** exists only for things that float: popover/menu (`shadow.popover`), drawer, modal, toast. Cards in the page are flat: border + `--surface`, no shadow. `.bookcard.current` uses `border-color:accent` + a 1 px accent ring instead of a shadow.
- **DL-SPACE-04 — z-index** by role, not by number: content < arcs (2) < overlay (3) < sticky bars (6) < drawer (30) < popover/menu (40) < toast (50) < modal (60). New floating elements pick a role from this list.
- **DL-SPACE-05 — Scrolling:** the document never scrolls in the editor (`html, body {overflow:hidden}`); regions scroll (`main`, `.panel`, lists, `.lib`), and sticky bars sit at the top of their region. A region that scrolls MUST have `min-height:0` on its flex/grid parents.

## 7. Layout

### 7.1 Editor shell `[impl]`

```
┌─ header.bar ────────────────────────────────────────────────────────────┐
│ Library │ ← Back │ book id   [Table|Annotation|Entities|Quotes|Entity-Attribution]   …actions │
├─ findbar (hidden) / navbar (Table+Annotation only) / banner (pass bars) ─┤
├──────────────────────────── .body (grid) ───────────────────────────────┤
│ main (scrolls)                                  │ .side: revbox + .panel │
└─────────────────────────────────────────────────┴────────────────────────┘
```

- **DL-LAY-01 —** Header (`.bar`): brand cluster left, **view switch** (segmented control) next, actions right (`margin-left:auto`, wraps right-aligned on narrow windows). Order of actions: Flags · Find · Undo · Redo · save state · Suggestions (only when there are any) · More (⋯). Items that are occasional (Settings, History, Export, Theme) live in the More menu.
- **DL-LAY-02 — Top-level views vs sub-views.** The view switch holds *places in the book* (Table, Annotation, Entities, Quotes, Entity-Attribution). Modes of one place are tabs inside it (`.enav` pills: Quotes → All quotes · Speaker-Attribution · Speaker suggestions). The tab bar of a place MUST NOT move when its content changes. Flags is a header icon, not a view tab (it is a to-do list across places).
- **DL-LAY-03 — Side panel.** Always present on the right, default 380 px, user-resizable (drag the left edge 7 px handle, arrow keys ±20, double-click resets, min 260, max 60 vw) and collapsible to a 30 px strip (‹/› button). Width and open state persist (`bne.sideW`, `bne.sideOpen`). Below 900 px it stacks under the text (45 % height) and the handle/toggle are hidden. The panel shows the *selection's* details and actions; every view MUST set a selection so the panel is never empty without an explanation.
- **DL-LAY-04 — Review box** sits above the panel in the two text views (progress bar + "Next unreviewed"); it is the only place progress is summarised for a book.
- **DL-LAY-05 — Pages** (Library, Settings) use the same header, then a scrolling `.lib` column centred at max 1040 px with a 22 px gutter (`padding: 22px max(22px, (100% − 1040px)/2)`), `h1` in `--read` 26 px, sections as `.lsec` with an UPPERCASE label. Settings adds a 190 px table of contents that highlights the section nearest the top; only `.lib` scrolls.

### 7.2 Recurring layouts `[impl]` `[portable]`

| Pattern | Structure | Used by |
|---|---|---|
| **List + detail** | `.cv`: 280–360 px list (search, filters, rows with swatch / name / counts) + detail (`.cd`, scrolls). Stacks at 900 px (40 % / rest). A tool with its own list (Fragments, Split) puts it there instead (220–280 px, `.cv.listread`) and its detail is a reading view (`.cd.reading`, no padding, does not scroll). | Entities, Entities → Fragments, Split |
| **Reading view** (`.qf`) | Fixed-height column: slim tool strip → context above (bottom-aligned) → **core** (the item, tinted with the entity hue, large serif) → context below. A left column (150 px, right-aligned) carries the label/chip for each passage. The core sits on the vertical centre line. | Speaker-Attribution, Entity-Attribution, Speaker suggestions (below its card), Entities → Fragments (one mention at a time, ↑/↓ for the item's other mentions) |
| **Card list** | Rows as bordered `--surface` cards or 1 px-separated rows: `[checkbox] [kind/identity] [main text + sub line] [actions]`. Header checkbox selects all shown; a sticky selection bar offers bulk actions (bar text states the count, including hidden-by-filter). | Flags, All quotes, bundles |
| **Focal card + list** | One large card for the current item (state, evidence, actions) above/beside a list of alternatives. | Merge suggestions, Speaker suggestions, checks |
| **Sidebar of groups** | 232 px sticky column left of the text with search, hotkey numbers and hover-revealed row actions. | Annotation view "Groups" |
| **Pass bar** | A banner-style strip above the text: the item, the candidate chips with `<kbd>` numbers, secondary actions, Settings, Stop. Same engine and look for Pronoun pass, Quote pass, Speaker-Attribution and Entity-Attribution; Fragments has the same look and keys from its own code (OP-11). | `passui.js`, `fragui.js` |

- **DL-LAY-06 —** A new tool SHOULD be expressed as one of these patterns. If it needs a new one, add it here with its CSS home.
- **DL-LAY-07 — Responsive:** designed for a desktop window ≥ 1100 px; must remain usable (no horizontal page scroll, controls reachable) down to ~600 px. Breakpoints: 900 px (side panel stacks, list/detail stacks, two-column attribution cards stack), 820 (library sidebar becomes a horizontal strip), 760 (two-up cards and flag rows collapse), 700 (collection rows stack). Anything that can be wider than the window scrolls inside its own region (`.tablewrap`, `.av.nowrap`).

## 8. Components `[impl]`

Class names are the stable handles; CSS is in `app.css` unless noted.

### 8.1 Buttons and links

| Component | Class | Notes |
|---|---|---|
| Button | `.btn` | 1 px `--line`, `--surface`, radius 6, pad `5px 11px`, weight 500; hover darkens the border to `--muted`; disabled 40 % opacity. In the header, pad is `4px 9px`. |
| Primary | `.btn.primary` | Filled accent. **At most one per view region** (Find, Export, "Next unreviewed", the focal card's accept). |
| Warn | `.btn.warn` | Warn-coloured text + border; for "there is something pending" (Suggestions). |
| Danger | `.btn.danger`, `.link.danger` | Danger text only; never a filled red button. |
| Small | `.btn.sm` | pad `2px 8px`; for rows, bars and toolbars inside content. |
| Active toggle | `.btn.on` | `--accent-bg` + accent border. |
| Icon button | `.btn.ico` | 16 px stroked SVG (`stroke:currentColor; width 2; round caps`), always with `title` and `aria-label`; the ⋯ icon is the one filled glyph. A count appears as a hover chip (`.cnt`) under the button, not as inline layout. |
| Text link | `.link` | Accent, weight 500, no underline; used for row-level actions ("Show in text", "Open", "✕"). |
| OK / confirm | `.okbtn` | Green fill; only for "this is right" actions that record confirmation. |

- **DL-BTN-01 —** Label with the **verb**, sentence case: `Assign`, `Assign + Quote-Rule`, `Keep`, `Skip`, `Merge into Other`, `Next unreviewed`. Controls that open a picker or dialog end in `…` (`Other…`, `Settings…`, `Change…`).
- **DL-BTN-02 —** The first-listed action of a multi-action control is the default for quick-pick (click on a chip, Enter). Order actions by "what the user most often means" (decision of 2026-09-28: `Assign + Quote-Rule` before `Assign`).
- **DL-BTN-03 —** Every icon-only control has a `title` that names the action and shows its shortcut: `Undo (⌘Z)`.

### 8.2 Inputs

Text/number/select/textarea: `--surface`, 1 px `--line`, radius 6, pad `4px 8px`, inherit font. Monospace (`--mono` 12 px) for machine values (`.fields input`), `--read` for names (`.nameinput`: borderless until hover/focus, so a heading can be renamed in place).

- **DL-INP-01 —** Edit in place when the value is part of what you are looking at (table cells, token fields, entity names, group fields as chips); open a popover for a *choice among many* (group picker); open a modal only for multi-field setup (settings, folder browser). Validate on commit (blur/Enter), save immediately, and flag — don't block — out-of-list values (wavy `--warn` underline + toast "Saved and flagged").
- **DL-INP-02 —** Form rows use `.fields`: a 96 px muted label column and a flexible control column, gap `6px 10px`. A hand-edited value shows a small `EDITED` accent tag; a derived value is read-only mono text.

### 8.3 Segmented control, tabs, toggles

- `.seg` (radius 7, one border, active segment = filled accent with `--accent-ink`) for **mutually exclusive, always-visible choices of equal weight**: view switch, Auto/Light/Dark, Table/Annotation.
- `.enav` pills (transparent until hover; active = `--surface` + border) for **sub-views inside a place** and **filters with counts** (`.badge`).
- `.tg` pill toggle (radius 999, active = accent-bg + accent border) for **independent on/off layers** (annotation layers, Pronoun pass, Groups, Filter by entity).
- Checkboxes use the native control with `accent-color: var(--accent)`; labels are clickable.
- **DL-TAB-01 —** Use `aria-pressed` on every segmented/tab/toggle button (not a bare class) so state is exposed to assistive tech and to tests.

### 8.4 Chips and marks

| Component | Class | Look | Meaning |
|---|---|---|---|
| Entity chip | `.chip` | tinted bg + 3 px left edge in hue, 11 px/600, radius 4 | a mention in the table cell/annotation; text `TYPE prop Name` |
| Continuation chip | `.cont` | 3 px left edge only | the same mention continuing across lines |
| Quote chip | `.chip.q` | solid hue, white text, leading `“` | a quote and its speaker; `.none` = danger red, "No speaker" |
| Speaker/group chip | `.spchip` | pill, solid hue, white, 12 px/600 | a group *as a value of a field* (side panel Group/Speaker, Quotes list, attribution margin) |
| Suggested chip | `.spchip.sugg` | no fill, hue text, dashed 1.5 px hue outline | a proposal, not a fact |
| Candidate chip | `.cchip` | pill, `--surface`, 1 px line, swatch + name + count; `.pinned` = accent; `.nofit` = dashed, 70 % | a group to choose; with `<kbd>` number when bound to a key |
| Count badge | `.badge` | accent-bg pill, accent text, 11/700 | counts on tabs |
| Review chip | `.rv` | muted pill → green solid when `.on` | sentence reviewed |
| Kind chip | `.fkind` | hue-tinted, 3 px left edge | the type of a flagged thing |
| Tag chip | `.tagchip` | pill, `--sunk`, clickable | user tags on a book |
| Context mark | `.em`, `.mctx b`, `.qctx .spk` | hue tint + 2 px hue underline, radius 2 | a mention inside prose; `.cur` = strong tint + 2 px ring + bold |

- **DL-CHIP-01 —** Shape tells the *role*, fill tells the *state*: a pill is a selectable value, a rectangle with a left edge is an annotation on text, a swatch is a legend. Solid = confirmed value, tinted = annotation, dashed = suggestion.
- **DL-CHIP-02 —** A group chip is always a button that opens the group picker (`groupFieldChip`), including in the side panel; do not render a group field as a text input.

### 8.5 Annotation view `[luna]`

Each sentence is a block (`.sb`): a 64 px gutter (number, paragraph mark ¶, review chip, hover-revealed action buttons ⤓ ¶ ↻) and the tokens. Words are `--read` 17 px; spans are absolutely positioned bars (15 px high) stacked in lanes above the words; rows of token properties (lemma, POS…) are mono 10.5 px under each word and editable in place.

- Entity bar: tint + 1 px hue border + label. Quote bar: solid hue + white text. Supersense bar: dashed border, lighter tint. Clipped continuation: flat edge with 2 px dotted `--muted`. Selected: 2 px accent outline, offset 1. Multi-selected: 2 px `--ink` outline + 4 px accent-bg halo (chips get a ✓ badge).
- Arcs (SVG) carry relations: dependency arcs muted (accent when hand-edited, 2 px when hovered); quote→speaker arcs are dashed in the speaker's hue. Labels are mono 10 px with a 3 px `--surface` halo (`paint-order: stroke`) so they stay legible over lines.
- Selected token: `--accent-bg` + 2 px accent underline; hand-edited value: dotted accent underline (tokens) or a 5 px accent dot (cells); pending suggestion: 2 px `--warn` underline; flash after a jump: accent fill fading over 1.4 s.
- A reviewed sentence has a 3 px green inset edge on the left.

### 8.6 Table view

Sticky UPPERCASE header on `--bg`; one row per token on `--surface`; sentence rows (`.srow`) on `--bg` with the sentence in `--read` 14 px, number bold tabular, paragraph marker accent. Current cell: 2 px inset accent. Editable cells: mono 12 px, `cursor:cell`. Keyboard: arrows move, Enter/double-click edits, Tab/Shift-Tab commit and move, Esc cancels.

### 8.7 Lists and rows

- Row: padding `6px 10px`, `--line2` separator, hover `--sunk`, selected `--accent-bg` + 3 px accent inset on the left. Row actions that are secondary appear on hover/focus-within only (`.gra`, `.gacts`, `.sact`) — never the only way to do something.
- Identity first: swatch/kind → name (ellipsised, never wrapped) → small counts in mono → state marks (`✓` green, `also` accent).
- "Load more"/overflow rows use `.more` (muted 12 px) and say how many remain.

### 8.8 Floating UI

| Component | Class | Use | Dismiss |
|---|---|---|---|
| Popover | `.pop` | pickers and small forms anchored to the clicked element (group picker, flag note, selection actions); radius 10, popover shadow, min 220 px | outside click, Esc, completing the action |
| Menu | `.menu` | the ⋯ menu; vertical stack of `.btn` rows, label section `.menulbl` | outside click, Esc |
| Drawer | `.drawer` | long lists that belong to the book but not to a place: History, Suggestions (≤ 560 px, right edge) | close button, Esc |
| Modal | `.modal > .mbox` | multi-field setup and file browsing (Library/Settings pages): header / body / footer, footer buttons right-aligned, primary rightmost; radius 12, scrim `rgb(0 0 0/.35)` | Esc, click on scrim |
| Toast | `.toast` | the *only* feedback for a completed action; centred bottom, `--ink` on `--bg`; 3.2 s, 8 s when it carries an action (**Undo**) | timeout |
| Banner | `#banner`, `.banner` | persistent state of a mode (pass bars, stale-book warning); `--accent-bg` with accent bottom border | explicit Stop/Close |

- **DL-FLOAT-01 —** A popover opened from a control MUST be positioned from that control's rect, stay inside the viewport, and take focus to its first field. Selecting an option commits and closes (a chip click uses the first action).
- **DL-FLOAT-02 —** Feedback after an action is a toast naming what happened and its size ("Assigned · moved 3 pronouns"). Never `alert()`. `confirm()` is allowed only for big irreversible-looking operations (DL-INT-05).

### 8.9 Progress, empty and error states

- Progress: 6 px track (`--line`/`--line2`), fill accent (review) or green (completion), radius 3, `transition: width .25s`.
- Empty state: a dashed `--muted` border box (`.empty`) or muted text in the list (`.fempty`) that says *what is missing and what to do next*. Never leave a panel blank.
- Errors: `.err`/toast in `--danger`; the save badge turns red and bold with a tooltip explaining what to check; a book that was closed elsewhere shows the stale-book banner with Reload / Library buttons instead of editing the wrong book.

### 8.10 Side panel content

Order inside `.panel` (top → bottom): `h2` (the thing's name, `--read` 20 px) → `.sub` (muted summary) → flag toggle → `.fields` → context box (`.ctx`, `--sunk`, `--read` 14 px, click = go there) → section `h3` blocks (UPPERCASE) for tools: Boundaries (nudge ±), Group/Speaker, Rules, Delete. The destructive action is last and uses `.link.danger`/`.btn.danger`.

## 9. Interaction `[impl]`

### 9.1 Selection model

Click selects one (token or span); drag across words selects a range; Shift-click extends; **⌘-click toggles membership in a multi-selection** that survives paging; Option-drag from a word to another sets a head. The selection always shows in the side panel and outlines in accent (multi: ink). `Esc` closes the topmost thing, in this order: pick mode → drawer → popover → clears the selection (`app.js` global handler); the More menu closes first when open.

### 9.2 Keyboard

- **DL-KEY-01 —** Global shortcuts do nothing while an `input`, `select` or `textarea` has focus (except Esc and Enter where documented).
- **DL-KEY-02 — Fixed keys:** `⌘Z` / `⇧⌘Z` undo/redo · `⌘[` back · `/` find · `v` toggle Table/Annotation · `[` `]` previous/next page · `Esc` stop/close.
- **DL-KEY-03 — Choice keys.** In passes and attribution views: `Enter` keep · `1`–`9`/`0` choose the nth candidate · `G` other (picker) · `→`/`←` next/previous · `Esc` stop. Check cards (Entities → Checks) add `A`/`U`/`M`/`N`/`O`/`K`/`S`/`P`; Speaker suggestions add `K` keep BookNLP's. Where an item has several parts (a fragment's mentions), `↑`/`↓` step through them and **Shift** with a choice key, a click or `G`/`D` acts on the part shown only. Split adds `N` new group (a lane), `C` mark the group as checked and `Tab` the next scope (only while no control has the keyboard focus). A key is always shown as `<kbd>` on the control it triggers.
- **DL-KEY-04 — Number keys have two owners and never collide:** pinned **entity** keys (1–9, per user) work when no pass is running; a running pass takes the number keys for its own choices, and the Quote tool keeps its own pinned speaker keys (≤ 5 per book) followed by suggestions. When a new tool claims number keys, state in the bar which ones and why, and release them on exit.
- **DL-KEY-05 —** Every list item or button reachable by mouse MUST be reachable by Tab; custom list rows get `tabindex`, `role` where needed, and Enter/Space activation. Visible focus is a 2 px accent outline with 1 px offset (`:focus-visible`).

### 9.3 Edit, undo, confirm

- **DL-INT-01 —** One user intent = one history step, however many rows it changes (bulk move, merge, bulk flag delete). The toast says how many.
- **DL-INT-02 —** Writes happen immediately; there are no "Apply" steps except where a dialog gathers several settings.
- **DL-INT-03 —** Hand edits are *marked* (accent dot/underline/`EDITED`) and protected: automatic re-tagging and suggestions never overwrite them.
- **DL-INT-04 —** Automatic proposals (spaCy, speaker/merge suggestions, collection matches) are listed for review and applied only on user action; nothing is applied silently.
- **DL-INT-05 — Confirmation policy:** no confirmation for anything undoable. `confirm()` only for operations affecting more than 25 items or deleting (`"…? You can undo this in one step."` — the sentence is mandatory). Deleting flags needs none.
- **DL-INT-06 —** Navigation that leaves context keeps a way back: `← Back` in the header, `Show in text` on list rows, a pass that is paused keeps its place when you switch views and its bar returns on re-entry.
- **DL-INT-07 — Auto vs manual advance.** Any tool that walks a queue offers "How to advance": Auto (after keep/choose, go to the next) or Manual (stay; `Next` moves on). Default is Auto; the choice is stored with the book/tool.
- **DL-INT-08 — A queue fetches the item it shows.** A list worked through one item at a time (merge and speaker suggestions, checks, fragments) asks the server for that item (`offset`), never for a capped list: a long book has thousands, and each must be reachable through Skip and the counter's Go.
- **DL-INT-09 — Costly extras wait for a still page.** Something that takes the server a moment and isn't what the user acts on (a count on a tab, a "possibly the same as" list in a side panel) is fetched once the page has been still briefly (`whenIdle`), keeping the last value up meanwhile; the next step of a walk must never wait behind it.

### 9.4 Motion `[impl]`

Short, functional, and removable: hover/opacity `.12–.25 s`, progress `.25 s`, toast fade `.2 s`, a one-off 1.4 s fade to show where a jump landed (`flash`). Under `prefers-reduced-motion` all of these are disabled. No decorative animation, no easing curves beyond `ease-out`.

## 10. Content and copy

- **DL-COPY-01 — Language:** British English in code comments and docs (colour, behaviour), and in UI text where it appears (the UI currently says "colour"). Sentence case everywhere; no trailing full stop on buttons, tooltips or single-sentence hints; full stops in multi-sentence notes.
- **DL-COPY-02 — Voice:** direct, second person, present tense, no exclamation marks, no apology. Say what will happen *and* what will not: "Saved and flagged", "Exports already written stay where they are; only new ones go to a folder you change to."
- **DL-COPY-03 — Names:** use the product's nouns consistently — *entity* (not character, outside the legacy collection "Characters" list), *group* when talking about the coreference cluster as a container, *mention*, *quote*, *speaker*, *book*, *working copy*, *export*, *flag*, *suggestion*, *pass*. Views: Table, Annotation, Entities, Quotes, Entity-Attribution; inside Quotes: All quotes, Speaker-Attribution, Speaker suggestions.
- **DL-COPY-04 — Tooltips** (`title`) say what the control does and, where it has one, its key: `Previous page ( [ )`. A disabled control's tooltip says why.
- **DL-COPY-05 — Counts and units:** thousands with `toLocaleString()`, singular/plural handled (`1 pronoun`, `2 pronouns`), progress as `3 of 14`, relative times as `just now`, `5 s ago`, `3 min ago`, `2 h ago`, then a short date.
- **DL-COPY-06 — Placeholders** show an example of the format (`Go to s12, t340`), not an instruction.
- **DL-COPY-07 — Error messages** come from the server's message verbatim, in a toast; the server's messages are written for the user (what is wrong and what to do), so UI code does not rephrase them.

## 11. Decision log

Dated, with the reason. Add new decisions here; never rewrite an old one (supersede it with a new line).

| ID | Date | Decision | Why |
|---|---|---|---|
| DR-01 | 2026-09-27 | Settings are one global page (`/settings`), linked from Library and the editor menu; per-book settings stay with the book. | "Not per-book"; the exports folder had to become a real setting. |
| DR-02 | 2026-09-27 | A group/speaker field is a coloured `.spchip` button that opens the group picker, in the side panel and the Quotes list alike. | Same look as the Quotes tab chip; one idiom for "who/which group". |
| DR-03 | 2026-09-27 | Merge UI is a side-by-side Compare pane inside Entities; selection by clicking list then card "Change…". | Reuse of the profile and group-field look; avoids a modal. |
| DR-04 | 2026-09-27 | Flags are local, undoable, never exported; flag toggle appears wherever the thing is shown (side panel, group page, sentence gutter). | A to-do aid, not data. |
| DR-05 | 2026-09-28 | Quick-pick (chip click, Enter) = `Assign + Quote-Rule`; plain `Assign` is the second button. | It is what the user means nearly every time. |
| DR-06 | 2026-09-28 | Pass bars are page-state: hidden outside Table/Annotation, resumed on return, re-sync after outside edits. | A stale bar showed wrong data. |
| DR-07 | 2026-09-28 | Settings page gets a sticky table of contents; only the content column scrolls. | Four long sections. |
| DR-08 | 2026-09-28 | "How to advance" Auto/Manual on every walking tool; Manual reuses the Skip control, relabelled **Next**. | Same action, clearer name; no new control. |
| DR-09 | 2026-10-09 | Speaker-Attribution/Entity-Attribution: the item is a large tinted core on the centre line, context above and below in tokens (default 120, saved), per-passage speaker in a left margin. | Judge a quote/mention in context without leaving the keyboard. |
| DR-10 | 2026-10-09 | Choice keys: user-pinned first, then suggestions fill the remaining keys in order; a candidate is never offered twice. | Predictable muscle memory; suggestions never displace the user's own keys. |
| DR-11 | 2026-10-09 | Speaker-Attribution is a tab inside Quotes; the Quotes tab stays highlighted; tab bar fixed in place. | Fewer top-level views; tabs must not jump. |
| DR-12 | 2026-10-09 | Flags is an icon (header, next to Find) with a hover count; the list has filters, kind chips with counts, Gmail-style select-all and one-step bulk delete with no confirm. | Flags are cross-cutting; deletion is undoable. |
| DR-13 | 2026-10-09 | Header counts (Flags, History, Suggestions) are a hover chip beneath the button. | No layout shift in a dense header. |
| DR-14 | 2026-10-09 | Rarely used header actions (Settings, History, Export, Theme) live in a ⋯ menu; Find, Undo, Redo, Flags are icons. | Keep the header to what is used constantly. |
| DR-15 | 2026-10-09 | Theme is Auto/Light/Dark, `auto` follows the OS, applied before first paint. | No flash; respects OS. |
| DR-16 | 2026-10-09 | Fragments: while open, the fragment queue takes the groups list's place on the left (each row with its best target and score); the current fragment fills the detail. | See the queue and the item at once without a third column. |
| DR-17 | 2026-10-10 | Fragments' detail is a reading view with the attribution views' bar (supersedes a card layout with all mentions in context of 2026-10-09): one mention at a time (`↑`/`↓`), the fragment's chip in the margin beside the core only, `Enter` = Keep (mark as checked) and go on, number keys and clicks assign the whole fragment, **Shift** only the mention shown; `Esc` drops the offer, else closes. Filters and Auto/Manual (after a split) are in the bar's Settings. | "Look and work just like Speaker-Attribution"; Shift keeps whole-fragment assigning one key away from splitting. |
| DR-18 | 2026-10-09 | After a whole fragment is assigned, its same-name fragments (case and a leading article ignored, pronouns never) are offered for the same group under the bar, each with sentence and distance (books have no chapters), all ticked; `Y` applies in one history step. | Names repeat across fragments; one decision should settle them all, but far ones may be someone else. |
| DR-19 | 2026-10-10 | Splitting a group is its own Entities tab, **Split** (not Entity-Attribution with a filter): suspicious groups with reasons on the left, the Fragments-style reading view in the middle. A new group made there (`N`, or a new name in Other…) or one picked in Other… becomes a *lane* on the first number keys; a scope switch in the bar (`Tab`: this mention · same text · same pronoun set · this paragraph) decides what a keep or move takes along and falls back to "This mention" after each; kept mentions are skipped (setting, with the book) and never taken along. | The usual case is two people in one group: one decision should move all of one name or pronoun set, and the second person's group should stay one key away. |

## 12. Known deviations and open points `[open]`

Recorded so nobody has to rediscover them. Fixing any of them is welcome; update this table when you do.

| ID | Where | Issue | Suggested resolution |
|---|---|---|---|
| OP-01 | `app.css` | Green is written as literals (`hsl(145 45% 40/42/32/62%)`) in 10 rules across `app.css` (9) and `library.css` (1), not as tokens. | Add `--ok`, `--ok-text` variables with dark values; replace literals. |
| OP-02 | `app.css` | The dark palette is duplicated (media query + `[data-theme]`); same for `.pos` and `.fkind`. | Accept (CSS limitation) or generate from §3.1. |
| OP-03 | `app.css`, `library.css` | Duplicate rules/selectors: `kbd` (twice), `.facts`, `.rpager`, `.gp`, `.err`, `.drawer` width; `.flist` means the flags list in `app.css` and the folder browser list in `library.css` (never on the same page, but one name for two things); `.chain` is both a list and a span modifier; `.cl` is a class and the `--cl` variable's abbreviation. | Rename on next touch; remove the earlier duplicate. |
| OP-04 | `app.css` | Card radius ranges 7–12 and several shadows/paddings are one-offs. | Normalise to DL-SPACE-02 when a component is next edited. |
| OP-05 | `app.css` | Font sizes beyond DL-TYPE-02 (`10.5`, `11.5`, `12.5`) are used as half steps. | Allowed; do not add more. |
| OP-06 | Accessibility | Contrast of white on group-hue solids (`.spchip`, `.sbar.bq`) is acceptable at 34–40 % lightness but not computed per hue (yellow/green hues are lightest). | Compute and, if needed, lower `--chipl` for hues 50–170. |
| OP-07 | Accessibility | Many list rows and chips are `div`/`button` without roles/labels; the annotation canvas (absolute bars and SVG arcs) is mouse-first. | Add roles/labels to lists; provide the side-panel route as the accessible path (already the case for every annotation action). |
| OP-08 | Responsive | Only verified down to the 900 px stack; Speaker-suggestions and attribution views not tried on narrow screens. Fragments below 900 px: list, middle and side panel stack, the bar takes about 180 px and the reading area is left with little height (the list gets 22 %). | Test at 600–900 px; consider a collapsible bar or hiding the queue below 900 px. |
| OP-09 | Reading views | Context font floors at 9 px; very large token settings clip the far end. | Cap the setting or allow scrolling. |
| OP-10 | Keys | No shortcut for opening Flags; Flags has no shift-click range select. | Add `F`? Decide with the user. |
| OP-11 | `fragui.js` | The Fragments bar copies the pass bar's markup and keys instead of using `makePass`, which assumes a pass owns a whole view (`S.view`), not a tab inside Entities, and walks by token position, not a list offset. | Teach the engine a `pane` host and an offset walk, then make Fragments a spec. |
| OP-12 | `fragui.js` | Fragments' Auto/Manual and context size are kept in the browser (`bne.frAdvance`, `bne.frTokens`); the size/type filters are not kept at all. Other walking tools keep their advance with the book (DL-INT-07). | Move advance (and the filters) to `meta` with the next server change to Fragments. |

## 13. Checklist for designing or redesigning a feature

1. **Which pattern?** Pick from §7.2; reuse its CSS and JS engine (e.g. add a spec to `passui.js` instead of a new bar).
2. **Where does it live?** Top-level view only if it is a *place in the book* (DL-LAY-02); otherwise a tab, a pass, a drawer or a Settings section.
3. **What is selected?** Make the side panel show it (DL-LAY-03).
4. **Colour:** identity → group hue; state → accent/warn/danger/ok with a non-colour cue (DL-COLOR-03); suggestions dashed (DL-HUE-02). No new colours without light and dark values (DL-TOK-02).
5. **Type:** book text in `--read`, ids/values in `--mono`, chrome in `--ui`, sizes from DL-TYPE-02.
6. **Keys:** shown on controls, not colliding (DL-KEY-04); Tab-reachable.
7. **Undo and feedback:** one history step; a toast with counts; a confirm only past 25 items.
8. **Copy:** verbs, sentence case, `…` for dialogs, product nouns (§10).
9. **Persistence:** book setting → `meta.*`; all-books setting → Settings page; personal view preference → `bne.*` localStorage with try/catch.
10. **States:** empty, loading ("Loading…"), error, long names (ellipsis), thousands of rows (paging or "load more"), both themes, 900 px.
11. **Code:** `esc()` all text, comment above every function, CSS under a named banner, tokens only; add a tests/ route smoke test for new endpoints.
12. **Docs:** a line in `docs/guide.md` (what the user can do), `docs/DOCUMENTATION.md` (how it is built), and a row in §11 here if you made a design decision.

## 14. Transferring to a companion project

What to take, in order. Items tagged `[portable]` above need no change; `[luna]` items are the book-domain parts.

1. **Copy the token block (§3.1) and the base rules.** Either copy `:root`, the two dark blocks, the reset (`*{box-sizing}`, `html,body{height:100%;overflow:hidden}`, `body{font:13px/1.45 var(--ui)}`, `:focus-visible`, `[hidden]{display:none!important}`) and `theme.js` verbatim, or generate your own variables from the JSON (it is plain data: `color.light|dark` → CSS variables; `font`, `radius`, `shadow`, `z` → variables or your framework's theme file; for Tailwind map `color.*` into `theme.extend.colors` and set `darkMode` to follow `[data-theme]` + media).
2. **Port components in this order:** buttons/inputs → header bar + segmented control + More menu → cards, rows, chips, badges → popover/menu/drawer/modal/toast → side panel with resize/collapse (`sidepane.js` is self-contained; it needs `$()` and the three elements `.body`, `#sideResizer`, `#sideToggle`) → pass bar → reading view.
3. **Keep identical across projects** (so users move between them without relearning): token values, the accent/warn/danger/ok meanings, the three type roles, 13 px base, header order (brand, view switch, actions right, ⋯ for rare), undo/redo + save badge, toast-with-Undo feedback, `<kbd>` hints, `Esc`/`Enter`/`←→`/`1–9` key meanings, copy rules in §10, `bne.`-style prefixed `localStorage` keys (use your own prefix, same pattern).
4. **Adapt per project:** the group-hue system applies wherever there is a stable id that needs a stable colour (characters, topics, clusters); if the companion has none, drop DL-PRIN-02 and §4.3 and do not substitute decorative colour. Annotation bars, arcs and the token table are specific to token-level editing.
5. **Record divergences.** A companion project keeps its own `docs/DESIGN.md` that begins with "Based on Luna design language, version of <date>" and lists each rule ID it deviates from and why. Rule IDs are stable; never reuse an ID for a different rule, and mark removed rules as `withdrawn` rather than deleting them.
6. **Test for drift.** Copy `tests/test_design.py` (§15) and point it at the companion's stylesheet.

## 15. Maintaining this document

- Treat this file like code: change it in the same commit as the CSS/JS it describes.
- `tests/test_design.py` fails when the §3.1 token block and `app.css` disagree (both the light `:root` and both dark copies), or when a rule ID is duplicated in this file. It does **not** check prose; re-verify §4–§9 when you change a component.
- Add a decision to §11 when you decide something; add a deviation to §12 when you knowingly break a rule; remove it from §12 when fixed.
- Version: the date at the top is the last full verification against the code. Companion projects pin that date.
