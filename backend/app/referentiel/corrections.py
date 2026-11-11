"""Application des corrections ACCEPTÉES du registre (transaction unique, versionnée, réversible)."""
from __future__ import annotations

from .importer import ImportReport, _history_item, ensure_target_ids, normalize_doc
from .store import ReferentielStore, now_iso
from .validate import validate_document


def apply_corrections(store: ReferentielStore, lang: str) -> ImportReport:
    rep = ImportReport(file=f"corrections/{lang}.json", doc_type="corrections")
    cpath = store.path_for("corrections", lang)
    reg = store.read(cpath)
    reg = normalize_doc("corrections", reg) if reg else reg
    if not reg:
        rep.errors.append({"level": "error", "code": "file_not_found", "path": str(cpath), "item_id": None, "message": "aucun registre de corrections"})
        return rep
    tx = store.transaction(f"apply-corrections {lang}")
    now = now_iso()
    docs: dict[str, dict] = {}
    for c in reg["corrections"]:
        if c["status"] != "accepted":
            continue
        ref = c["target_ref"]
        kind = "glossary" if ref["kind"] == "glossary" else "translation-memory"
        raw_doc = docs.get(kind) or store.read(store.path_for(kind, lang))
        doc = raw_doc if kind in docs else (normalize_doc(kind, raw_doc) if raw_doc else None)
        if not doc:
            rep.conflicts.append({"id": c["correction_id"], "code": "target_file_missing"})
            continue
        docs[kind] = doc
        key, idf = ("concepts", "concept_id") if kind == "glossary" else ("segments", "segment_id")
        owner = ref.get("concept_id") if kind == "glossary" else ref.get("segment_id")
        item = next((i for i in doc[key] if i[idf] == owner), None)
        targets = item["targets"] if item else []
        if item:
            ensure_target_ids(owner, targets)
        tgt = next((t for t in targets if t["target_id"] == ref.get("target_id")), None) if ref.get("target_id") else None
        if tgt is None and not ref.get("target_id"):
            cands = [t for t in targets if t.get("preferred") == c.get("previous")] if c.get("previous") else targets
            tgt = cands[0] if len(cands) == 1 else None
        if tgt is None:
            rep.conflicts.append({"id": c["correction_id"], "code": "target_not_found_or_ambiguous"})
            continue
        tgt["history"] = list(tgt.get("history") or []) + [_history_item(tgt, tx.import_id, now)]
        tgt.update(preferred=c["corrected"], accepted=[a for a in c.get("accepted", []) if a != c["corrected"]], status="approved",
                   version=tgt["version"] + 1,
                   validation={"validator_id": c["decided_by"], "validated_at": c["decided_at"], "method": "native_speaker", "comment": f"correction {c['correction_id']}"})
        c["status"] = "applied"
        rep.updated.append({"kind": kind, "id": owner, "target_id": tgt["target_id"], "code": "correction_applied", "correction_id": c["correction_id"]})
    if not rep.updated:
        rep.accepted = True
        rep.notes.append("aucune correction acceptée à appliquer")
        return rep
    for kind, doc in docs.items():
        v = validate_document(doc, expected_type=kind, allow_fixture=True)
        if not v.ok:
            rep.errors.append(v.errors[0].as_dict())
            return rep  # rien n'est écrit
        tx.stage(store.path_for(kind, lang), doc)
    tx.stage(cpath, reg)
    rep.accepted = True
    rep.import_id = tx.import_id
    rep.written_files = [str(p.relative_to(store.data_dir)) for p in tx.staged]
    tx.commit({"doc_type": "corrections", "language": lang, "updated": len(rep.updated), "label": "apply"})
    return rep
