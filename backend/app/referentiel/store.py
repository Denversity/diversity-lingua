"""Stockage du référentiel : écritures atomiques, sauvegarde automatique, retour arrière.

Une SEULE voie d'écriture pour les données linguistiques (importateur, validation via API, application
des corrections). Chaque transaction : (1) sauvegarde des fichiers touchés, (2) écriture temporaire,
(3) remplacement atomique ; en cas d'échec au milieu, tout est restauré.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

KIND_DIRS = {"glossary": "glossary", "translation-memory": "memory", "corpus": "corpus", "benchmark": "benchmark",
             "corrections": "corrections", "language-profile": "profiles"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def dumps(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


class ReferentielStore:
    def __init__(self, data_dir: Path, state_dir: Path):
        self.data_dir, self.state_dir = Path(data_dir), Path(state_dir)
        self.backups = self.state_dir / "import_backups"
        self.reports = self.state_dir / "import_reports"
        self.manifest_path = self.data_dir / "referentiel_manifest.json"

    # ------------------------------------------------------------------ chemins
    def path_for(self, kind: str, ident: str) -> Path:
        if not ident or "/" in ident or "\\" in ident or ident.startswith("."):
            raise ValueError(f"identifiant de fichier invalide : {ident!r}")
        return self.data_dir / KIND_DIRS[kind] / f"{ident}.json"

    def read(self, path: Path):
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    @property
    def languages_path(self) -> Path:
        return self.data_dir / "languages.json"

    # ------------------------------------------------------------------ transactions
    def transaction(self, label: str) -> "Transaction":
        return Transaction(self, label)

    def history(self) -> list[dict]:
        return (self.read(self.manifest_path) or {"imports": []})["imports"]

    def last_import_id(self) -> str | None:
        h = [i for i in self.history() if not i.get("rolled_back")]
        return h[-1]["import_id"] if h else None

    def rollback(self, import_id: str) -> dict:
        bdir = self.backups / import_id
        man = self.read(bdir / "backup.json")
        if not man:
            raise FileNotFoundError(f"aucune sauvegarde pour {import_id}")
        manifest = self.read(self.manifest_path) or {"imports": []}
        entry = next((i for i in manifest["imports"] if i["import_id"] == import_id), None)
        if entry and entry.get("rolled_back"):
            raise ValueError(f"{import_id} est déjà annulé")
        ids = [i["import_id"] for i in manifest["imports"]]
        pos = ids.index(import_id) if import_id in ids else len(ids)
        later = [i["import_id"] for i in manifest["imports"][pos + 1:] if not i.get("rolled_back")]  # ordre du journal, pas des identifiants
        if later:
            raise ValueError(f"annuler d'abord les imports plus récents : {later}")
        restored, removed = [], []
        for rel in man["existing"]:
            shutil.copy2(bdir / "files" / rel, self.data_dir / rel)
            restored.append(rel)
        for rel in man["created"]:
            p = self.data_dir / rel
            if p.exists():
                p.unlink()
                removed.append(rel)
        if entry:
            entry["rolled_back"] = True
            entry["rolled_back_at"] = now_iso()
            self._write_atomic(self.manifest_path, dumps(manifest))
        return {"import_id": import_id, "restored": restored, "removed": removed}

    def _write_atomic(self, path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)


class Transaction:
    def __init__(self, store: ReferentielStore, label: str):
        self.store, self.label = store, label
        self.import_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:6]
        self.staged: dict[Path, str] = {}

    def stage(self, path: Path, data) -> None:
        self.staged[Path(path)] = data if isinstance(data, str) else dumps(data)

    def commit(self, summary: dict | None = None) -> str:
        s = self.store
        bdir = s.backups / self.import_id
        existing, created = [], []
        for p in self.staged:
            rel = str(p.relative_to(s.data_dir))
            if p.exists():
                dst = bdir / "files" / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(p, dst)
                existing.append(rel)
            else:
                created.append(rel)
        bdir.mkdir(parents=True, exist_ok=True)
        (bdir / "backup.json").write_text(dumps({"import_id": self.import_id, "label": self.label, "at": now_iso(),
                                                 "existing": existing, "created": created}), encoding="utf-8")
        try:
            for p, text in self.staged.items():
                s._write_atomic(p, text)
            manifest = s.read(s.manifest_path) or {"imports": []}
            manifest["imports"].append({"import_id": self.import_id, "label": self.label, "at": now_iso(), **(summary or {})})
            s._write_atomic(s.manifest_path, dumps(manifest))
        except Exception:
            for rel in existing:  # restauration complète
                shutil.copy2(bdir / "files" / rel, s.data_dir / rel)
            for rel in created:
                (s.data_dir / rel).unlink(missing_ok=True)
            raise
        return self.import_id
