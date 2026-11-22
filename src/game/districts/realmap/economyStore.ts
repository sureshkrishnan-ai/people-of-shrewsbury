import { create } from 'zustand'

/** The economy layer: buildings coloured by business category, beacons over listed businesses, area summary. */
export const useEconomy = create<{ on: boolean; toggle: () => void; set: (on: boolean) => void }>((set) => ({
  on: false,
  toggle: () => set((s) => ({ on: !s.on })),
  set: (on) => set({ on }),
}))
