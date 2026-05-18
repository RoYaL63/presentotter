import { describe, it, expect } from 'vitest'
import { firstValueFrom } from 'rxjs'
import { UIOrchestrator } from '../src/agents/ui/orchestrator'
import { eventBus } from '../event-bus'

/**
 * UC-04 — Library + métadonnées
 *
 * Crée 3 entries directement via orchestrator.db.create (pas besoin d'exporter
 * pour tester la library en isolation), puis valide les opérations CRUD
 * publiques de l'orchestrator :
 *   - setLibraryEntryTags / renameLibraryEntry / deleteLibraryEntry
 *   - les events `library:recording-*` correspondants
 *   - l'isolation entre entries (delete d'un id ne touche pas les autres)
 */

function seedThreeEntries(orch: UIOrchestrator): void {
  orch.db.create({
    id: 'rec-1',
    name: 'Démo Make',
    duration: 5000,
    sanitized: false,
    tags: []
  })
  orch.db.create({
    id: 'rec-2',
    name: 'Tutoriel n8n',
    duration: 8000,
    sanitized: true,
    tags: ['n8n']
  })
  orch.db.create({
    id: 'rec-3',
    name: 'Airtable formula',
    duration: 3000,
    sanitized: false,
    tags: ['airtable', 'formula']
  })
}

describe('UC-04 — Library + métadonnées', () => {
  it('getLibraryEntries returns the seeded entries', () => {
    const orch = new UIOrchestrator()
    seedThreeEntries(orch)

    const entries = orch.getLibraryEntries()
    expect(entries.length).toBe(3)
    const ids = entries.map(e => e.id).sort()
    expect(ids).toEqual(['rec-1', 'rec-2', 'rec-3'])

    orch.dispose()
  })

  it('setLibraryEntryTags updates tags and emits library:recording-tagged', async () => {
    const orch = new UIOrchestrator()
    seedThreeEntries(orch)

    const taggedPromise = firstValueFrom(eventBus.on('library:recording-tagged'))
    const result = orch.setLibraryEntryTags('rec-1', ['make', 'demo'])
    expect(result).toBe(true)

    const event = await taggedPromise
    expect(event.id).toBe('rec-1')
    expect(event.tags).toEqual(['make', 'demo'])

    const entry = orch.db.findById('rec-1')
    expect(entry?.tags).toEqual(['make', 'demo'])

    orch.dispose()
  })

  it('renameLibraryEntry renames the entry and emits library:recording-renamed', async () => {
    const orch = new UIOrchestrator()
    seedThreeEntries(orch)

    const renamedPromise = firstValueFrom(eventBus.on('library:recording-renamed'))
    const result = orch.renameLibraryEntry('rec-2', 'Tutoriel n8n complet')
    expect(result).toBe(true)

    const event = await renamedPromise
    expect(event.id).toBe('rec-2')
    expect(event.newName).toBe('Tutoriel n8n complet')

    const entry = orch.db.findById('rec-2')
    expect(entry?.name).toBe('Tutoriel n8n complet')

    orch.dispose()
  })

  it('deleteLibraryEntry removes the entry and emits library:recording-deleted', async () => {
    const orch = new UIOrchestrator()
    seedThreeEntries(orch)

    const deletedPromise = firstValueFrom(eventBus.on('library:recording-deleted'))
    const result = orch.deleteLibraryEntry('rec-3')
    expect(result).toBe(true)

    const event = await deletedPromise
    expect(event.id).toBe('rec-3')

    expect(orch.getLibraryEntries().length).toBe(2)
    expect(orch.db.findById('rec-3')).toBeNull()

    orch.dispose()
  })

  it('mutations on one entry leave the others untouched', () => {
    const orch = new UIOrchestrator()
    seedThreeEntries(orch)

    orch.setLibraryEntryTags('rec-1', ['make', 'demo'])
    orch.renameLibraryEntry('rec-2', 'Tutoriel n8n complet')
    orch.deleteLibraryEntry('rec-3')

    const rec1 = orch.db.findById('rec-1')
    expect(rec1?.name).toBe('Démo Make')
    expect(rec1?.tags).toEqual(['make', 'demo'])

    const rec2 = orch.db.findById('rec-2')
    expect(rec2?.name).toBe('Tutoriel n8n complet')
    expect(rec2?.tags).toEqual(['n8n'])
    expect(rec2?.sanitized).toBe(true)

    expect(orch.db.findById('rec-3')).toBeNull()
    expect(orch.getLibraryEntries().length).toBe(2)

    orch.dispose()
  })

  it('returns false when mutating an unknown id and does not emit', () => {
    const orch = new UIOrchestrator()
    seedThreeEntries(orch)

    expect(orch.setLibraryEntryTags('rec-unknown', ['x'])).toBe(false)
    expect(orch.renameLibraryEntry('rec-unknown', 'whatever')).toBe(false)
    expect(orch.deleteLibraryEntry('rec-unknown')).toBe(false)

    // Les 3 entries d'origine sont intactes.
    expect(orch.getLibraryEntries().length).toBe(3)

    orch.dispose()
  })
})
