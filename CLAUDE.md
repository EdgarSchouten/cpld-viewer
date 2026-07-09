# CPLD Viewer — Developer Notes

## Current Functionalities

### VS Code Extension

- Open any CP/LD-compliant HTML file in VSCode and run `CPLD Viewer` from the command palette.
- Linked JSON-LD (via `<link type="application/ld+json" rel="describedby" href="...">`) is fetched and merged with any inline `<script type="application/ld+json">` blocks.
- Hovering over annotated elements (matched by fragment ID) shows the RDF triples in which the resource appears as subject or object.
- Clicking a resource in the triple panel dereferences its IRI (optionally via proxy) and expands the triple store.
- Configuration options: allow local images/styles, always-dereference IRIs, load local contexts, proxy support.

### Web Application (`server.py` + `playground/`)

Flask 3.x server with four routes:

| Route | Description |
| --- | --- |
| `GET /playground/index.html` | Interactive playground |
| `GET /playground/examples/<file>` | Serves `.html`, `.jsonld`, `.css` example files |
| `GET /view?file=` / `?url=` | Renders a local or remote CP/LD document |
| `GET /browse?uri=` | Linked-data dereferencing proxy |

#### Playground (`playground/index.html`)

Three-pane editor built on CodeMirror 5:

- **HTML tab** — Full CP/LD document source (`htmlmixed` mode).
- **JSON-LD tab** — Companion graph (`javascript/json` mode). Parse errors shown inline.
- **CSS tab** — Document stylesheet (`css` mode). Defaults to `DEFAULT_CSS` if no `<link rel="stylesheet">` is present or loadable.

On every render, `buildDocument()`:

1. Parses the full HTML to extract `<head>` children (dropping `<base>`, `<meta charset>`, `<meta name="id">`, `<link rel="stylesheet">`, and the `cpldviewer.js` `<script>`).
2. Injects `<base href>` (pointing to `/media/js/` so `cpldviewer.js` resolves) and `<meta name="id">`.
3. Runs `scopeUserCSS()` on the CSS editor content: transforms `body`/`html`/`:root` to `#cpld-body-content` and prefixes all other selectors, so user styles are scoped to the document content area and do not bleed into the cpldviewer.js navbar/toast overlay.
4. Injects the scoped `<style>` block **after** the `cpldviewer.js` `<script>` tag, so it wins the CSS cascade over Bootstrap 4 (which cpldviewer.js injects at script-execution time via style-loader).
5. Injects the JSON-LD as an inline `<script type="application/ld+json">`.

The result is written to `iframe.srcdoc`.

#### Preview panel

- **Preview tab** — srcdoc iframe running `cpldviewer.js` (Bootstrap 4, jQuery, jsonld.js, rdflib.js). Fragment-ID decorated elements get ◊ markers and triple toasts on click.
- **Graph tab** — Cytoscape.js (COSE layout) showing RDF entities as nodes and object properties as directed edges. Clicking a node opens a floating info panel with its datatype properties.

#### Loading documents

- **Load Example** dialog — three built-in examples (scholarly article, news article, text-annotation). Each has paired `.html`, `.jsonld`, `.css` files in `playground/examples/`. On load, `extractStylesheets()` fetches the linked CSS (resolving relative hrefs against the server path, not the semantic `<base href>`) and populates the CSS editor.
- **File upload** — drag a local `.html` or `.jsonld` file. The HTML file's linked JSON-LD and stylesheet are extracted into their respective editors.
- **Copy HTML** — copies the full assembled document to the clipboard.

#### Open Annotation support (`src/cpldviewer.js`)

- `oa:XPathSelector` — resolves an XPath expression to a DOM element.
- `oa:TextPositionSelector` — highlights a character-offset range within an element, stripping leading whitespace before counting.
- `oa:refinedBy` — when present, only the refinement selector's range is highlighted (not the outer selector).

### Built-in examples (`playground/examples/`)

| Example | Font style |
| --- | --- |
| `scholarly-article` | Georgia / serif |
| `news-article` | Helvetica Neue / sans-serif |
| `text-annotations` | Trebuchet MS / humanist sans |

---

## Known Issues

- **`extractStylesheets` and `<base href>`** — CP/LD documents set `<base href>` to the semantic document IRI. When DOMParser parses such an HTML file, `link.href` (IDL attribute) is resolved against the semantic IRI, not the server path. The current fix uses `link.getAttribute('href')` (raw string) and resolves it against the server's `fetchBaseUrl`; a fallback detects foreign-origin URLs and re-resolves using only the filename. Edge cases with deeply nested relative paths are not handled.

- **`scopeUserCSS` is not a full CSS parser** — The selector transformer handles simple element/class/ID selectors and `@media`/`@supports`/`@layer` nesting correctly, but does not handle: quoted strings containing `{` or `}`, CSS comments with braces, `@charset`, or complex pseudo-selectors that reference `:root` inside a non-top-level context.

- **Graph view — blank nodes** — Blank nodes (JSON-LD objects with no `@id`) are walked recursively but not rendered as graph nodes. Properties on blank nodes are attached to the nearest ancestor with an `@id`. Very deeply nested blank node structures may lose properties silently.

- **No live reload** — The server has no watch mode; edits to example files require a manual browser refresh.

- **Bootstrap 4 / cpldviewer.js is not rebuild-aware** — Changes to `src/cpldviewer.js` require `npm run build` (webpack) to update `media/js/cpldviewer.js`. There is no incremental build.

---

## Future Development

### Bibliographic reference validation

A validation pass that checks CP/LD documents for conformant bibliographic structure. The checks, in order:

1. **References section present** — Is there exactly one document fragment typed as `nas:References`? (Required.)

2. **All children annotated** — Are all child elements of that fragment listed in the JSON-LD as a `nas:ReferenceItem`? (Required: every child element with an `id` attribute must appear as a subject typed `nas:ReferenceItem`.)

3. **Work link on every reference** — Does every `nas:ReferenceItem` include a `schema:mentions` property pointing to a node typed `schema:CreativeWork`? (Required. Without a reasoner, subclasses such as `schema:ScholarlyArticle` must be accompanied by an explicit `schema:CreativeWork` declaration in the `@type` array.)

4. **In-text citations** — Does every `nas:ReferenceItem` have a corresponding `nas:Citation` in the body text of the HTML, realised as an `<a href="#fragment-id">` linking back to the reference item's fragment? (Required.)

The validation results should be surfaced in the playground (e.g. a "Validate" button in the toolbar) and ideally also available as a standalone endpoint (`/validate?file=` or `POST /validate`) for CI integration.
