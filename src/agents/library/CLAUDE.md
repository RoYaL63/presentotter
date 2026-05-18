# Archive — Library Agent 📚

## Responsabilités

Gestion locale des enregistrements :
- Stockage SQLite (métadonnées)
- Fichiersvidéo (MP4, WebM, GIF)
- Thumbnails pour l'aperçu
- Tags et recherche
- Suppression et nettoyage
- Export/import

## Interfaces clés

```typescript
RecordingLibraryEntry {
  id, name, duration
  createdAt, updatedAt
  filePath, format, fileSize
  sanitized: boolean
  tags: string[]
  thumbnailPath?: string
}
```

## Events écoutés/émis

Écoutés :
- `export:complete` — Nouveau fichier export

Émis :
- `library:recording-deleted` — Suppression
- `library:recording-renamed` — Renommage
- `library:recording-tagged` — Ajout tags

## Implémentation

### src/agents/library/database.ts
SQLite (better-sqlite3) pour métadonnées.

### src/agents/library/storage.ts
Gestion fichiers (Move, Delete, Cleanup).

### src/agents/library/thumbnail-generator.ts
Génération thumbnails (1ère frame ou frame custom).

### src/agents/library/search.ts
Recherche et filtrage par tags/nom.

## Gate de validation

Pas de gate séparé — Validé dans G5 (E2E).

## Notes de développement

- DB path : `%APPDATA%/PresentOtter/library.db`
- Enregistrements path : `%APPDATA%/PresentOtter/recordings/`
- Cleanup : supprimer fichiers si métadonnée deleted
- Backup : export/import metadata JSON

## Tâches Phase 2

- [ ] Schema SQLite (recordings table)
- [ ] CRUD enregistrements
- [ ] Génération thumbnails
- [ ] Tags et recherche
- [ ] Suppression safe
- [ ] Tests unitaires DB
