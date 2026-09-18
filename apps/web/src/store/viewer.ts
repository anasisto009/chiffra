import { create } from "zustand";

type ViewerState = {
  documentId: string | null;
  openDocument: (documentId: string) => void;
  closeDocument: () => void;
};

export const useViewerStore = create<ViewerState>((set) => ({
  documentId: null,
  openDocument: (documentId) => set({ documentId }),
  closeDocument: () => set({ documentId: null })
}));
