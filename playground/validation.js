// playground/validation.js
// ---------------------------------------------------------------------------
// Bibliographic validation module for the CPLD Playground.
//
// MAINTAINER GUIDE
// ─────────────────
// To ADD a check:
//   1. Write a function  myCheck(data, prefixMap, htmlDoc, ctx)  that returns
//      a CheckResult (see shape below).
//   2. Add an entry to VALIDATION_CHECKS at the bottom of this file.
//      Declare which earlier checks it requires via `needs`.
//      If it should be skipped when ctx is missing certain data, add `skipIf`.
//
// To REMOVE a check:  delete its entry from VALIDATION_CHECKS.
// To REORDER checks:  reorder entries (respecting `needs` dependencies).
// To EDIT a check:    modify its implementation function below.
//
// CheckResult shape:
//   {
//     id:      string,           // matches the entry in VALIDATION_CHECKS
//     label:   string,           // human-readable title shown in the report
//     status:  'pass'|'fail'|'skip',
//     summary: string,           // one-line outcome
//     items:   Array<{id, status: 'pass'|'fail', message}>
//   }
//   Any extra properties on the result (e.g. refsIRI, refItemIRIs) are copied
//   into ctx so downstream checks can read them.
// ---------------------------------------------------------------------------

'use strict';

// ── Shared utilities ─────────────────────────────────────────────────────────

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
  if (colon > 0 && prefixMap[curie.slice(0, colon)]) {
    return prefixMap[curie.slice(0, colon)] + curie.slice(colon + 1);
  }
  return curie;
}

function fragmentId(iri) {
  if (!iri) return null;
  const idx = iri.indexOf('#');
  return idx >= 0 ? iri.slice(idx + 1) : null;
}

// ── Check implementations ────────────────────────────────────────────────────

// Check 1: exactly one node typed nas:References
function checkRefsSection(data, prefixMap, _htmlDoc, _ctx) {
  const refsType = expandIRI('nas:References', prefixMap);
  const nodes    = [].concat(data['@graph'] || (data['@id'] ? [data] : []));
  const found    = nodes.filter(n =>
    n && [].concat(n['@type'] || []).map(t => expandIRI(t, prefixMap)).includes(refsType)
  );
  if (found.length === 0) {
    return { id: 'ref-section', label: 'References section present', status: 'fail',
      summary: 'No node typed nas:References found in JSON-LD.', items: [], refsIRI: null };
  }
  if (found.length > 1) {
    return { id: 'ref-section', label: 'References section present', status: 'fail',
      summary: `${found.length} nodes typed nas:References found — expected exactly one.`,
      items: found.map(n => ({ id: n['@id'] || '(blank)', status: 'fail', message: 'Duplicate nas:References node' })),
      refsIRI: null };
  }
  return { id: 'ref-section', label: 'References section present', status: 'pass',
    summary: `Found: ${found[0]['@id']}`, items: [],
    refsIRI: expandIRI(found[0]['@id'], prefixMap) };
}

// Check 2: every <li id="..."> inside the refs section is typed nas:ReferenceItem
function checkChildrenAnnotated(data, prefixMap, htmlDoc, ctx) {
  const refsIRI     = ctx.refsIRI;
  const refItemType = expandIRI('nas:ReferenceItem', prefixMap);
  const refsFragId  = fragmentId(refsIRI);
  const refsEl      = refsFragId ? htmlDoc.getElementById(refsFragId) : null;

  if (!refsEl) {
    return { id: 'children-annotated', label: 'Reference children annotated', status: 'fail',
      summary: `HTML element with id="${refsFragId}" not found.`, items: [], refItemIRIs: [] };
  }

  const htmlChildIds = Array.from(refsEl.querySelectorAll('li[id]')).map(el => el.id);

  const nodes        = [].concat(data['@graph'] || (data['@id'] ? [data] : []));
  const refItemIRIs  = nodes
    .filter(n => n && [].concat(n['@type'] || []).map(t => expandIRI(t, prefixMap)).includes(refItemType))
    .map(n => n['@id']).filter(Boolean);
  const refItemFragIds = new Set(refItemIRIs.map(iri => fragmentId(expandIRI(iri, prefixMap))).filter(Boolean));

  const items = htmlChildIds.map(cid => ({
    id: cid,
    status: refItemFragIds.has(cid) ? 'pass' : 'fail',
    message: refItemFragIds.has(cid)
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

// Check 3: every nas:ReferenceItem has schema:mentions → schema:CreativeWork (or subclass).
// Without a reasoner, subclasses must explicitly also declare schema:CreativeWork in @type.
function checkWorkLink(data, prefixMap, _htmlDoc, ctx) {
  const refItemIRIs      = ctx.refItemIRIs;
  const schemaMentions   = expandIRI('schema:mentions', prefixMap);
  const schemaCreativeWork = expandIRI('schema:CreativeWork', prefixMap);
  const nodes            = [].concat(data['@graph'] || (data['@id'] ? [data] : []));
  const byId             = Object.fromEntries(nodes.filter(n => n && n['@id']).map(n => [n['@id'], n]));

  if (!prefixMap['schema']) {
    return { id: 'work-link', label: 'Reference items link a schema:CreativeWork', status: 'fail',
      summary: 'Prefix "schema:" not declared in @context — cannot resolve schema:mentions or schema:CreativeWork.',
      items: [] };
  }

  const items = refItemIRIs.map(iri => {
    const node = byId[iri];
    if (!node) return { id: iri, status: 'fail', message: 'Node not found in JSON-LD graph' };
    let mentions = [];
    for (const [key, val] of Object.entries(node)) {
      if (!key.startsWith('@') && expandIRI(key, prefixMap) === schemaMentions) {
        mentions = [].concat(val); break;
      }
    }
    if (!mentions.length)
      return { id: iri, status: 'fail', message: 'Missing schema:mentions property' };
    const hasWork = mentions.some(m => {
      const tid = (m && m['@id']) || (typeof m === 'string' ? m : null);
      if (!tid) return false;
      const target = byId[tid];
      return target && [].concat(target['@type'] || [])
        .map(t => expandIRI(t, prefixMap)).includes(schemaCreativeWork);
    });
    return { id: iri, status: hasWork ? 'pass' : 'fail',
      message: hasWork
        ? 'Links a schema:CreativeWork via schema:mentions'
        : 'schema:mentions target does not include schema:CreativeWork in its @type' };
  });
  const failing = items.filter(i => i.status === 'fail');

  return { id: 'work-link', label: 'Reference items link a schema:CreativeWork',
    status: failing.length ? 'fail' : 'pass',
    summary: failing.length
      ? `${failing.length} of ${items.length} reference items missing a valid schema:CreativeWork link`
      : `All ${items.length} reference items link a schema:CreativeWork`,
    items: failing };
}

// Check 4: for each nas:ReferenceItem:
//   4a) a nas:Citation exists that schema:mentions the same Work (indirect link via shared target)
//   4b) an <a href="#refFrag"> appears outside the refs section in the HTML
function checkInTextCitation(data, prefixMap, htmlDoc, ctx) {
  const { refsIRI, refItemIRIs } = ctx;
  const citationType   = expandIRI('nas:Citation', prefixMap);
  const schemaMentions = expandIRI('schema:mentions', prefixMap);
  const refsFragId     = fragmentId(refsIRI);
  const refsEl         = refsFragId ? htmlDoc.getElementById(refsFragId) : null;
  const nodes          = [].concat(data['@graph'] || (data['@id'] ? [data] : []));

  function mentionedIRIs(node) {
    for (const [key, val] of Object.entries(node)) {
      if (!key.startsWith('@') && expandIRI(key, prefixMap) === schemaMentions) {
        return new Set([].concat(val)
          .map(v => (v && v['@id']) || (typeof v === 'string' ? v : null))
          .filter(Boolean));
      }
    }
    return new Set();
  }

  const citationNodes = nodes.filter(n =>
    n && [].concat(n['@type'] || []).map(t => expandIRI(t, prefixMap)).includes(citationType)
  );

  const items = refItemIRIs.map(iri => {
    const frag     = fragmentId(expandIRI(iri, prefixMap));
    const refNode  = nodes.find(n => n && n['@id'] === iri);
    const refWorks = refNode ? mentionedIRIs(refNode) : new Set();

    const hasJsonLD = refWorks.size > 0 && citationNodes.some(cit =>
      [...mentionedIRIs(cit)].some(w => refWorks.has(w))
    );

    let htmlLinkCount = 0;
    if (frag) {
      for (const a of htmlDoc.querySelectorAll(`a[href="#${frag}"]`)) {
        if (!refsEl || !refsEl.contains(a)) htmlLinkCount++;
      }
    }
    const hasHtmlLink = htmlLinkCount > 0;

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

// ── Check registry ────────────────────────────────────────────────────────────
// Edit this array to add, remove, or reorder checks.
// `needs`  — IDs of checks that must pass before this one runs.
// `skipIf` — optional function(ctx) → bool; skips this check when true.

const VALIDATION_CHECKS = [
  {
    id:    'ref-section',
    label: 'References section present',
    run:   checkRefsSection,
    needs: [],
  },
  {
    id:    'children-annotated',
    label: 'Reference children annotated',
    run:   checkChildrenAnnotated,
    needs: ['ref-section'],
  },
  {
    id:     'work-link',
    label:  'Reference items link a schema:CreativeWork',
    run:    checkWorkLink,
    needs:  ['children-annotated'],
    skipIf: ctx => !ctx.refItemIRIs || ctx.refItemIRIs.length === 0,
  },
  {
    id:     'in-text-citation',
    label:  'In-text citations present',
    run:    checkInTextCitation,
    needs:  ['children-annotated'],
    skipIf: ctx => !ctx.refItemIRIs || ctx.refItemIRIs.length === 0,
  },
];

// ── Orchestrator ──────────────────────────────────────────────────────────────
// Runs VALIDATION_CHECKS in order, threading ctx between checks.

function runChecks(checks, data, prefixMap, htmlDoc) {
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
      result = check.run(data, prefixMap, htmlDoc, ctx);
      for (const [k, v] of Object.entries(result)) {
        if (!STANDARD.has(k)) ctx[k] = v;
      }
    }
    results.push(result);
    resultById[check.id] = result;
  }
  return results;
}
