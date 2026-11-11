"""Importateur du référentiel linguistique.

Garanties :
 * validation complète AVANT toute écriture ; mode strict (défaut) = la moindre erreur rejette tout le fichier ;
   mode lenient = les éléments invalides sont écartés (listés), les autres importés ;
 * une traduction `approved` n'est JAMAIS écrasée par une donnée non approuvée, ni par une approbation de
   version ≤ (conflit signalé) ; un remplacement légitime archive l'ancienne version dans `history` ;
 * rien n'est supprimé : éléments absents du fichier entrant = conservés ;
 * écriture transactionnelle avec sauvegarde → retour arrière possible (`rollback`) ;
 * un rapport détaillé est produit dans tous les cas (accepté ou rejeté).
"""
from __future__ import annotations

import copy
import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .legacy import convert as convert_legacy, is_legacy
from .models import CONTRACT_VERSION, DOC_TYPES, SCHEMA_TO_TYPE
from .store import ReferentielStore, dumps, now_iso
from .validate import Issue, ValidationResult, validate_document


@dataclass
class ImportOptions:
    mode: str = "strict"  # strict | lenient
    dry_run: bool = False
    allow_fixture: bool = False
    allow_demote: bool = False  # autorise rejected/deprecated à remplacer un approved (version supérieure)
    replace_approved: bool = False  # corpus/benchmark : autorise le remplacement d'une référence approuvée
    expected_language: str | None = None
    apply_corrections: bool = False


@dataclass
class ImportReport:
    file: str
    doc_type: str | None = None
    accepted: bool = False
    dry_run: bool = False
    mode: str = "strict"
    import_id: str | None = None
    dataset_version: str | None = None
    language: str | None = None
    counts: dict[str, int] = field(default_factory=dict)
    status_counts: dict[str, int] = field(default_factory=dict)  # statuts des cibles du fichier entrant
    added: list[dict] = field(default_factory=list)
    updated: list[dict] = field(default_factory=list)
    unchanged: int = 0
    protected: list[dict] = field(default_factory=list)  # donnée approuvée préservée
    conflicts: list[dict] = field(default_factory=list)  # divergences non résolues automatiquement
    skipped: list[dict] = field(default_factory=list)  # éléments invalides écartés (lenient)
    errors: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    written_files: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return dict(self.__dict__)

    def summary(self) -> str:
        c = self.counts
        head = "ACCEPTÉ" if self.accepted else "REJETÉ"
        if self.dry_run:
            head += " (simulation, rien écrit)"
        return (f"{head} · {self.doc_type} · {self.file}\n"
                f"  éléments : {c.get('items_in_file', 0)} dans le fichier · {len(self.added)} ajoutés · {len(self.updated)} mis à jour · "
                f"{self.unchanged} inchangés · {len(self.protected)} protégés · {len(self.conflicts)} conflits · {len(self.skipped)} écartés\n"
                f"  statuts (cibles) : {self.status_counts}\n"
                f"  erreurs : {len(self.errors)} · avertissements : {len(self.warnings)}"
                + (f"\n  import_id : {self.import_id}  (annulation : python -m app.referentiel rollback {self.import_id})" if self.import_id else ""))


def _sig(t: dict) -> tuple:
    return (t.get("preferred"), tuple(t.get("accepted") or []), t.get("status"), tuple(sorted(t.get("contexts") or [])),
            json.dumps(t.get("validation") or {}, sort_keys=True))


def _ctx_sig(t: dict) -> tuple:
    return tuple(sorted(t.get("contexts") or []))


def _next_tid(owner: str, used: set[str]) -> str:
    n = 1
    while f"{owner}~t{n}" in used:
        n += 1
    tid = f"{owner}~t{n}"
    used.add(tid)
    return tid


def ensure_target_ids(owner: str, targets: list[dict]) -> bool:
    """Attribue (de façon déterministe) un target_id aux cibles qui n'en ont pas. Retourne True si modifié."""
    used = {t["target_id"] for t in targets if t.get("target_id")}
    changed = False
    for t in targets:
        if not t.get("target_id"):
            t["target_id"] = _next_tid(owner, used)
            changed = True
    return changed


def _history_item(old: dict, import_id: str, now: str) -> dict:
    return {"version": old["version"], "status": old["status"], "preferred": old.get("preferred"),
            "accepted": list(old.get("accepted") or []), "validation": old.get("validation") or {},
            "replaced_at": now, "replaced_by": import_id}


def merge_targets(owner: str, existing: list[dict], incoming: list[dict], *, import_id: str, now: str,
                  opts: ImportOptions, rep: ImportReport, kind: str, log_adds: bool = True) -> tuple[list[dict], bool]:
    """Fusionne les cibles d'un élément. Retourne (cibles, modifié)."""
    out = [dict(t, history=list(t.get("history") or [])) for t in existing]
    used = {t["target_id"] for t in out if t.get("target_id")}
    by_id = {t["target_id"]: t for t in out}
    matched: set[str] = set()
    changed = False
    for inc in incoming:
        inc = dict(inc)
        tid = inc.get("target_id")
        cur = by_id.get(tid) if tid else None
        if cur is None and not tid:  # rapprochement par signature de contextes
            cur = next((t for t in out if t["target_id"] not in matched and _ctx_sig(t) == _ctx_sig(inc)), None)
        if cur is None:
            inc["target_id"] = tid or _next_tid(owner, used)
            used.add(inc["target_id"])
            inc.setdefault("history", [])
            out.append(inc)
            by_id[inc["target_id"]] = inc
            matched.add(inc["target_id"])
            if log_adds:
                rep.added.append({"kind": kind, "id": owner, "target_id": inc["target_id"], "status": inc["status"], "code": "new_target"})
            changed = True
            continue
        matched.add(cur["target_id"])
        if _sig(cur) == _sig(inc):
            rep.unchanged += 1
            continue
        ref = {"kind": kind, "id": owner, "target_id": cur["target_id"]}
        if cur["status"] == "approved":
            if inc["status"] == "approved":
                if inc["version"] > cur["version"]:
                    _replace(cur, inc, import_id, now, inc["version"])
                    rep.updated.append(ref | {"code": "approved_replaced", "from_version": cur["history"][-1]["version"], "to_version": cur["version"]})
                    changed = True
                else:
                    rep.conflicts.append(ref | {"code": "approved_version_conflict",
                                                "detail": f"existant v{cur['version']} approuvé ≠ entrant v{inc['version']} approuvé : version entrante non supérieure"})
            elif opts.allow_demote and inc["status"] in ("rejected", "deprecated") and inc["version"] > cur["version"]:
                _replace(cur, inc, import_id, now, inc["version"])
                rep.updated.append(ref | {"code": "approved_demoted", "to_status": inc["status"]})
                changed = True
            else:
                rep.protected.append(ref | {"code": "approved_protected", "detail": f"entrant {inc['status']} ignoré : la traduction approuvée est conservée"})
        else:  # non approuvé : l'entrant fait foi, l'ancienne version est archivée
            _replace(cur, inc, import_id, now, max(inc["version"], cur["version"] + 1))
            rep.updated.append(ref | {"code": "replaced", "to_status": inc["status"]})
            changed = True
    absent = [t["target_id"] for t in out if t["target_id"] not in matched]
    if absent:
        rep.notes.append(f"{owner} : cibles absentes du fichier entrant conservées {absent}")
    return out, changed


def _replace(cur: dict, inc: dict, import_id: str, now: str, version: int) -> None:
    hist = list(cur.get("history") or []) + [_history_item(cur, import_id, now)]
    keep_id = cur["target_id"]
    cur.clear()
    cur.update(inc)
    cur.update(target_id=keep_id, version=version, history=hist)


def _doc_skeleton(kind: str, meta: dict, key: str | None) -> dict:
    d = {"schema": DOC_TYPES[kind]["schema"], "schema_version": CONTRACT_VERSION, "meta": meta}
    if key:
        d[key] = []
    return d


def normalize_doc(kind: str, raw: dict) -> dict:
    """Document brut → forme canonique complète (champs par défaut explicites). Lève ValidationError si invalide."""
    return DOC_TYPES[kind]["model"].model_validate(raw).model_dump(mode="json", by_alias=True)


def _dump(obj) -> dict:
    return obj.model_dump(mode="json", by_alias=True)


# ============================================================================== point d'entrée
def import_document(source: Path | dict, store: ReferentielStore, opts: ImportOptions | None = None) -> ImportReport:
    opts = opts or ImportOptions()
    name = str(source) if not isinstance(source, dict) else "<dict>"
    rep = ImportReport(file=name, dry_run=opts.dry_run, mode=opts.mode)

    def fail(code: str, msg: str, path: str = "$") -> ImportReport:
        rep.errors.append(Issue("error", code, path, msg).as_dict())
        return rep

    if isinstance(source, dict):
        raw = source
    else:
        try:
            raw = json.loads(Path(source).read_text(encoding="utf-8"))
        except FileNotFoundError:
            return fail("file_not_found", f"fichier introuvable : {source}")
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            return fail("invalid_json", f"JSON illisible : {e}")

    if is_legacy(raw):  # conversion automatique du format v0
        legacy_kind = "translation-memory" if "memory" in name.lower() else "glossary"
        raw, warns = convert_legacy(raw, legacy_kind)
        rep.notes.append(f"format v0 converti en contrat {CONTRACT_VERSION} ({legacy_kind})")
        rep.warnings += [Issue("warning", "converted_legacy", "$", w).as_dict() for w in warns]

    # Connaissance du store pour les contrôles croisés (avertissements)
    lang = (raw.get("meta") or {}).get("language") if isinstance(raw, dict) else None
    known_concepts = known_segments = None
    if lang:
        g = store.read(store.path_for("glossary", lang)) if (store.path_for("glossary", lang)).exists() else None
        known_concepts = {c["concept_id"] for c in (g or {}).get("concepts", [])} or None
        m = store.read(store.path_for("translation-memory", lang)) if (store.path_for("translation-memory", lang)).exists() else None
        known_segments = {s["segment_id"] for s in (m or {}).get("segments", [])} or None
    res = validate_document(raw, expected_language=opts.expected_language, allow_fixture=opts.allow_fixture,
                            known_concepts=known_concepts, known_segments=known_segments)
    rep.doc_type = res.doc_type
    rep.warnings += [w.as_dict() for w in res.warnings]
    rep.counts["items_in_file"] = res.item_total
    if res.meta:
        rep.dataset_version, rep.language = res.meta.dataset_version, res.meta.language
    if res.doc_issues:
        rep.errors += [i.as_dict() for i in res.doc_issues]
        return rep
    item_errors = [i for v in res.item_issues.values() for i in v]
    if item_errors and opts.mode == "strict":
        rep.errors += [i.as_dict() for i in item_errors]
        rep.notes.append("mode strict : fichier rejeté en entier, aucune donnée modifiée")
        return rep
    if item_errors:  # lenient
        for idx, issues in sorted(res.item_issues.items()):
            rep.skipped.append({"index": idx, "item_id": issues[0].item_id, "reasons": [i.code for i in issues],
                                "messages": [i.message for i in issues]})
        rep.errors += [i.as_dict() | {"level": "error"} for i in item_errors]
    rep.counts["items_valid"] = len(res.items)
    if res.items == [] and res.doc_type != "language-profile" and res.item_total:
        rep.notes.append("aucun élément valide à importer")
        return rep

    tx = store.transaction(f"import {res.doc_type} {Path(name).name}")
    now = now_iso()
    try:
        _apply(res, raw, store, tx, opts, rep, now)
    except StoreCorrupt as e:
        return fail("store_corrupt", str(e))
    rep.import_id = tx.import_id
    rep.written_files = [str(p.relative_to(store.data_dir)) for p in tx.staged]
    rep.accepted = True
    if opts.dry_run or not tx.staged:
        rep.import_id = None
        if not opts.dry_run:
            rep.notes.append("aucun changement à écrire")
        return rep
    tx.commit({"doc_type": res.doc_type, "dataset_version": rep.dataset_version, "language": rep.language,
               "added": len(rep.added), "updated": len(rep.updated), "protected": len(rep.protected),
               "conflicts": len(rep.conflicts), "mode": opts.mode})
    store.reports.mkdir(parents=True, exist_ok=True)
    (store.reports / f"{tx.import_id}.json").write_text(dumps(rep.as_dict()), encoding="utf-8")
    return rep


class StoreCorrupt(Exception):
    pass


def _load_existing(store: ReferentielStore, kind: str, ident: str, lang: str) -> dict | None:
    p = store.path_for(kind, ident)
    if not p.exists():
        return None
    raw = store.read(p)
    v = validate_document(raw, expected_type=kind, allow_fixture=True)
    if not v.ok:
        raise StoreCorrupt(f"le fichier existant {p.name} est invalide ({v.errors[0].code}) : import refusé pour ne pas l'écraser")
    return normalize_doc(kind, raw)


def _apply(res: ValidationResult, raw: dict, store: ReferentielStore, tx, opts: ImportOptions, rep: ImportReport, now: str) -> None:
    kind, meta = res.doc_type, res.meta
    meta_d = _dump(meta)
    if kind == "language-profile":
        _apply_profile(res, store, tx, rep, now)
        return
    spec = DOC_TYPES[kind]
    key = spec["items"]
    ident = meta.language if kind in ("glossary", "translation-memory", "corrections") else raw["corpus_id" if kind == "corpus" else "benchmark_id"]
    existing = _load_existing(store, kind, ident, meta.language)
    original = copy.deepcopy(existing)  # état initial : sert à détecter un vrai changement (doc est modifié en place)
    doc = existing or _doc_skeleton(kind, meta_d, key)
    if existing and existing["meta"]["language"] != meta.language:
        raise StoreCorrupt("langue du fichier existant différente")
    for it in doc[key]:
        if "targets" in it:
            ensure_target_ids(it[spec["id"]], it["targets"])
    items = {it[spec["id"]]: it for it in doc[key]}
    for obj in res.items:
        d = _dump(obj)
        iid = d[spec["id"]]
        for t in d.get("targets", []) or []:
            rep.status_counts[t["status"]] = rep.status_counts.get(t["status"], 0) + 1
        cur = items.get(iid)
        if kind in ("glossary", "translation-memory"):
            incoming_targets = d.pop("targets")
            if cur is None:
                targets, _ = merge_targets(iid, [], incoming_targets, import_id=tx.import_id, now=now, opts=opts, rep=rep, kind=kind, log_adds=False)
                d["targets"] = targets
                items[iid] = d
                rep.added.append({"kind": kind, "id": iid, "code": "new_item"})
                continue
            targets, tchanged = merge_targets(iid, cur.get("targets", []), incoming_targets, import_id=tx.import_id, now=now,
                                              opts=opts, rep=rep, kind=kind)
            non_target_changed = {k: v for k, v in d.items() if k != "version"} != {k: v for k, v in cur.items() if k not in ("targets", "version")}
            if non_target_changed or tchanged:
                new = dict(d, targets=targets)
                new["version"] = max(d.get("version", 1), cur.get("version", 1) + 1)
                items[iid] = new
                if non_target_changed:
                    rep.updated.append({"kind": kind, "id": iid, "code": "item_fields_updated"})
            else:
                items[iid] = dict(cur, targets=targets)
                rep.unchanged += 1
        elif kind in ("corpus", "benchmark"):
            _merge_reference_item(kind, iid, d, cur, items, opts, rep)
        elif kind == "corrections":
            if cur is None:
                items[iid] = d
                rep.added.append({"kind": kind, "id": iid, "code": "new_item"})
            elif cur["status"] == "applied" and d != cur:
                rep.protected.append({"kind": kind, "id": iid, "code": "applied_protected", "detail": "correction déjà appliquée, non modifiable"})
            elif d == cur:
                rep.unchanged += 1
            else:
                items[iid] = d
                rep.updated.append({"kind": kind, "id": iid, "code": "replaced"})
    incoming_ids = {getattr(o, spec["id"]) for o in res.items}
    kept = [i for i in items if i not in incoming_ids]
    if kept:
        rep.counts["kept_absent_from_file"] = len(kept)  # jamais supprimés
    doc[key] = list(items.values())
    doc["meta"] = meta_d | {"provenance": meta_d.get("provenance") or doc["meta"].get("provenance")}
    if kind == "corpus":
        doc["corpus_id"] = ident
    if kind == "benchmark":
        doc["benchmark_id"] = ident
        doc["scoring"] = raw.get("scoring") or doc.get("scoring") or {}
    # le document final doit lui-même être valide : garde-fou avant toute écriture
    final = validate_document(doc, expected_type=kind, allow_fixture=True)
    if not final.ok:
        raise StoreCorrupt(f"document résultant invalide ({final.errors[0].code}: {final.errors[0].message}) — rien n'est écrit")
    if doc != original:
        tx.stage(store.path_for(kind, ident), doc)


def _merge_reference_item(kind, iid, d, cur, items, opts, rep) -> None:
    if cur is None:
        items[iid] = d
        rep.added.append({"kind": kind, "id": iid, "code": "new_item"})
        return
    if d == cur:
        rep.unchanged += 1
        return

    def refs(x):
        return [x["reference"]] if kind == "corpus" else x.get("references", [])
    approved_old = [r for r in refs(cur) if r["status"] == "approved"]
    approved_new = [r for r in refs(d) if r["status"] == "approved"]
    if approved_old and approved_old != approved_new and not opts.replace_approved:
        code = "approved_protected" if not approved_new else "approved_reference_conflict"
        (rep.protected if not approved_new else rep.conflicts).append({"kind": kind, "id": iid, "code": code,
                                                                       "detail": "référence approuvée conservée (option replace_approved pour remplacer)"})
        return
    items[iid] = d
    rep.updated.append({"kind": kind, "id": iid, "code": "replaced"})


def _apply_profile(res: ValidationResult, store: ReferentielStore, tx, rep: ImportReport, now: str) -> None:
    prof = res.profile
    code = prof.language.code
    p = store.path_for("language-profile", code)
    new_doc = prof.model_dump(mode="json", by_alias=True)
    old = store.read(p)
    if old == new_doc:
        rep.unchanged += 1
        return
    (rep.updated if old else rep.added).append({"kind": "language-profile", "id": code, "code": "profile_written"})
    tx.stage(p, new_doc)
    langs = store.read(store.languages_path)
    for t in langs["target_languages"]:
        if t["code"] == code:
            L = prof.language
            t.update(name=L.name, native_name=L.native_name or t.get("native_name"), iso639_3=L.iso639_3 or t.get("iso639_3"),
                     variety_code=L.variety, script=L.script, availability=L.availability,
                     machine_translation=L.machine_translation, nllb_code=L.nllb_code,
                     orthography=L.orthography.description or t.get("orthography", ""),
                     notes=L.notes or t.get("notes", ""))
            if L.style_guide:
                t["style_guide"] = L.style_guide.model_dump()
            tx.stage(store.languages_path, langs)
            break
    else:
        rep.warnings.append(Issue("warning", "language_not_registered", "language.code",
                                  f"{code} absent de languages.json : profil stocké, fiche de langue non modifiée").as_dict())
