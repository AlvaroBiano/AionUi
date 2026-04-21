/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  HeaderSettingsProvider,
  useHeaderSettings,
} from '../../../../src/renderer/hooks/context/HeaderSettingsContext';

const wrapper: React.FC<React.PropsWithChildren> = ({ children }) => (
  <HeaderSettingsProvider>{children}</HeaderSettingsProvider>
);

describe('HeaderSettingsContext', () => {
  describe('default values (without Provider)', () => {
    it('should return empty sections by default', () => {
      const { result } = renderHook(() => useHeaderSettings());
      expect(result.current.sections).toEqual({});
    });

    it('should provide a no-op setSections by default', () => {
      const { result } = renderHook(() => useHeaderSettings());
      // Calling the default no-op setSections should not throw
      expect(() => result.current.setSections({ modelNode: null })).not.toThrow();
    });
  });

  describe('Provider registers sections and Consumer reads them', () => {
    it('should start with empty sections inside Provider', () => {
      const { result } = renderHook(() => useHeaderSettings(), { wrapper });
      expect(result.current.sections).toEqual({});
    });

    it('should update sections when setSections is called', () => {
      const { result } = renderHook(() => useHeaderSettings(), { wrapper });

      const modelNode = React.createElement('div', null, 'Model');
      act(() => {
        result.current.setSections({ modelNode });
      });

      expect(result.current.sections.modelNode).toBe(modelNode);
      expect(result.current.sections.permissionNode).toBeUndefined();
      expect(result.current.sections.configNode).toBeUndefined();
    });

    it('should support setting multiple section nodes at once', () => {
      const { result } = renderHook(() => useHeaderSettings(), { wrapper });

      const modelNode = React.createElement('span', null, 'M');
      const permissionNode = React.createElement('span', null, 'P');
      const configNode = React.createElement('span', null, 'C');

      act(() => {
        result.current.setSections({ modelNode, permissionNode, configNode });
      });

      expect(result.current.sections.modelNode).toBe(modelNode);
      expect(result.current.sections.permissionNode).toBe(permissionNode);
      expect(result.current.sections.configNode).toBe(configNode);
    });

    it('should replace all sections on subsequent setSections call', () => {
      const { result } = renderHook(() => useHeaderSettings(), { wrapper });

      const first = React.createElement('div', null, 'First');
      const second = React.createElement('div', null, 'Second');

      act(() => {
        result.current.setSections({ modelNode: first, permissionNode: first });
      });
      expect(result.current.sections.modelNode).toBe(first);
      expect(result.current.sections.permissionNode).toBe(first);

      // Replace with new sections — permissionNode should be gone
      act(() => {
        result.current.setSections({ modelNode: second });
      });
      expect(result.current.sections.modelNode).toBe(second);
      expect(result.current.sections.permissionNode).toBeUndefined();
    });
  });

  describe('cleanup and edge cases', () => {
    it('should clear all sections when setSections is called with empty object', () => {
      const { result } = renderHook(() => useHeaderSettings(), { wrapper });

      act(() => {
        result.current.setSections({
          modelNode: React.createElement('div'),
          configNode: React.createElement('div'),
        });
      });
      expect(result.current.sections.modelNode).toBeDefined();

      act(() => {
        result.current.setSections({});
      });
      expect(result.current.sections).toEqual({});
    });

    it('should not cause infinite render loops with successive setSections calls', () => {
      let renderCount = 0;

      const { result } = renderHook(
        () => {
          renderCount++;
          return useHeaderSettings();
        },
        { wrapper }
      );

      const before = renderCount;

      act(() => {
        result.current.setSections({ modelNode: React.createElement('div') });
      });

      act(() => {
        result.current.setSections({ configNode: React.createElement('span') });
      });

      // Each setSections call triggers one re-render; no infinite loop
      // renderCount should be initial + 2 (one per setSections)
      expect(renderCount).toBeLessThanOrEqual(before + 4);
    });
  });
});
