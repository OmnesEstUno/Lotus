import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Modal from '../components/Modal';
import DataEntry from '../pages/DataEntry';

interface DataEntryContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  onSubmitted: (fn: () => void) => () => void;
}

const DataEntryContext = createContext<DataEntryContextValue | null>(null);

export function useDataEntry(): DataEntryContextValue {
  const ctx = useContext(DataEntryContext);
  if (!ctx) throw new Error('useDataEntry must be used within DataEntryProvider');
  return ctx;
}

interface DataEntryProviderProps {
  children: ReactNode;
}

export function DataEntryProvider({ children }: DataEntryProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const submittedListeners = useRef<Set<() => void>>(new Set());

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    setHasPending(false);
  }, []);

  const onSubmitted = useCallback((fn: () => void) => {
    submittedListeners.current.add(fn);
    return () => { submittedListeners.current.delete(fn); };
  }, []);

  const notifySubmitted = useCallback(() => {
    submittedListeners.current.forEach((fn) => fn());
  }, []);

  const handleClose = useCallback(() => {
    if (hasPending && !window.confirm('Discard pending changes?')) return;
    close();
  }, [hasPending, close]);

  const handleBackdropClose = useCallback(() => {
    if (hasPending) return;
    close();
  }, [hasPending, close]);

  const handleRequestClose = useCallback(() => {
    close();
    notifySubmitted();
  }, [close, notifySubmitted]);

  const value: DataEntryContextValue = { isOpen, open, close, onSubmitted };

  return (
    <DataEntryContext.Provider value={value}>
      {children}
      <Modal
        open={isOpen}
        onClose={handleClose}
        onBackdropClose={handleBackdropClose}
      >
        <DataEntry
          onRequestClose={handleRequestClose}
          onPendingChange={setHasPending}
        />
      </Modal>
    </DataEntryContext.Provider>
  );
}
