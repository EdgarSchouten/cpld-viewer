# Content Profile and Linked Document Viewer

The CP/LD viewer is a Visual Studio Code extension that allows you to view and browse CP/LD compliant documents inside VSCode. CP/LD is a new standard developed by the NISO CP/LD Working group, see <https://github.com/niso-standards/cpld> and <https://www.niso.org/standards-committees/cpld>. In short, a CP/LD file is an HTML file that links or embeds JSON-LD (akin to Google Structured Data).

## License
This code was originally developed by Elsevier B.V. (@RinkeHoekstra, @andyElsevier) and was contributed to the NISO CP/LD working group under an MIT license. See the `LICENSE.md` file for details.

## What it does

* You can open an HTML file in VSCode, and then run the `CPLD Viewer` command from the command pallette.
* The HTML file should contain JSON-LD data, or have links to it
  * Any linked JSON-LD data will be inserted into the HTML for further processing by the extension
  * Use `<script type="application/ld+json">...</script>` or `<link type="application/ld+json" rel="describedby" href="PATH_TO_JSONLD_FILE" />` inside the `<head>` of the file.
* When hovering over an annotated part of the document (i.e. an element with an `id` atttribute that matches one of the defined parts of the article in JSON-LD), it will:
  * Display the triples in which the resource indicated by the value of the attribute appears as *subject* or *object*.
* When clicking on one of the resources displayed in the triples, it will:
  * Try to **retrieve** a JSON-LD description of the resource from its URI, and add the retrieved statements to the store.
  * Display the triples in which this resources appears as *subject* or *object*.

## Installation

Install the package directly from the VSCode Marketplace, or download a `*.vsix` package from the releases page for this repository and run the `"Install from VSIX..."` command in VSCode.

The `CPLD Viewer` command will appear in your command pallette (`Cmd-Shift-P` or `Ctrl-Shift-P`) whenever an HTML file is opened in your editor. The CPLD viewer will appear in a new pane next to your open document.

## Configuration Options

The viewer has a number of configuration options that can be modified in the Settings pannel (`Cmd-,` or `Ctrl-,`)

### Allow Local Images
Set this to `true` if you want the viewer to allow loading local images into the HTML viewer. This is disabled by default (loading from URLs is allowed). Any local images should be in a `media` directory relative to the HTML file being viewed.

### Allow Local Styles
Set this to `true` if you want the viewer to allow loading local CSS into the HTML viewer. This is disabled by default (loading from URLs is allowed). Any local images should be in a `media` directory relative to the HTML file being viewed.

### Always Dereference IRIs
When set to `true`, every time an IRI resource is clicked in the UI, the extension will attempt to dereference the IRI and populate the internal store with the retrieved triples.

### Load Local Contexts
Standard JSON-LD libraries will only load files through dereferencing, or assume that the JSON-LD file is hosted on an HTTP server. Setting this option to `true` will make the extension attempt to load JSON-LD context files from a local path. This means that a JSON-LD file can refer to its context using an abbreviated IRI.

### Proxy Enabled
The extension will use a proxy to dereference IRIs, rather than attempt to dereference them directly. This is useful when the Linked Data is not dereferencable directly, or for security reasons.

### Proxy URL prefix
Specifies the URL prefix to use when the proxy is enabled. This value will simply be prepended to any IRI when trying to dereference.

## Web Application (Playground & Viewer)

In addition to the VSCode extension, the repository includes a standalone web application that works entirely in a browser — no VSCode required. It provides:

- An interactive **Playground** — author or paste HTML and JSON-LD side by side and see the CP/LD viewer render live.
- A **Viewer** — point it at any local or remote CP/LD document and get the full triple-overlay experience.
- A **Graph view** — visualises the RDF graph from the JSON-LD, with datatype properties shown on click.
- A **Linked-data proxy** (`/browse?uri=`) — lets the viewer dereference IRIs that would otherwise be blocked by CORS.

### Prerequisites

- Python 3.9 or later
- pip

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/elsevierlabs-os/cpld-viewer.git
cd cpld-viewer

# 2. Install Python dependencies
pip install -r requirements.txt
```

### Running locally

```bash
python server.py
```

The server starts on **http://localhost:5000** by default. If port 5000 is taken (e.g. by macOS AirPlay Receiver), pick any free port:

```bash
python server.py --port 8080
```

Then open **http://localhost:8080** in your browser.

| Route | Description |
|---|---|
| `http://localhost:8080/` | Interactive playground |
| `http://localhost:8080/view?file=path/to/doc.html` | Render a local CP/LD file |
| `http://localhost:8080/view?url=https://example.org/doc.html` | Render a remote CP/LD document |
| `http://localhost:8080/browse?uri=https://example.org/entity` | Dereference a Linked Data IRI |

### Command-line options

| Option | Default | Description |
|---|---|---|
| `--port PORT` | `5000` | Port to listen on |
| `--host HOST` | `127.0.0.1` | Bind address (`0.0.0.0` to expose on the network) |
| `--doc-root DIR` | current directory | Root directory for `?file=` requests; paths outside it are rejected |
| `--debug` | off | Enable Flask debug mode (auto-reload on code changes) |

### Example documents

Three built-in examples are included in `playground/examples/`:

| File pair | Description |
|---|---|
| `scholarly-article.html` / `.jsonld` | Academic article with authors, affiliations, and named sections |
| `news-article.html` / `.jsonld` | News report with byline, dateline, and event entities |
| `text-annotations.html` / `.jsonld` | Article with `oa:Annotation` text-range highlights using `oa:XPathSelector` and `oa:TextPositionSelector` |

Edit the `.html` and `.jsonld` files directly — they are loaded fresh on each click in the Load dialog.

### Deploying online

Use a production WSGI server and add `gunicorn>=21.0` to `requirements.txt`:

```bash
gunicorn --bind 0.0.0.0:$PORT server:app
```

Suitable platforms include **Render**, **Fly.io**, and **Railway**. See [DEPLOYING.md](DEPLOYING.md) for details (or ask the maintainers).

---

## Building from Source

* Clone this repository, and cd into the directory
* Open the directory in VSCode (e.g. `code .`)
* Run `npm install` from the commandline (either inside VSCode or in your terminal)
* Run the extension development tool by pressing F5, a new window will appear with the extension installed.
  * You may have to run `npm build` to trigger the webpack build that produces a `cpldviewer.js` file that is injected in the HTML DOM.
* Updates to the code of the extension can be seen by reloading the new window.

## Contributing

Contributions are more than welcome! Please make your changes in a new branch and create a pull request when done.

Packaging your own version:

* Update the version number in `package.json`
* Run `vsce package` from the command line (make sure you have `vsce` installed)
