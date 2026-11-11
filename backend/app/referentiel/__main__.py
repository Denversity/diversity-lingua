"""CLI : python -m app.referentiel <commande>  (depuis backend/)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ..core.config import get_settings
from .corrections import apply_corrections
from .importer import ImportOptions, import_document
from .legacy import convert, is_legacy
from .models import SCHEMA_TO_TYPE
from .store import ReferentielStore, dumps
from .validate import validate_document


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.referentiel", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate", help="valider un fichier sans rien écrire")
    v.add_argument("file", type=Path)
    v.add_argument("--allow-fixture", action="store_true")
    i = sub.add_parser("import", help="importer un fichier du responsable linguistique")
    i.add_argument("file", type=Path)
    i.add_argument("--mode", choices=["strict", "lenient"], default="strict")
    i.add_argument("--dry-run", action="store_true")
    i.add_argument("--allow-fixture", action="store_true")
    i.add_argument("--allow-demote", action="store_true")
    i.add_argument("--replace-approved", action="store_true")
    i.add_argument("--language", default=None, help="langue cible attendue (ex. ff)")
    i.add_argument("--report", type=Path, help="écrire le rapport JSON ici")
    r = sub.add_parser("rollback", help="annuler un import")
    r.add_argument("import_id", nargs="?")
    r.add_argument("--last", action="store_true")
    sub.add_parser("history", help="lister les imports")
    a = sub.add_parser("apply-corrections", help="appliquer les corrections acceptées")
    a.add_argument("--language", default="ff")
    e = sub.add_parser("export", help="exporter un document au format contrat")
    e.add_argument("kind", choices=sorted(SCHEMA_TO_TYPE.values()))
    e.add_argument("ident", help="langue (ff) ou identifiant corpus/benchmark")
    e.add_argument("--out", type=Path)
    c = sub.add_parser("convert-legacy", help="convertir un ancien fichier v0")
    c.add_argument("file", type=Path)
    c.add_argument("--kind", choices=["glossary", "translation-memory"], default="glossary")
    c.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)

    s = get_settings()
    store = ReferentielStore(s.data_dir, s.state_dir)
    if args.cmd == "validate":
        raw = json.loads(args.file.read_text(encoding="utf-8"))
        res = validate_document(raw, allow_fixture=args.allow_fixture)
        for x in res.errors + res.warnings:
            print(f"[{x.level}] {x.code} {x.path} — {x.message}")
        print(f"{'VALIDE' if res.ok else 'INVALIDE'} · {res.doc_type} · {res.item_total} éléments · {len(res.errors)} erreurs · {len(res.warnings)} avertissements")
        return 0 if res.ok else 1
    if args.cmd == "import":
        opts = ImportOptions(mode=args.mode, dry_run=args.dry_run, allow_fixture=args.allow_fixture, allow_demote=args.allow_demote,
                             replace_approved=args.replace_approved, expected_language=args.language)
        rep = import_document(args.file, store, opts)
        print(rep.summary())
        for x in (rep.errors[:15]):
            print(f"  [erreur] {x['code']} {x['path']} — {x['message']}")
        for x in rep.conflicts[:15]:
            print(f"  [conflit] {x}")
        if args.report:
            args.report.write_text(dumps(rep.as_dict()), encoding="utf-8")
        return 0 if rep.accepted else 1
    if args.cmd == "rollback":
        iid = args.import_id or (store.last_import_id() if args.last else None)
        if not iid:
            print("préciser un import_id ou --last"); return 2
        print(json.dumps(store.rollback(iid), ensure_ascii=False, indent=2)); return 0
    if args.cmd == "history":
        for h in store.history():
            print(f"{h['import_id']}  {h.get('doc_type','?'):20} {str(h.get('dataset_version','?')):12} +{h.get('added',0)} ~{h.get('updated',0)} {'(annulé)' if h.get('rolled_back') else ''}")
        return 0
    if args.cmd == "apply-corrections":
        rep = apply_corrections(store, args.language)
        print(rep.summary())
        return 0 if rep.accepted else 1
    if args.cmd == "export":
        p = store.path_for(args.kind, args.ident)
        data = store.read(p)
        if data is None:
            print("introuvable"); return 1
        text = dumps(data)
        (args.out.write_text(text, encoding="utf-8") if args.out else print(text)); return 0
    if args.cmd == "convert-legacy":
        raw = json.loads(args.file.read_text(encoding="utf-8"))
        if not is_legacy(raw):
            print("pas un fichier v0"); return 1
        doc, warns = convert(raw, args.kind)
        args.out.write_text(dumps(doc), encoding="utf-8")
        print(f"converti → {args.out} ({len(warns)} avertissements)"); return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
