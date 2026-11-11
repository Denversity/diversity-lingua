"""Glossaire validé / mémoire de traduction — lecture du CONTRAT d'échange (data/glossary|memory/<langue>.json).

 * Un fichier invalide n'empêche JAMAIS le démarrage : il est ignoré et signalé (`load_errors`).
 * Seules les cibles `approved` sont servies comme « approved ». `pending_validation` et `rejected` sont
   connues du moteur (pour un statut explicite) mais jamais présentées comme validées.
 * Recherche : par formulation (index séparé par langue source — pas de mélange fr/en), par concept_id,
   désambiguïsation par contexte (sinon abstention `ambiguous_context`).
 * Écriture : une seule voie (ReferentielStore), atomique, avec historique des versions.
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from .textnorm import normalize  # ré-exporté pour compatibilité

__all__ = ["GlossaryService", "Entry", "Lookup", "normalize"]

# --------------------------------------------------------------------------- appariement « à gabarit »
# La mémoire contient des phrases à variables (`Vous allez envoyer {{P0}} FCFA à {{P1}}.`). Le masquage du
# texte réel, lui, produit UN jeton pour « 5 000 FCFA » (devise incluse) et laisse les noms en clair.
# L'appariement exact échouerait donc sur toutes ces phrases. Ici : comparaison par gabarit, SANS jamais
# modifier le texte validé — seuls les jetons sont remplacés par les valeurs de la requête.
_TOK = re.compile(r"\{\{P(\d+)\}\}")
_CUR_WORDS = r"(?:FCFA|F\s?CFA|XAF|XOF|CFA)"
_NAME_WORD = r"[^\W\d_][\w'\-]*"
_NAME = _NAME_WORD + r"(?:\ " + _NAME_WORD + r"){0,3}"
_NAME_PARTICLES = {"de", "du", "des", "la", "le", "ben", "bin", "ibn", "al", "el"}
_STRIP_CHARS = " \t\r\n.:;…«»\"'"


def _canon(text: str) -> str:
    """Comme `normalize`, mais en conservant la casse (nécessaire pour reconnaître un nom propre)."""
    t = unicodedata.normalize("NFC", text).replace("\u2019", "'").replace("\u00a0", " ")
    return re.sub(r"\s+", " ", t).strip(_STRIP_CHARS)


def _looks_like_name(value: str) -> bool:
    return all(w[:1].isupper() or w.casefold() in _NAME_PARTICLES for w in value.split(" "))


@dataclass
class _Template:
    entry: "Entry"
    regex: re.Pattern
    absorb: frozenset  # indices de jetons dont la valeur contient déjà la devise (montants masqués)
    literal_len: int

    def match(self, masked_canon: str) -> dict[int, str] | None:
        m = self.regex.fullmatch(masked_canon)
        if not m:
            return None
        got = {int(k[1:]): v for k, v in m.groupdict().items()}
        if any(not _TOK.fullmatch(v) and not _looks_like_name(v) for v in got.values()):
            return None  # texte libre non assimilable à un nom propre : on s'abstient
        return got

    def render(self, text: str | None, captured: dict[int, str]) -> str | None:
        if text is None:
            return None
        pat = re.compile(
            rf"(?P<pre>(?<![A-Za-z0-9]){_CUR_WORDS}\s?)?\{{\{{P(?P<k>\d+)\}}\}}(?P<post>\s?{_CUR_WORDS}(?![A-Za-z0-9]))?",
            re.I)

        def repl(m: re.Match) -> str:
            k = int(m.group("k"))
            if k not in captured:
                return m.group(0)
            if k in self.absorb:
                return captured[k]
            return (m.group("pre") or "") + captured[k] + (m.group("post") or "")
        return pat.sub(repl, text)


def _build_template(entry: "Entry") -> _Template | None:
    t = _canon(entry.source_text)
    if not _TOK.search(t):
        return None
    pieces: list[str] = []
    seen: set[int] = set()
    absorb: set[int] = set()
    letters = 0
    pos = 0

    def lit(chunk: str) -> str:
        nonlocal letters
        letters += sum(c.isalpha() for c in chunk)
        return r"\s+".join(re.escape(w) for w in chunk.split(" "))

    for m in _TOK.finditer(t):
        pieces.append(lit(t[pos:m.start()]))
        k = int(m.group(1))
        pos = m.end()
        cm = re.match(rf"\s?{_CUR_WORDS}(?![A-Za-z0-9])", t[pos:], re.I)
        if cm:
            absorb.add(k)
            pos += cm.end()
        if k in seen:
            pieces.append(f"(?P=s{k})")
        else:
            seen.add(k)
            slot = r"\{\{P\d+\}\}" if k in absorb else r"(?:\{\{P\d+\}\}|" + _NAME + r")"
            pieces.append(f"(?P<s{k}>{slot})")
    pieces.append(lit(t[pos:]))
    if letters < 3:  # gabarit quasi vide (« {{P0}} ») : trop permissif, recherche exacte uniquement
        return None
    return _Template(entry, re.compile("".join(pieces), re.I), frozenset(absorb), letters)



@dataclass
class Entry:
    id: str
    concept_id: str | None
    owner_id: str  # concept_id (glossaire) ou segment_id (mémoire)
    target_id: str
    source_lang: str
    source_text: str
    translation: str | None
    alternatives: list[str]
    contexts: list[str]
    status: str
    version: int
    test_data: bool
    target_lang: str
    validator_id: str | None = None
    validated_at: str | None = None
    method: str | None = None
    form_kind: str = "preferred"

    @property
    def usable(self) -> bool:
        return self.status == "approved" and bool(self.translation)

    def public(self) -> dict:
        return {"id": self.id, "concept_id": self.concept_id, "owner_id": self.owner_id, "target_id": self.target_id,
                "source_lang": self.source_lang, "target_lang": self.target_lang, "source_text": self.source_text,
                "form_kind": self.form_kind, "translation": self.translation, "alternatives": self.alternatives,
                "contexts": self.contexts, "status": self.status, "version": self.version, "test_data": self.test_data,
                "validator_id": self.validator_id, "validated_at": self.validated_at, "method": self.method}


@dataclass
class Lookup:
    entry: Entry | None = None
    reason: str | None = None  # ambiguous_context
    tier: str | None = None  # approved | pending_validation | rejected
    rendered: str | None = None  # traduction avec les jetons de la REQUÊTE (appariement à gabarit)
    rendered_alternatives: list[str] | None = None


class GlossaryService:
    KIND = {"glossary": "glossary", "memory": "translation-memory"}

    def __init__(self, directory: Path, state_dir: Path | None = None, allow_test: bool = True, name: str = "glossary"):
        self.name = name
        self.directory = Path(directory)
        self.state_dir = Path(state_dir) if state_dir else None
        self.allow_test = allow_test
        self.entries: dict[str, Entry] = {}
        self._index: dict[tuple[str, str, str], list[Entry]] = {}
        self._templates: dict[tuple[str, str], list[_Template]] = {}
        self.concepts: dict[tuple[str, str], dict] = {}  # (langue cible, owner_id) → élément brut
        self.versions: dict[str, str] = {}
        self.load_errors: list[dict] = []
        self.reload()

    # ------------------------------------------------------------------ chargement tolérant
    def reload(self) -> None:
        from ..referentiel.validate import validate_document
        self.entries.clear(); self._index.clear(); self._templates.clear(); self.concepts.clear(); self.load_errors.clear()
        kind = self.KIND[self.name]
        for f in sorted(self.directory.glob("*.json")):
            try:
                raw = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as e:
                self.load_errors.append({"file": f.name, "code": "invalid_json", "message": str(e)[:200]})
                continue
            res = validate_document(raw, expected_type=kind, allow_fixture=True)
            if res.doc_issues:
                self.load_errors.append({"file": f.name, "code": res.doc_issues[0].code, "message": res.doc_issues[0].message})
                continue
            if res.meta.fixture and not self.allow_test:
                continue
            for issues in res.item_issues.values():  # éléments invalides ignorés, le reste est servi
                self.load_errors.append({"file": f.name, "code": issues[0].code, "item_id": issues[0].item_id, "message": issues[0].message})
            lang = res.meta.language
            self.versions[lang] = res.meta.dataset_version
            for obj in res.items:
                self._load_item(kind, lang, obj.model_dump(), res.meta.fixture)

    def _load_item(self, kind: str, lang: str, item: dict, fixture: bool) -> None:
        owner = item["concept_id"] if kind == "glossary" else item["segment_id"]
        self.concepts[(lang, owner)] = item
        if kind == "glossary":
            sources = {l: [f["preferred"], *f["accepted"]] for l, f in item["sources"].items()}
        else:
            sources = {item["source"]["lang"]: [item["source"]["text"]]}
        used = {t["target_id"] for t in item["targets"] if t.get("target_id")}
        n = 0
        for t in item["targets"]:
            if not t.get("target_id"):
                n += 1
                while f"{owner}~t{n}" in used:
                    n += 1
                t["target_id"] = f"{owner}~t{n}"
            val = t.get("validation") or {}
            for sl, forms in sources.items():
                for k, form in enumerate(forms):
                    e = Entry(id=f"{lang}:{t['target_id']}|{sl}|{k}", concept_id=item.get("concept_id"), owner_id=owner, target_id=t["target_id"],
                              source_lang=sl, source_text=form, translation=t.get("preferred"), alternatives=list(t.get("accepted") or []),
                              contexts=list(t.get("contexts") or []), status=t["status"], version=t["version"], test_data=fixture,
                              target_lang=lang, validator_id=val.get("validator_id"), validated_at=val.get("validated_at"),
                              method=val.get("method"), form_kind="preferred" if k == 0 else "accepted")
                    self.entries[e.id] = e
                    self._index.setdefault((sl, lang, normalize(form)), []).append(e)
                    tpl = _build_template(e)
                    if tpl:
                        self._templates.setdefault((sl, lang), []).append(tpl)

    # ------------------------------------------------------------------ recherche
    @staticmethod
    def _resolve(pool: list[Entry], ctx: set[str]) -> tuple[Entry | None, bool]:
        distinct = {e.translation for e in pool}
        if len(distinct) == 1:
            return pool[0], False
        matching = [e for e in pool if e.contexts and set(e.contexts) & ctx]
        if matching and len({e.translation for e in matching}) == 1:
            return matching[0], False
        generic = [e for e in pool if not e.contexts]
        if not matching and generic and len({e.translation for e in generic}) == 1:
            return generic[0], False
        return None, True

    def lookup(self, masked_text: str, source: str, target: str, ctx_tags: set[str]) -> Lookup:
        """Recherche exacte (formulation normalisée) dans la langue SOURCE donnée uniquement ;
        à défaut, appariement à gabarit des phrases à variables de la mémoire."""
        cands = self._index.get((source, target, normalize(masked_text)), [])
        res = self._lookup_pool(cands, ctx_tags)
        if res.entry is not None or res.reason or not self._templates.get((source, target)):
            return res
        return self._lookup_template(masked_text, source, target, ctx_tags)

    def _lookup_pool(self, cands: list[Entry], ctx_tags: set[str]) -> Lookup:
        for tier in ("approved", "pending_validation"):
            pool = [e for e in cands if e.status == tier and e.translation]
            if pool:
                entry, ambiguous = self._resolve(pool, ctx_tags)
                return Lookup(entry, "ambiguous_context" if ambiguous else None, tier)
        rejected = [e for e in cands if e.status == "rejected"]
        return Lookup(rejected[0], None, "rejected") if rejected else Lookup()

    def _lookup_template(self, masked_text: str, source: str, target: str, ctx_tags: set[str]) -> Lookup:
        canon = _canon(masked_text)
        hits: list[tuple[_Template, dict[int, str]]] = []
        for tpl in self._templates[(source, target)]:
            got = tpl.match(canon)
            if got is not None:
                hits.append((tpl, got))
        if not hits:
            return Lookup()
        best = max(t.literal_len for t, _ in hits)  # le gabarit le plus spécifique l'emporte
        hits = [(t, g) for t, g in hits if t.literal_len == best]
        by_entry = {id(t.entry): (t, g) for t, g in hits}
        res = self._lookup_pool([t.entry for t, _ in hits], ctx_tags)
        if res.entry is None:
            return res
        tpl, captured = by_entry[id(res.entry)]
        res.rendered = tpl.render(res.entry.translation, captured)
        res.rendered_alternatives = [tpl.render(a, captured) for a in res.entry.alternatives]
        return res

    def find_by_form(self, text: str, lang: str, target: str | None = None) -> list[Entry]:
        return [e for (sl, tl, key), es in self._index.items() if sl == lang and key == normalize(text) and (not target or tl == target) for e in es]

    def find_by_concept(self, concept_id: str, target: str | None = None) -> list[Entry]:
        return [e for e in self.entries.values() if e.concept_id == concept_id and (not target or e.target_lang == target)]

    def find_terms(self, text: str, source: str, target: str, limit: int = 12) -> list[tuple[str, str]]:
        """Termes APPROUVÉS présents dans `text` — contraintes pour les fournisseurs IA."""
        low = normalize(text)
        found = []
        for (s, t, key), entries in self._index.items():
            if s == source and t == target and len(key) > 2 and key in low:
                for e in entries:
                    if e.usable:
                        found.append((e.source_text, e.translation)); break
        return sorted(found, key=lambda p: -len(p[0]))[:limit]

    def list(self, *, target: str | None = None, source: str | None = None, status: str | None = None,
             concept_id: str | None = None, q: str | None = None, limit: int = 500, offset: int = 0) -> tuple[int, list[Entry]]:
        status = {"validated": "approved"}.get(status, status)
        nq = normalize(q) if q else None
        items = [e for e in self.entries.values()
                 if (not target or e.target_lang == target) and (not source or e.source_lang == source)
                 and (not status or e.status == status) and (not concept_id or e.concept_id == concept_id)
                 and (not nq or nq in normalize(e.source_text))]
        return len(items), items[offset: offset + limit]

    def stats(self) -> dict[str, dict[str, int]]:
        """Comptage par CIBLE (pas par forme source) : {langue: {statut: n}}."""
        out: dict[str, dict[str, int]] = {}
        seen: set[tuple[str, str]] = set()
        for e in self.entries.values():
            if (e.target_lang, e.target_id) in seen:
                continue
            seen.add((e.target_lang, e.target_id))
            d = out.setdefault(e.target_lang, {})
            d[e.status] = d.get(e.status, 0) + 1
        return out

    # ------------------------------------------------------------------ validation humaine (voie unique d'écriture)
    def validate(self, entry_id: str, decision: str, validator_id: str, translation: str | None, method: str) -> Entry:
        from ..referentiel.importer import _history_item, ensure_target_ids, normalize_doc
        from ..referentiel.store import ReferentielStore, now_iso
        from ..referentiel.validate import validate_document
        entry = self.entries.get(entry_id)
        if entry is None:
            raise KeyError(entry_id)
        if self.state_dir is None:
            raise RuntimeError("state_dir requis pour écrire")
        store = ReferentielStore(self.directory.parent, self.state_dir)
        kind = self.KIND[self.name]
        path = store.path_for(kind, entry.target_lang)
        doc = normalize_doc(kind, store.read(path))
        key, idf = ("concepts", "concept_id") if kind == "glossary" else ("segments", "segment_id")
        item = next(i for i in doc[key] if i[idf] == entry.owner_id)
        ensure_target_ids(entry.owner_id, item["targets"])
        tgt = next(t for t in item["targets"] if t.get("target_id") == entry.target_id)
        final = translation or tgt.get("preferred")
        if decision == "validate" and not final:
            raise ValueError("une traduction est requise pour valider cette entrée")
        tx = store.transaction(f"validate {entry.target_id}")
        now = now_iso()
        tgt["history"] = list(tgt.get("history") or []) + [_history_item(tgt, tx.import_id, now)]
        if decision == "validate":
            tgt.update(preferred=final, accepted=[a for a in tgt.get("accepted", []) if a != final], status="approved")
        else:
            tgt["status"] = "rejected"
        tgt["version"] += 1
        tgt["validation"] = {"validator_id": validator_id, "validated_at": now, "method": method, "comment": None}
        check = validate_document(doc, expected_type=kind, allow_fixture=True)
        if not check.ok:
            raise ValueError(f"validation refusée : {check.errors[0].message}")
        tx.stage(path, doc)
        tx.commit({"doc_type": kind, "language": entry.target_lang, "label": "validate", "updated": 1})
        self.reload()
        return next(e for e in self.entries.values() if e.target_id == entry.target_id)
