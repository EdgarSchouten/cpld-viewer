# Memory Index

- [JSON-LD namespace discipline](feedback_jsonld_namespaces.md) — Do not invent terms under `schema:` or any declared external namespace; only `ex:` is allowed for local identifiers
- [HTML id attributes](feedback_html_ids.md) — use opaque generated ids (e.g. f2a8c3d1) not meaningful names; semantics belong in JSON-LD, not in the values of the id-attribute.
- [Fragment as mention](feedback_fragment_as_mention.md) — HTML fragments (`doc:` IRIs) are textual mentions, not entities; use `schema:mentions` to link them to a separate entity IRI in a stable namespace (`ex:` etc.)
- [schema: not edm:](feedback_schema_not_edm.md) — Use schema.org (`schema:`) only; `edm:` (Europeana) is not used. Known mappings: `edm:mentions`→`schema:mentions`, `edm:Work`→`schema:ScholarlyArticle`
- [Bibliographic validation plan](project_biblio_validation_plan.md) — Agreed plan for the Validate tab feature (checks 1–4, UI, file changes)
- [Comunica v5 browser — use N3.Store not serialized source](feedback_comunica_n3store.md) — `type:'serialized'` + `application/n-quads` is broken in browser bundle; parse with N3.js and pass the store directly
