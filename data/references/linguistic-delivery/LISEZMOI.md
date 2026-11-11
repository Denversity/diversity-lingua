# Ressources linguistiques livrées (archive de référence)

Fichiers fournis par l'équipe linguistique, adaptés au contrat de données v1.0.0, **tels que reçus** :

| Fichier | Rôle |
|---|---|
| `safinum_glossary_v1.json` | Glossaire : 146 concepts (149 entrées sources), cible Fulfulde de l'Adamaoua (`ff`) |
| `safinum_translation_memory_v1.json` | Mémoire de traduction : 117 phrases → 234 segments fr/en |
| `audit_manifest.json`, `README_INTEGRATION_FR.md` | Manifeste d'audit et notice d'intégration fournis avec les livrables |
| `livraison_dryrun_*_report.json` | Rapports de simulation fournis avec la livraison |
| `rapports_import/` | Rapports produits par **nos** exécutions du 2026-11-09 (simulation, import réel) ; `sonde_couverture_demo_fictive.json` = mesure sur la démo fictive (pas Safinum Pay) |

**Ne pas modifier ces fichiers.** Ils servent de référence aux tests (`backend/tests/test_integration_resources.py`
compare les ressources actives à ces références, avec une exception versionnée et explicitement documentée). Pour mettre à jour les ressources : voir la section « Ressources linguistiques et validation » du `README.md`.

Les ressources de référence restent archivées sans modification. Les données d'exécution peuvent toutefois comporter des corrections décidées pour le projet : elles sont versionnées dans `data/` et documentées dans le `README.md`. Au 2026-11-10, l'entrée mémoire `Retour` / `Back` utilise `ɓaawo` en version 3 ; les formes antérieures `Caggal` (expert) et `baawo` (décision projet) sont conservées dans son historique.
