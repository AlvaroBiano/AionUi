import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWorkspace } from './WorkspaceContext';

const STORAGE_KEY_PREFIX = 'files_tabs:';

function storageKeyFor(workspace: string | null): string {
  return STORAGE_KEY_PREFIX + (workspace ?? '__none__');
}

export type FileTab = {
  path: string;
  title: string;
  isDirty: boolean;
};

type FilesTabContextType = {
  tabs: FileTab[];
  activeTabIndex: number;
  openTab: (path: string) => void;
  closeTab: (index: number) => void;
  switchTab: (index: number) => void;
  closeAllTabs: () => void;
};

const FilesTabContext = createContext<FilesTabContextType | null>(null);

export function useFilesTab() {
  const context = useContext(FilesTabContext);
  if (!context) {
    throw new Error('useFilesTab must be used within a FilesTabProvider');
  }
  return context;
}

export function useFilesTabOptional() {
  return useContext(FilesTabContext);
}

export function FilesTabProvider({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const { currentWorkspace } = useWorkspace();

  // Refs to access current values in the workspace-switch effect without stale closures
  const tabsRef = useRef(tabs);
  const activeTabIndexRef = useRef(activeTabIndex);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);
  useEffect(() => {
    activeTabIndexRef.current = activeTabIndex;
  }, [activeTabIndex]);

  // Track previous workspace (undefined = not yet initialized)
  const previousWorkspaceRef = useRef<string | null | undefined>(undefined);

  // Save/load tabs when workspace changes
  useEffect(() => {
    const prevWorkspace = previousWorkspaceRef.current;
    const newWorkspace = currentWorkspace;
    if (prevWorkspace === newWorkspace) return;

    const run = async () => {
      // Save current tabs for previous workspace
      if (prevWorkspace !== undefined) {
        const prevKey = storageKeyFor(prevWorkspace);
        await AsyncStorage.setItem(
          prevKey,
          JSON.stringify({
            tabs: tabsRef.current,
            activeTabIndex: activeTabIndexRef.current,
          }),
        ).catch(() => {});
      }

      // Load tabs for new workspace
      const newKey = storageKeyFor(newWorkspace);
      try {
        const value = await AsyncStorage.getItem(newKey);
        if (value) {
          const parsed = JSON.parse(value);
          if (parsed.tabs && Array.isArray(parsed.tabs)) {
            setTabs(parsed.tabs.map((t: FileTab) => ({ ...t, isDirty: false })));
            setActiveTabIndex(parsed.activeTabIndex ?? 0);
          } else {
            setTabs([]);
            setActiveTabIndex(0);
          }
        } else {
          setTabs([]);
          setActiveTabIndex(0);
        }
      } catch {
        setTabs([]);
        setActiveTabIndex(0);
      }

      previousWorkspaceRef.current = newWorkspace;
      setIsLoaded(true);
    };
    void run();
  }, [currentWorkspace]);

  // Persist tabs on changes within the current workspace
  useEffect(() => {
    if (!isLoaded) return;
    const key = storageKeyFor(currentWorkspace);
    AsyncStorage.setItem(key, JSON.stringify({ tabs, activeTabIndex })).catch(() => {});
  }, [tabs, activeTabIndex, isLoaded, currentWorkspace]);

  // Clean up legacy global key
  useEffect(() => {
    AsyncStorage.removeItem('files_tabs_state').catch(() => {});
  }, []);

  const openTab = useCallback(
    (path: string) => {
      const existingIndex = tabs.findIndex((t) => t.path === path);
      if (existingIndex !== -1) {
        setActiveTabIndex(existingIndex);
      } else {
        const title = path.split('/').pop() || path;
        setTabs((prev) => [...prev, { path, title, isDirty: false }]);
        setActiveTabIndex(tabs.length);
      }
    },
    [tabs],
  );

  const closeTab = useCallback(
    (index: number) => {
      if (index < 0 || index >= tabs.length) return;

      setTabs((prev) => {
        const newTabs = [...prev];
        newTabs.splice(index, 1);
        return newTabs;
      });

      setActiveTabIndex((prev) => {
        if (tabs.length <= 1) return 0;
        if (index < prev) return prev - 1;
        if (index === prev) return Math.min(prev, tabs.length - 2);
        return prev;
      });
    },
    [tabs.length],
  );

  const switchTab = useCallback(
    (index: number) => {
      if (index >= 0 && index < tabs.length) {
        setActiveTabIndex(index);
      }
    },
    [tabs.length],
  );

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActiveTabIndex(0);
  }, []);

  return (
    <FilesTabContext.Provider
      value={{
        tabs,
        activeTabIndex,
        openTab,
        closeTab,
        switchTab,
        closeAllTabs,
      }}
    >
      {children}
    </FilesTabContext.Provider>
  );
}
