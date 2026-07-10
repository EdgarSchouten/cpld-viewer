// playground/validation.js
// ---------------------------------------------------------------------------
// Bibliographic validation module for the CPLD Playground.
//
// MAINTAINER GUIDE
// ─────────────────
// To ADD a check:
//   1. Write an async function  myCheck(data, htmlDoc, ctx)  that returns
//      a CheckResult (see shape below).
//   2. Add an entry to VALIDATION_CHECKS at the bottom of this file.
//      Declare prerequisites via `needs` and, if needed, a `skipIf` predicate.
//
// To REMOVE a check:  delete its entry from VALIDATION_CHECKS.
// To REORDER checks:  reorder entries (respecting `needs` dependencies).
// To EDIT a check:    modify its inline SPARQL query.
//
// SPARQL prefixes shared by all queries are declared in PREFIXES.
// Add new vocabulary prefixes there when a check needs terms not already declared.
//
// CheckResult shape:
//   {
//     id:      string,
//     label:   string,
//     status:  'pass'|'fail'|'skip',
//     summary: string,
//     items:   Array<{id, status: 'pass'|'fail', message}>
//   }
//   Extra properties (e.g. refsIRI, refItemIRIs) are copied into ctx so
//   downstream checks can read them.
// ---------------------------------------------------------------------------

'use strict';

// ── IRI utilities ─────────────────────────────────────────────────────────────

function fragmentId(iri) {
  if (!iri) return null;
  const idx = iri.indexOf('#');
  return idx >= 0 ? iri.slice(idx + 1) : null;
}

function buildPrefixMap(context) {
  const map = {};
  for (const ctx of [].concat(context || [])) {
    if (ctx && typeof ctx === 'object' && !Array.isArray(ctx)) {
      for (const [k, v] of Object.entries(ctx)) {
        if (!k.startsWith('@') && typeof v === 'string') map[k] = v;
      }
    }
  }
  return map;
}

function expandIRI(curie, prefixMap) {
  if (!curie) return curie;
  if (curie.startsWith('http://') || curie.startsWith('https://')) return curie;
  const colon = curie.indexOf(':');
  if (colon > 0 && prefixMap[curie.slice(0, colon)])
    return prefixMap[curie.slice(0, colon)] + curie.slice(colon + 1);
  return curie;
}

// ── N-Quads serialisation ─────────────────────────────────────────────────────
// Converts a JSON-LD document (with inline @context) to N-Quads so Comunica
// receives a fully-expanded triple stream rather than the compact JSON-LD form.

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

function escLit(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
                  .replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function jsonldToNQuads(data, prefixMap) {
  const lines = [];
  const nodes = [].concat(data['@graph'] || (data['@id'] ? [data] : []));
  for (const node of nodes) {
    if (!node || !node['@id']) continue;
    const s = `<${expandIRI(node['@id'], prefixMap)}>`;
    for (const t of [].concat(node['@type'] || []))
      lines.push(`${s} <${RDF_TYPE}> <${expandIRI(t, prefixMap)}> .`);
    for (const [key, val] of Object.entries(node)) {
      if (key.startsWith('@')) continue;
      const p = `<${expandIRI(key, prefixMap)}>`;
      for (const v of [].concat(val)) {
        if (!v && v !== 0 && v !== false) continue;
        if (typeof v === 'object' && v['@id'])
          lines.push(`${s} ${p} <${expandIRI(v['@id'], prefixMap)}> .`);
        else if (typeof v === 'object' && '@value' in v)
          lines.push(`${s} ${p} "${escLit(v['@value'])}" .`);
        else if (typeof v === 'string')
          lines.push(`${s} ${p} "${escLit(v)}" .`);
        else if (typeof v === 'number' || typeof v === 'boolean')
          lines.push(`${s} ${p} "${v}" .`);
      }
    }
  }
  return lines.join('\n');
}

// ── Comunica SPARQL engine ────────────────────────────────────────────────────
// Loaded via playground/comunica-browser.js (webpack development bundle).
// A fresh QueryEngine is created per query to prevent source accumulation.

const PREFIXES = `
  PREFIX nas:    <https://data.elsevier.com/publishing/schema/nas/>
  PREFIX schema: <https://schema.org/>
`;

async function sparqlSelect(sparql, data) {
  const prefixMap = buildPrefixMap(data['@context']);
  const nquads    = jsonldToNQuads(data, prefixMap);

  // Parse N-Quads into an N3.Store (RDF.js DatasetCore).
  // Comunica v5 accepts an RDF.js store directly as a source, which avoids
  // the broken 'serialized' + 'application/n-quads' path in the browser bundle.
  const store = new N3.Store();
  store.addQuads(new N3.Parser({ format: 'N-Quads' }).parse(nquads));

  const engine = new Comunica.QueryEngine();
  const stream = await engine.queryBindings(`${PREFIXES}\n${sparql}`, {
    sources: [store],
  });
  return stream.toArray();
}

// ── Check implementations ─────────────────────────────────────────────────────

async function checkRefsSection(data, _htmlDoc, _ctx) {
  const bindings = await sparqlSelect(
    'SELECT ?refs WHERE { ?refs a nas:References }', data);

  if (bindings.length === 0)
    return { id: 'ref-section', label: 'References section present', status: 'fail',
      summary: 'No node typed nas:References found in JSON-LD.', items: [], refsIRI: null };

  if (bindings.length > 1)
    return { id: 'ref-section', label: 'References section present', status: 'fail',
      summary: `${bindings.length} nodes typed nas:References found — expected exactly one.`,
      items: bindings.map(b => ({ id: b.get('refs').value, status: 'fail',
        message: 'Duplicate nas:References node' })),
      refsIRI: null };

  const refsIRI = bindings[0].get('refs').value;
  return { id: 'ref-section', label: 'References section present', status: 'pass',
    summary: `Found: ${refsIRI}`, items: [], refsIRI };
}

async function checkChildrenAnnotated(data, htmlDoc, ctx) {
  const { refsIRI }  = ctx;
  const refsFragId   = fragmentId(refsIRI);
  const refsEl       = refsFragId ? htmlDoc.getElementById(refsFragId) : null;

  if (!refsEl)
    return { id: 'children-annotated', label: 'Reference children annotated', status: 'fail',
      summary: `HTML element with id="${refsFragId}" not found.`, items: [], refItemIRIs: [] };

  const htmlChildIds = Array.from(refsEl.querySelectorAll('li[id]')).map(el => el.id);

  const bindings    = await sparqlSelect(
    'SELECT DISTINCT ?item WHERE { ?item a nas:ReferenceItem }', data);
  const refItemIRIs = bindings.map(b => b.get('item').value);
  const fragIdSet   = new Set(refItemIRIs.map(fragmentId).filter(Boolean));

  const items = htmlChildIds.map(cid => ({
    id: cid,
    status:  fragIdSet.has(cid) ? 'pass' : 'fail',
    message: fragIdSet.has(cid)
      ? 'Annotated as nas:ReferenceItem'
      : 'Not found as nas:ReferenceItem in JSON-LD',
  }));
  const failing = items.filter(i => i.status === 'fail');

  return { id: 'children-annotated', label: 'Reference children annotated',
    status: failing.length ? 'fail' : 'pass',
    summary: failing.length
      ? `${failing.length} of ${items.length} children lack a nas:ReferenceItem annotation`
      : `All ${items.length} children annotated as nas:ReferenceItem`,
    items: failing, refItemIRIs };
}

// Check 3: every nas:ReferenceItem must schema:mentions a node typed schema:CreativeWork.
// Without a reasoner, subclasses (e.g. schema:ScholarlyArticle) must also explicitly
// declare schema:CreativeWork in their @type array.
async function checkWorkLink(data, _htmlDoc, ctx) {
  const { refItemIRIs } = ctx;

  const bindings = await sparqlSelect(`
    SELECT DISTINCT ?item WHERE {
      ?item a nas:ReferenceItem ;
            schema:mentions ?work .
      ?work a schema:CreativeWork .
    }`, data);
  const linkedItems = new Set(bindings.map(b => b.get('item').value));

  const items = refItemIRIs.map(iri => ({
    id: iri,
    status:  linkedItems.has(iri) ? 'pass' : 'fail',
    message: linkedItems.has(iri)
      ? 'Links a schema:CreativeWork via schema:mentions'
      : 'No schema:mentions → schema:CreativeWork found',
  }));
  const failing = items.filter(i => i.status === 'fail');

  return { id: 'work-link', label: 'Reference items link a schema:CreativeWork',
    status: failing.length ? 'fail' : 'pass',
    summary: failing.length
      ? `${failing.length} of ${items.length} reference items missing a valid schema:CreativeWork link`
      : `All ${items.length} reference items link a schema:CreativeWork`,
    items: failing };
}

// Check 4: every nas:ReferenceItem needs:
//   (a) a nas:Citation in JSON-LD that schema:mentions the same work,
//   (b) an <a href="#refFrag"> outside the references section in the HTML.
async function checkInTextCitation(data, htmlDoc, ctx) {
  const { refsIRI, refItemIRIs } = ctx;
  const refsFragId = fragmentId(refsIRI);
  const refsEl     = refsFragId ? htmlDoc.getElementById(refsFragId) : null;

  const bindings = await sparqlSelect(`
    SELECT DISTINCT ?item WHERE {
      ?item a nas:ReferenceItem ;
            schema:mentions ?work .
      ?cit  a nas:Citation ;
            schema:mentions ?work .
    }`, data);
  const citedItems = new Set(bindings.map(b => b.get('item').value));

  const items = refItemIRIs.map(iri => {
    const frag       = fragmentId(iri);
    const hasJsonLD  = citedItems.has(iri);
    let   htmlLinks  = 0;
    if (frag) {
      for (const a of htmlDoc.querySelectorAll(`a[href="#${frag}"]`)) {
        if (!refsEl || !refsEl.contains(a)) htmlLinks++;
      }
    }
    const hasHtmlLink = htmlLinks > 0;

    if (hasJsonLD && hasHtmlLink)
      return { id: iri, status: 'pass',
        message: 'nas:Citation shares schema:mentions target, and <a href> present in HTML body' };
    const missing = [];
    if (!hasJsonLD)   missing.push('no nas:Citation sharing the same schema:mentions target');
    if (!hasHtmlLink) missing.push(`no <a href="#${frag}"> outside the references section`);
    return { id: iri, status: 'fail', message: missing.join('; ') };
  });
  const failing = items.filter(i => i.status === 'fail');

  return { id: 'in-text-citation', label: 'In-text citations present',
    status: failing.length ? 'fail' : 'pass',
    summary: failing.length
      ? `${failing.length} of ${items.length} reference items lack an in-text citation`
      : `All ${items.length} reference items have an in-text citation`,
    items: failing };
}

// Check 5: for each HTML link from a nas:Citation element (matched by fragment ID)
// to a nas:ReferenceItem element via <a href="#refFrag">, both must schema:mentions
// the same CreativeWork using exactly the same IRI.
async function checkCitationWorkConsistency(data, htmlDoc, ctx) {
  const { refItemIRIs } = ctx;

  // fragment ID → full ReferenceItem IRI
  const refIRIByFrag = {};
  for (const iri of refItemIRIs) {
    const frag = fragmentId(iri);
    if (frag) refIRIByFrag[frag] = iri;
  }

  // Citation fragment ID → schema:mentions work IRI
  const citBindings = await sparqlSelect(
    'SELECT ?cit ?work WHERE { ?cit a nas:Citation ; schema:mentions ?work }', data);
  const citWorkByFrag = {};
  for (const b of citBindings) {
    const frag = fragmentId(b.get('cit').value);
    if (frag) citWorkByFrag[frag] = b.get('work').value;
  }

  // ReferenceItem IRI → schema:mentions work IRI
  const refBindings = await sparqlSelect(
    'SELECT ?ref ?work WHERE { ?ref a nas:ReferenceItem ; schema:mentions ?work }', data);
  const refWorkByIRI = {};
  for (const b of refBindings)
    refWorkByIRI[b.get('ref').value] = b.get('work').value;

  // Walk each Citation's HTML element; inspect every <a href="#refFrag"> it contains
  // or is itself (when the Citation element is the <a> element directly).
  const items = [];
  for (const [citFrag, citWork] of Object.entries(citWorkByFrag)) {
    const citEl = htmlDoc.getElementById(citFrag);
    if (!citEl) continue;
    const selfLink = (citEl.tagName === 'A' && citEl.getAttribute('href')?.startsWith('#'))
      ? [citEl] : [];
    const links = [...selfLink, ...citEl.querySelectorAll('a[href^="#"]')];
    for (const link of links) {
      const refFrag = link.getAttribute('href').slice(1);
      if (!refIRIByFrag[refFrag]) continue; // href target is not a ReferenceItem
      const refWork = refWorkByIRI[refIRIByFrag[refFrag]];
      const id = `${citFrag} → #${refFrag}`;
      if (citWork === refWork) {
        items.push({ id, status: 'pass', message: `Both mention <${citWork}>` });
      } else {
        items.push({ id, status: 'fail',
          message: `Citation mentions <${citWork || '(none)'}> but reference mentions <${refWork || '(none)'}> — IRIs must be identical` });
      }
    }
  }

  if (items.length === 0)
    return { id: 'citation-work-match',
      label: 'Citation and reference mention the same work',
      status: 'skip',
      summary: 'No nas:Citation HTML elements with <a href> links to nas:ReferenceItem fragments found.',
      items: [] };

  const failing = items.filter(i => i.status === 'fail');
  return { id: 'citation-work-match',
    label: 'Citation and reference mention the same work',
    status: failing.length ? 'fail' : 'pass',
    summary: failing.length
      ? `${failing.length} of ${items.length} citation–reference pairs mention different works`
      : `All ${items.length} citation–reference pairs mention the same work IRI`,
    items: failing };
}

// ── Check registry ────────────────────────────────────────────────────────────
// Edit this array to add, remove, or reorder checks.
// `needs`  — IDs of checks that must pass before this one runs.
// `skipIf` — optional function(ctx) → bool; skips this check when true.

const VALIDATION_CHECKS = [
  { id: 'ref-section',
    label: 'References section present',
    run:   checkRefsSection,
    needs: [] },

  { id: 'children-annotated',
    label: 'Reference children annotated',
    run:   checkChildrenAnnotated,
    needs: ['ref-section'] },

  { id: 'work-link',
    label:  'Reference items link a schema:CreativeWork',
    run:    checkWorkLink,
    needs:  ['children-annotated'],
    skipIf: ctx => !ctx.refItemIRIs || ctx.refItemIRIs.length === 0 },

  { id: 'in-text-citation',
    label:  'In-text citations present',
    run:    checkInTextCitation,
    needs:  ['children-annotated'],
    skipIf: ctx => !ctx.refItemIRIs || ctx.refItemIRIs.length === 0 },

  { id: 'citation-work-match',
    label:  'Citation and reference mention the same work',
    run:    checkCitationWorkConsistency,
    needs:  ['children-annotated'],
    skipIf: ctx => !ctx.refItemIRIs || ctx.refItemIRIs.length === 0 },
];

// ── Orchestrator ──────────────────────────────────────────────────────────────

async function runChecks(checks, data, htmlDoc) {
  const results    = [];
  const resultById = {};
  const ctx        = {};
  const STANDARD   = new Set(['id', 'label', 'status', 'summary', 'items']);

  for (const check of checks) {
    const prereqFailed = (check.needs || []).some(id => {
      const r = resultById[id];
      return !r || r.status !== 'pass';
    });
    const condSkip = !prereqFailed && check.skipIf && check.skipIf(ctx);

    let result;
    if (prereqFailed || condSkip) {
      result = { id: check.id, label: check.label, status: 'skip',
        summary: 'Skipped — preceding check did not pass or produced no items.', items: [] };
    } else {
      result = await check.run(data, htmlDoc, ctx);
      for (const [k, v] of Object.entries(result)) {
        if (!STANDARD.has(k)) ctx[k] = v;
      }
    }
    results.push(result);
    resultById[check.id] = result;
  }
  return results;
}
