# Ressources linguistiques Diversity Lingua — SAFINUM Pay

## Fichiers
- `safinum_glossary_v1.json` : glossaire au contrat Diversity Lingua v1.0.0.
- `safinum_translation_memory_v1.json` : mémoire de traduction bilingue FR/EN → Fulfulde Adamawa, au contrat v1.0.0.
- `audit_manifest.json` : comptage et contrôles de cohérence.
- `dryrun_glossary_report.json` / `dryrun_memory_report.json` : rapports de simulation d'import.

## Transformation réalisée
- 149 lignes du glossaire source → 146 concepts structurés. Les formulations FR/EN identiques ont été regroupées.
- 117 phrases → 234 segments de mémoire (une entrée française et une entrée anglaise par phrase).
- Les traductions Fulfulde de l'expert ont été conservées ; aucune traduction n'a été inventée ou corrigée par l'équipe technique.
- Les espaces périphériques ont été nettoyés.
- Les variables `{nom}` et équivalentes ont été converties vers les jetons techniques `{{P0}}` attendus par le projet. La valeur réelle doit être réinjectée par le moteur après traduction.
- Les statuts validés par l'expert ont été mappés vers `approved` avec la provenance et la date du 2026-11-06.

Les deux fichiers livrés demeurent des références archivées intactes. Depuis leur intégration, une correction projet distincte a été demandée pour `Retour` / `Back` : la mémoire active utilise `ɓaawo` en version 3 et conserve `Caggal` (expert) et `baawo` (décision projet antérieure) dans l'historique. Cette décision n'est pas une nouvelle traduction issue des fichiers livrés ; elle doit être revue lors du prochain contrôle linguistique.

## Arbitrages linguistiques encore nécessaires
Trois paires de lignes du glossaire utilisent la même formulation anglaise (et des sources FR proches/identiques) mais des traductions Fulfulde différentes :
- `merchant payment` : `FIN-0036` / `FIN-0122`.
- `transaction` : `FIN-0045` / `FIN-0143`.
- `summary` / `récapitulatif` : `FIN-0116` / `FIN-0139`.

Pour éviter de choisir arbitrairement une traduction, une cible de chaque paire est conservée en `pending_validation`. Les trois conflits sont conservés dans le JSON avec leurs IDs et notes. Demander à l'expert de confirmer s'il s'agit de variantes acceptées, de contextes distincts ou d'une traduction à retenir. Après arbitrage, incrémenter la version de la cible concernée et remettre `approved` uniquement après confirmation.

## Contrôles effectués
- Validation du schéma v1.0.0 : glossaire VALIDE, 0 erreur / 0 avertissement.
- Validation du schéma v1.0.0 : mémoire VALIDE, 0 erreur / 0 avertissement.
- Simulation d'import strict : glossaire accepté (146 concepts, 146 ajoutés, 3 cibles pending_validation), mémoire acceptée (234 segments approuvés).
- Contrôle des variables : les jetons source FR/EN et cible correspondent sur les 117 phrases.

## Importer dans une copie locale du projet
Copier les deux JSON dans un emplacement temporaire, puis depuis `backend/` :

```powershell
python -m app.referentiel validate C:\chemin\safinum_glossary_v1.json
python -m app.referentiel validate C:\chemin\safinum_translation_memory_v1.json
python -m app.referentiel import C:\chemin\safinum_glossary_v1.json --dry-run --language ff --report glossary-dryrun.json
python -m app.referentiel import C:\chemin\safinum_translation_memory_v1.json --dry-run --language ff --report memory-dryrun.json
```

Si les rapports sont corrects, importer sans `--dry-run` :

```powershell
python -m app.referentiel import C:\chemin\safinum_glossary_v1.json --language ff --report glossary-import.json
python -m app.referentiel import C:\chemin\safinum_translation_memory_v1.json --language ff --report memory-import.json
```

Puis redémarrer le backend (ou utiliser l'endpoint admin de reload) et reconstruire l'extension :

```powershell
cd ..\extension
npm ci
npm run typecheck
npm test
npm run build
```

Ne pas importer dans le dépôt principal avant d'avoir sauvegardé `data/` et `backend/state/`. Ne pas activer un moteur automatique pour les tests initiaux : commencer par mesurer la couverture réelle de la mémoire et du glossaire approuvés.
