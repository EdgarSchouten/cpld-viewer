---
name: feedback_comunica_n3store
description: Comunica v5 browser bundle cannot use type:'serialized' + application/n-quads — use N3.Store as source instead
metadata:
  type: feedback
---

Do NOT pass in-memory RDF to Comunica v5 (browser bundle) as `{ type: 'serialized', value: nquads, mediaType: 'application/n-quads' }`. This path is broken in the browser build regardless of webpack mode (production or development) — it returns incorrect query results (all subjects match any type pattern).

**Why:** Comunica v5's `serialized` source handler does not correctly route N-Quads media type to the N3.js parser actor when running in a browser webpack bundle.

**How to apply:** Instead, parse N-Quads with N3.js first, then pass the resulting `N3.Store` (an RDF.js DatasetCore) directly as a source — Comunica v5 accepts it natively:

```javascript
const store = new N3.Store();
store.addQuads(new N3.Parser({ format: 'N-Quads' }).parse(nquads));
const stream = await engine.queryBindings(sparql, { sources: [store] });
```

Load N3.js via CDN before the Comunica bundle:
```html
<script src="https://cdn.jsdelivr.net/npm/n3/browser/n3.min.js"></script>
```
This exposes `window.N3` with `N3.Store` and `N3.Parser`.
