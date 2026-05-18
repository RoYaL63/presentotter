export interface Bookmark {
  frameIndex: number
  timestamp: number
  label?: string
}

/**
 * Petit utilitaire de suivi des bookmarks utilisateur pendant une capture.
 * Maintient l'ordre d'insertion.
 */
export class BookmarkTracker {
  private readonly bookmarks: Bookmark[] = []

  add(frameIndex: number, label?: string): void {
    const entry: Bookmark =
      label === undefined
        ? { frameIndex, timestamp: Date.now() }
        : { frameIndex, timestamp: Date.now(), label }
    this.bookmarks.push(entry)
  }

  getAll(): Bookmark[] {
    // Copie défensive pour éviter les mutations externes.
    return this.bookmarks.map(b => ({ ...b }))
  }

  clear(): void {
    this.bookmarks.length = 0
  }

  size(): number {
    return this.bookmarks.length
  }
}
