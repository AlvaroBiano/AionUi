import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      warmup: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({ conversationId: 'conv-1' }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: vi.fn(),
    domSnippets: [],
    removeDomSnippet: vi.fn(),
    clearDomSnippets: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({
    activeBorderColor: '#000',
    inactiveBorderColor: '#ccc',
    activeShadow: 'none',
  }),
}));

vi.mock('@/renderer/hooks/chat/useCompositionInput', () => ({
  useCompositionInput: () => ({
    compositionHandlers: {},
    isComposingState: false,
    createKeyDownHandler: (onEnterPress: () => void, onKeyDownIntercept?: (event: React.KeyboardEvent) => boolean) => {
      return (event: React.KeyboardEvent) => {
        if (onKeyDownIntercept?.(event)) {
          return;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          onEnterPress();
        }
      };
    },
  }),
}));

vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({
    isFileDragging: false,
    dragHandlers: {},
  }),
}));

vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({
    onPaste: vi.fn(),
    onFocus: vi.fn(),
  }),
}));

vi.mock('@renderer/hooks/ui/useLatestRef', () => ({
  useLatestRef: (value: unknown) => ({ current: value }),
}));

vi.mock('@/renderer/hooks/file/useConversationExport', () => ({
  useConversationExport: () => ({
    activeIndex: 0,
    closeExportFlow: vi.fn(),
    filename: '',
    handleKeyDown: vi.fn(() => false),
    isOpen: false,
    loading: false,
    menuItems: [],
    openExportFlow: vi.fn(),
    onSelectMenuItem: vi.fn(),
    pathPreview: '',
    setActiveIndex: vi.fn(),
    setFilename: vi.fn(),
    showMenu: vi.fn(),
    step: 'menu',
    submitFilename: vi.fn(),
  }),
}));

vi.mock('@/renderer/hooks/file/useUploadState', () => ({
  useUploadState: () => ({ isUploading: false }),
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => [],
}));

vi.mock('@/renderer/hooks/chat/useSlashCommandController', () => ({
  useSlashCommandController: () => ({
    isOpen: false,
    filteredCommands: [],
    activeIndex: 0,
    setActiveIndex: vi.fn(),
    onSelectByIndex: vi.fn(),
    onKeyDown: vi.fn(() => false),
  }),
}));

vi.mock('@/renderer/components/chat/AtFileMenu', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'AtFileMenu'),
}));

vi.mock('@/renderer/components/chat/BtwOverlay', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'BtwOverlay'),
}));

vi.mock('@/renderer/components/chat/BtwOverlay/useBtwCommand', () => ({
  useBtwCommand: () => ({
    answer: '',
    ask: vi.fn(),
    dismiss: vi.fn(),
    isLoading: false,
    isOpen: false,
    question: '',
  }),
}));

vi.mock('@/renderer/components/chat/SlashCommandMenu', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'SlashCommandMenu'),
}));

vi.mock('@/renderer/components/media/UploadProgressBar', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'UploadProgressBar'),
}));

vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({
  __esModule: true,
  default: () => React.createElement('div', {}, 'SpeechInputButton'),
}));

vi.mock('@/renderer/utils/ui/focus', () => ({
  blurActiveElement: vi.fn(),
  shouldBlockMobileInputFocus: vi.fn(() => false),
}));

vi.mock('@/renderer/services/FileService', () => ({
  allSupportedExts: [],
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: vi.fn(),
  },
  useAddEventListener: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
    i18n: {
      language: 'en-US',
    },
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    onClick,
    children,
    icon,
    disabled,
    className,
    ...props
  }: React.ComponentProps<'button'> & { icon?: React.ReactNode }) =>
    React.createElement(
      'button',
      {
        onClick,
        disabled,
        className,
        'aria-label': className?.includes('send-button-custom') ? 'send' : undefined,
        ...props,
      },
      icon ?? children
    ),
  Input: {
    TextArea: ({
      onKeyDown,
      onChange,
      onFocus,
      onBlur,
      value,
      ...props
    }: React.ComponentProps<'textarea'> & { value?: string }) =>
      React.createElement('textarea', {
        onKeyDown,
        onFocus,
        onBlur,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(event.target.value),
        value,
        ...props,
      }),
  },
  Message: {
    useMessage: () => [{ warning: vi.fn() }, null],
  },
  Tag: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children),
}));

vi.mock('@icon-park/react', () => ({
  ArrowUp: () => React.createElement('span', {}, 'ArrowUp'),
  CloseSmall: () => React.createElement('span', {}, 'CloseSmall'),
  Quote: () => React.createElement('span', {}, 'Quote'),
}));

import SendBox from '@/renderer/components/chat/sendbox';

describe('SendBox core behaviors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders send button disabled when value is empty', () => {
    render(<SendBox value='' onChange={vi.fn()} onSend={vi.fn()} />);

    const sendButton = screen.getByRole('button', { name: 'send' });
    expect(sendButton).toBeDisabled();
  });

  it('renders send button disabled when value is whitespace only', () => {
    render(<SendBox value='   ' onChange={vi.fn()} onSend={vi.fn()} />);

    const sendButton = screen.getByRole('button', { name: 'send' });
    expect(sendButton).toBeDisabled();
  });

  it('renders send button enabled when value has content', () => {
    render(<SendBox value='hello world' onChange={vi.fn()} onSend={vi.fn()} />);

    const sendButton = screen.getByRole('button', { name: 'send' });
    expect(sendButton).not.toBeDisabled();
  });

  it('does not send on Shift+Enter', () => {
    const onSend = vi.fn();
    render(<SendBox value='some text' onChange={vi.fn()} onSend={onSend} />);

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('renders toolbar with tools slot content', () => {
    const toolsContent = React.createElement('button', { 'data-testid': 'attachment-btn' }, 'Attach');
    render(<SendBox value='' onChange={vi.fn()} onSend={vi.fn()} tools={toolsContent} />);

    expect(screen.getByTestId('attachment-btn')).toBeInTheDocument();
  });
});
