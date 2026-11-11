# Mémoire de traduction

Fichiers `<langue>.json` au même format que les glossaires (`data/glossary/`), mais au niveau
phrase/segment (ex. « Vous avez reçu {{P0}} de {{P1}} »). Les jetons `{{Pn}}` représentent les
montants/numéros protégés. Seules les entrées `status: "validated"` sont utilisées.

La mémoire n'est JAMAIS alimentée automatiquement par des sorties de traduction automatique
(pour ne pas « blanchir » du texte non validé en texte validé).
