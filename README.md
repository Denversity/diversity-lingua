# Diversity Lingua

**Comprendre les services financiers numériques dans sa langue, sans quitter la page.**

Diversity Lingua est un prototype d’accessibilité linguistique pour les interfaces financières numériques. Il associe une extension Chrome (Manifest V3, TypeScript) à une API FastAPI et à des ressources de traduction français/anglais vers le fulfulde de l’Adamaoua. Une application Mobile Money fictive permet de présenter et de tester les parcours sans utiliser de compte ou de service financier réel.

## Présentation

L’utilisateur peut activer ou désactiver la traduction d’une page, choisir une langue disponible, consulter la fiabilité des traductions et demander une explication d’un terme sélectionné. Le panneau contextuel peut être déplacé et fermé. Les traductions approuvées du glossaire et de la mémoire peuvent aussi être utilisées hors ligne.

Le projet privilégie la préservation des contenus et l’absence d’invention :

- Une traduction issue du glossaire ou de la mémoire n’est présentée comme approuvée que si elle porte le statut `approved`.
- Une traduction automatique éventuelle garde un statut distinct et n’est pas assimilée à une validation linguistique.
- Une formulation sans traduction approuvée est laissée inchangée.
- Les données sensibles et les valeurs des champs ne sont pas traduites. Les nombres, références et autres contenus protégés sont masqués avant envoi et restaurés après vérification.
- L’extension modifie le texte ou certains attributs textuels nécessaires, pas le HTML de la page. Elle ne déclenche aucune opération financière.

## Fonctionnalités

- Traduction à la demande du texte visible, de libellés, de boutons, de menus, de notifications et de certains attributs textuels (`title`, `placeholder`, `aria-label`, `alt`).
- Détection de la langue source français/anglais, avec prise en compte du texte sélectionné et de l’attribut `lang`.
- Glossaire, mémoire de traduction, variantes et statuts de validation explicites.
- Appariement de phrases contenant des variables (montants, références et noms selon les règles de gabarit), avec préservation des valeurs.
- Mode **Comprendre** : explication de termes sélectionnés et périphrases descriptives Fulfulde disponibles dans les ressources du projet.
- Signalement de problèmes linguistiques et retour à la page d’origine.
- Prise en charge de contenus ajoutés dynamiquement et protections contre les boucles de réécriture.
- Démonstration avec des données entièrement fictives.

La couverture linguistique est volontairement partielle : les textes absents des ressources sont conservés dans leur langue d’origine. Ce prototype ne garantit pas la traduction d’un site financier tiers.


## Prérequis

- Python **3.11 ou supérieur**
- Node.js **18 ou supérieur** et npm
- Google Chrome **110 ou supérieur** pour utiliser l’extension
- PowerShell sous Windows ou Bash sous Linux/macOS

Chrome ou Chromium est nécessaire uniquement pour les tests navigateur optionnels. Sous Windows, indiquez le chemin de l’exécutable Chrome dans `CHROME_PATH`. Docker est fourni à titre expérimental; il n’a pas été validé pour une livraison de production.

## Installation et lancement

### Windows (PowerShell)

Depuis le dossier du projet :

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\setup.ps1
```

La modification de stratégie ci-dessus ne concerne que la session PowerShell courante; elle ne change pas la stratégie permanente du système. Le script crée un environnement Python local et installe les dépendances du backend. **Il ne reconstruit pas l’extension** : le dossier précompilé `extension\dist` est inclus dans le projet et prêt à charger. Node.js n’est donc pas nécessaire pour une installation standard.

Ne copiez pas le dossier `.venv` d’un ordinateur à un autre : les environnements virtuels Python sous Windows contiennent des chemins propres à la machine. Si le ZIP contient déjà `.venv`, supprimez ce dossier sur le PC de destination avant l’installation. Le script crée alors un environnement local neuf. Il n’est pas nécessaire d’activer l’environnement manuellement.

Pour supprimer l’environnement copié à la racine du projet, depuis cette racine :

```powershell
Remove-Item -LiteralPath .venv -Recurse -Force
```

Cette commande supprime uniquement l’environnement virtuel local du projet. Rouvrez ensuite un terminal VS Code si celui-ci affichait encore l’ancien préfixe `(.venv)`.

Dans une première fenêtre PowerShell (répétez la commande de stratégie si vous venez d’ouvrir cette fenêtre), démarrez l’API :

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\run_backend.ps1
```

Si les scripts restent bloqués par une stratégie d’organisation, on peut lancer l’API sans exécuter le fichier `.ps1` :

```powershell
Set-Location backend
& ..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Dans Chrome :

1. Ouvrez `chrome://extensions` et activez le **mode développeur**.
2. Cliquez **Charger l’extension non empaquetée** et sélectionnez `extension\dist`.
3. Ouvrez le site de demo Safinum Pay.
4. Depuis l’icône Diversity Lingua, activez la traduction et choisissez **Fulfulde**. Pour vérifier le parcours de démonstration isolé, sélectionnez **Langue de test** en environnement de développement.

L’API est disponible à `http://127.0.0.1:8000`; sa documentation interactive est sur `http://127.0.0.1:8000/docs`. Gardez la fenêtre du backend ouverte pendant la démonstration. Après une reconstruction de l’extension, cliquez sur **Recharger** dans `chrome://extensions`.

### Linux et macOS (Bash)

```bash
bash scripts/setup.sh
bash scripts/run_backend.sh
```

Le script d’installation n’a besoin ni de Node.js ni d’un nouveau build. Chargez `extension/dist` dans Chrome via `chrome://extensions`, puis visitez `http://127.0.0.1:8000/demo/`.

## Procédure de démonstration

1. Démarrez le backend et ouvrez `/demo/`; cette application est un simulateur, pas un service financier.
2. Activez l’extension et choisissez **Fulfulde** pour voir les traductions approuvées disponibles.
3. Vérifiez que le solde fictif, le numéro de téléphone et les codes d’accès fictifs restent inchangés.
4. Sélectionnez un terme et utilisez **Comprendre** pour consulter son explication, lorsqu’elle existe.
5. Essayez d’ajouter du contenu dynamique dans la démo, puis constatez la mise à jour de la traduction.
6. Déplacez ou fermez le panneau contextuel.
7. Désactivez la traduction et vérifiez que le texte original est restauré.
8. Choisissez **Langue de test** uniquement pour illustrer les états de fiabilité; ses traductions sont des fixtures techniques et non du contenu linguistique.

N’utilisez pas de vraies données de compte, de PIN, de bénéficiaire ou de transaction pendant une démonstration.

## Ressources linguistiques et validation

La langue cible configurée est `ff`, variété `adamawa`; les langues sources sont `fr` et `en`.

- Le glossaire livré contient **146 concepts** structurés à partir de 149 formulations sources. Trois variantes ambiguës restent `pending_validation` et ne sont pas proposées comme traductions approuvées.
- La mémoire contient **234 segments approuvés**, représentant 117 phrases en français et en anglais, dont certaines comportent des variables.
- **148 périphrases descriptives Fulfulde** sont disponibles pour le mode Comprendre.
- La traduction du projet pour `Retour` / `Back` est `ɓaawo`. Cette correction est conservée dans la mémoire active avec son historique; les livrables de référence d’origine restent intacts.
- Le fichier actif du glossaire conserve également des entrées vides provenant du gabarit initial. Elles ne constituent pas des traductions et ne doivent pas être confondues avec les trois variantes réelles en attente.
- La variété et les ressources viennent du travail linguistique livré. L’équipe technique n’a pas effectué une nouvelle validation par locuteur natif; l’orthographe et le code ISO 639-3 éventuel restent à confirmer par un spécialiste.

Les données actives se trouvent sous `data/`. Les fichiers livrés en référence, conservés sans modification et utilisés par les tests de comparaison, sont dans [`data/references/linguistic-delivery/`](data/references/linguistic-delivery/). Les modèles JSON vides sont dans [`schemas/examples/`](schemas/examples/). Les schémas sont générés depuis les modèles Pydantic de `backend/app/referentiel/models.py`.

### Mettre à jour un livrable linguistique

Les commandes suivantes s’exécutent depuis PowerShell à la racine du projet. Elles valident d’abord les fichiers et simulent l’import avant toute écriture. Remplacez les chemins par ceux des nouveaux livrables.

```powershell
Push-Location backend
& ..\.venv\Scripts\python.exe -m app.referentiel validate ..\chemin\glossaire.json
& ..\.venv\Scripts\python.exe -m app.referentiel import ..\chemin\glossaire.json --dry-run --language ff --report ..\backend\state\glossary-dry-run.json
```

Examinez le rapport. Si les changements attendus sont corrects, relancez l’import sans `--dry-run`, puis répétez la validation et l’import pour la mémoire si elle a changé :

```powershell
& ..\.venv\Scripts\python.exe -m app.referentiel import ..\chemin\glossaire.json --language ff --report ..\backend\state\glossary-import.json
Pop-Location
```

Après l’import, lancez les tests d’intégration concernés, reconstruisez l’instantané local et l’extension, puis rechargez l’extension dans Chrome :

```powershell
& .\.venv\Scripts\python.exe scripts\export_schemas.py --check
Push-Location backend
& ..\.venv\Scripts\python.exe -m pytest -q tests\test_integration_resources.py tests\test_export_snapshot.py
Pop-Location
& .\.venv\Scripts\python.exe scripts\export_glossary.py
Push-Location extension
npm run build
Pop-Location
```

L’importateur conserve l’historique et les versions précédentes. Un import peut être annulé via `python -m app.referentiel rollback <import_id>` depuis `backend/`. Ne passez jamais une entrée en `approved` sans validation humaine documentée.

## Tests et build

### Suite de tests

Sous Windows, depuis la racine du projet :

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\run_tests.ps1
```

Ce script vérifie les schémas, exécute les tests backend, vérifie les types TypeScript et lance les tests de l’extension. Il est également possible de lancer ces contrôles séparément :

```powershell
& .\.venv\Scripts\python.exe scripts\export_schemas.py --check
Push-Location backend
& ..\.venv\Scripts\python.exe -m pytest -q
Pop-Location
Push-Location extension
npm run typecheck
npm test
npm run build
Pop-Location
```

Sous Linux/macOS, `bash scripts/run_tests.sh` exécute la suite backend et extension ainsi que le test de contrat avec l’API. Pour les contrôles visuels optionnels, indiquez un navigateur via `CHROME_PATH` ou installez la dépendance Chromium optionnelle, puis définissez `RUN_BROWSER=1`. Sous PowerShell :

```powershell
$env:RUN_BROWSER = "1"
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
.\scripts\run_tests.ps1
```

Les captures de test sont écrites dans `extension/test-results/` et ne sont pas des ressources nécessaires à l’exécution.

### Build de production de l’extension

Le build de développement comprend la langue fictive `xx-test`. Pour produire un build sans cette fixture sous Windows :

```powershell
& .\.venv\Scripts\python.exe scripts\export_glossary.py
Push-Location extension
npm run build
Pop-Location
```

Ou relancez l’installation avec le commutateur `.\scripts\setup.ps1 -BuildExtension`. Ces opérations exigent Node.js et npm. Sous Bash, utilisez `BUILD_EXTENSION=1 bash scripts/setup.sh`. Le build de production du backend doit également désactiver les données de test (`DL_ENV=prod` et `DL_ALLOW_TEST_DATA=false`). Un fournisseur automatique externe n’est pas requis pour les traductions présentes dans la mémoire et le glossaire.

## Configuration

Copiez `.env.example` vers `backend\.env` si vous souhaitez modifier la configuration du backend lancé par `scripts\run_backend.ps1` :

```powershell
Copy-Item .env.example backend\.env
```

Les valeurs par défaut conviennent au développement local. Ne commitez jamais ce fichier, une clé API ou un jeton. Docker Compose, s’il est utilisé, lit un fichier `.env` à la racine.

Variables principales :

| Variable | Rôle |
|---|---|
| `DL_ENV` | `dev` ou `prod`; le mode production désactive les fixtures de test. |
| `DL_ALLOW_TEST_DATA` | Autorise la langue fictive et la démo; désactiver en production. |
| `DL_PROVIDER_ORDER` | Ordre de consultation, par défaut mémoire puis glossaire avant les moteurs. |
| `DL_API_TOKEN` | Protège l’API; le même jeton doit être configuré dans l’extension si activé. |
| `DL_ADMIN_TOKEN` | Autorise les opérations administratives de validation et de rechargement du référentiel. |
| `DL_ALLOW_MACHINE_TRANSLATION` | Autorise ou non les fournisseurs automatiques configurés. |
| `DL_SHOW_PENDING` | Contrôle l’inclusion explicite de propositions humaines en attente; elles ne sont pas des traductions approuvées. |
| `DL_OPENAI_*`, `DL_ANTHROPIC_*` | Paramètres facultatifs de fournisseurs compatibles OpenAI ou Anthropic. |
| `DL_NLLB_MODEL` | Modèle local optionnel; vérifier la licence du modèle avant usage. |

Les clés des fournisseurs sont conservées côté backend et ne sont pas envoyées par l’extension. Les fournisseurs non configurés sont ignorés. Pour un déploiement public, utiliser HTTPS, protéger l’API et ses secrets, et désactiver toutes les données de test.

## API

Préfixe : `/api/v1`. Les principaux endpoints sont :

| Méthode | Route | Fonction |
|---|---|---|
| `POST` | `/translate` | Traduit une liste de segments. |
| `POST` | `/explain` | Recherche une explication et la traduction éventuelle d’un terme. |
| `GET` | `/languages` | Liste les langues et leur disponibilité. |
| `GET` | `/providers` | Indique les moteurs configurés, sans révéler de secrets. |
| `GET` | `/glossary` et `/glossary/lookup` | Consulte et recherche les entrées du glossaire. |
| `POST` | `/feedback` | Enregistre un signalement pour revue; il n’est pas appliqué automatiquement. |
| `GET` | `/health` | Vérifie l’état de l’API et du référentiel. |

Un jeton API, s’il est configuré, est transmis dans `X-DL-Token`. Les interfaces OpenAPI et Swagger sont servies par FastAPI sur `/docs`.

## Structure du projet

```text
backend/      API FastAPI, fournisseurs, services, importateur et tests Python
extension/    Extension Chrome Manifest V3, interface, tests et build
data/         Langues, glossaire, mémoire, corpus et explications Fulfulde
data/references/linguistic-delivery/
              Livrables linguistiques de référence conservés sans modification
schemas/      Schémas JSON publiés et exemples de documents
shared/       Vecteurs de test communs entre Python et TypeScript
demo/         Application de démonstration financière fictive
scripts/      Installation, build, exécution, tests et génération des ressources
```

`extension/dist/` est le build précompilé inclus pour permettre l’installation sans Node.js ni recompilation. `node_modules/`, les environnements virtuels, l’état local du backend et les résultats de tests sont locaux ou régénérables et ne doivent pas être transmis. Chaque coéquipier doit créer son propre `.venv` avec `.\scripts\setup.ps1`.

Pour préparer une archive à transmettre, incluez le dossier `extension/dist/`, mais excluez `.venv/`, `extension/node_modules/`, `backend/state/`, `extension/test-results/`, les fichiers `.env` et le dossier `.git/`. Un dépôt GitHub inclut également `extension/dist/` afin qu’un téléchargement ou un clonage permette de charger l’extension sans la reconstruire.

## Limites de validation

La suite automatise le contrat des données, les services backend, l’extension, les traductions de référence et certains parcours navigateur. Elle ne remplace pas un essai manuel de l’extension dans Chrome ni une validation linguistique. L’intégration au site Safinum Pay, les fournisseurs IA réels, Docker et l’accessibilité avec technologies d’assistance doivent être vérifiés séparément avant tout usage en conditions réelles.
