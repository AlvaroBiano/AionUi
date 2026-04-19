/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useCallback, useContext, useState } from 'react';

type HeaderSettingsSections = {
  modelNode?: React.ReactNode;
  permissionNode?: React.ReactNode;
  configNode?: React.ReactNode;
};

type HeaderSettingsContextValue = {
  sections: HeaderSettingsSections;
  setSections: (sections: HeaderSettingsSections) => void;
};

const HeaderSettingsContext = createContext<HeaderSettingsContextValue>({
  sections: {},
  setSections: () => {},
});

export const HeaderSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sections, setSectionsState] = useState<HeaderSettingsSections>({});

  const setSections = useCallback((next: HeaderSettingsSections) => {
    setSectionsState(next);
  }, []);

  return <HeaderSettingsContext.Provider value={{ sections, setSections }}>{children}</HeaderSettingsContext.Provider>;
};

export const useHeaderSettings = () => useContext(HeaderSettingsContext);
