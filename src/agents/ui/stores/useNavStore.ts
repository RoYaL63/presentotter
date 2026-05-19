import { create } from 'zustand'

export type PageName = 'home' | 'tools' | 'library' | 'settings'

export interface NavState {
  currentPage: PageName
  navigate: (page: PageName) => void
}

export const useNavStore = create<NavState>((set) => ({
  currentPage: 'home',
  navigate: (page) => set(() => ({ currentPage: page }))
}))
