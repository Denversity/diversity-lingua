-- Schéma CIBLE (PostgreSQL) pour la base linguistique centralisée de la finale.
-- NON utilisé par le MVP (le glossaire vient de fichiers JSON versionnés, data/glossary/*.json).
-- Le format JSON des entrées correspond champ à champ aux tables ci-dessous pour permettre une migration directe.
CREATE TABLE languages (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, native_name TEXT, iso639_3 TEXT, script TEXT NOT NULL DEFAULT 'Latn',
  orthography TEXT, availability TEXT NOT NULL CHECK (availability IN ('awaiting_validation','partial','available','test_only','disabled')),
  machine_translation TEXT NOT NULL DEFAULT 'allowed', low_resource BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE language_varieties (
  id SERIAL PRIMARY KEY, language_code TEXT REFERENCES languages(code), name TEXT NOT NULL, region TEXT, notes TEXT
);
CREATE TABLE financial_contexts (code TEXT PRIMARY KEY, label_fr TEXT NOT NULL, label_en TEXT);  -- transfer, fees, balance, error, security…
CREATE TABLE source_expressions (
  id SERIAL PRIMARY KEY, source_lang TEXT NOT NULL, text TEXT NOT NULL, normalized TEXT NOT NULL, concept_id TEXT,
  UNIQUE (source_lang, normalized)
);
CREATE TABLE expression_contexts (expression_id INT REFERENCES source_expressions(id), context_code TEXT REFERENCES financial_contexts(code), PRIMARY KEY (expression_id, context_code));
CREATE TABLE validators (id TEXT PRIMARY KEY, display_name TEXT, language_code TEXT REFERENCES languages(code), role TEXT NOT NULL, active BOOLEAN DEFAULT TRUE);
CREATE TABLE translations (
  id TEXT PRIMARY KEY, expression_id INT NOT NULL REFERENCES source_expressions(id), target_lang TEXT NOT NULL REFERENCES languages(code),
  variety_id INT REFERENCES language_varieties(id), text TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending_validation','validated','rejected','deprecated')),
  version INT NOT NULL DEFAULT 1, is_test_data BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE translation_versions (
  translation_id TEXT REFERENCES translations(id), version INT, text TEXT, status TEXT, validator_id TEXT REFERENCES validators(id),
  method TEXT, at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (translation_id, version)
);
CREATE TABLE feedback (
  id SERIAL PRIMARY KEY, source_lang TEXT, target_lang TEXT, source_text TEXT, shown_translation TEXT, suggested_translation TEXT,
  comment TEXT, status TEXT NOT NULL DEFAULT 'pending_review', reviewed_by TEXT REFERENCES validators(id), at TIMESTAMPTZ DEFAULT now()
);
-- Règle métier : un texte produit par un moteur automatique n'est JAMAIS inséré avec status='validated'.
