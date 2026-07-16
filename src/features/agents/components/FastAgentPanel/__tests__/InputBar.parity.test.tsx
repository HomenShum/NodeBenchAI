import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SelectionProvider,
  useSelection,
} from '@/features/agents/context/SelectionContext';
import { FastAgentInputBar } from '../FastAgentPanel.InputBar';
import { ANONYMOUS_FAST_AGENT_MODEL_ID } from '../../../../../../shared/llm/fastAgentRuntimeContract';

const enhancePrompt = vi.fn();

vi.mock('convex/react', () => ({
  useAction: () => enhancePrompt,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

type InputBarProps = React.ComponentProps<typeof FastAgentInputBar>;

const defaultProps = (): InputBarProps => ({
  id: 'fa-chat-input',
  input: '',
  isStreaming: false,
  onSelectModel: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn(),
  selectedModel: 'gemini-3-flash-preview',
  setInput: vi.fn(),
});

function ControlledInputBar({
  initialInput = '',
  ...overrides
}: Partial<InputBarProps> & { initialInput?: string }) {
  const [input, setInput] = useState(initialInput);
  const props = { ...defaultProps(), ...overrides, input, setInput };

  return <FastAgentInputBar {...props} />;
}

function ActiveSelection() {
  const { setSelection } = useSelection();

  useEffect(() => {
    setSelection('Revenue,42', {
      filename: 'forecast.csv',
      rangeDescription: 'A1:B2',
      sourceType: 'spreadsheet',
    });
  }, [setSelection]);

  return null;
}

class SpeechRecognitionMock {
  static instances: SpeechRecognitionMock[] = [];

  continuous = false;
  interimResults = false;
  lang = '';
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onresult: ((event: unknown) => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());

  constructor() {
    SpeechRecognitionMock.instances.push(this);
  }
}

describe('FastAgentInputBar parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    SpeechRecognitionMock.instances = [];
    class ResizeObserverMock {
      disconnect = vi.fn();
      observe = vi.fn();
      unobserve = vi.fn();
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverMock,
    });
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: SpeechRecognitionMock,
    });
  });

  it('puts the skip-link target on the focusable chat textbox', () => {
    render(
      <SelectionProvider>
        <ControlledInputBar />
      </SelectionProvider>,
    );

    const textarea = screen.getByRole('textbox');
    expect(screen.getByTestId('fast-agent-prompt-input')).not.toHaveAttribute(
      'id',
    );
    expect(textarea).toHaveAttribute('id', 'fa-chat-input');
    expect(document.querySelector('#fa-chat-input')).toBe(textarea);
    textarea.focus();
    expect(textarea).toHaveFocus();
  });

  it('disables the primary send until a runtime owner is ready', async () => {
    const onSend = vi.fn();
    render(
      <SelectionProvider>
        <ControlledInputBar
          initialInput="Do not create an ownerless thread"
          isSendDisabled
          onSend={onSend}
        />
      </SelectionProvider>,
    );

    const submit = screen.getByRole('button', { name: 'Send message' });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('title', 'Preparing secure session');
    await userEvent.click(submit);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('submits with Enter and preserves Shift+Enter for a newline', async () => {
    const onSend = vi.fn();
    render(
      <SelectionProvider>
        <ControlledInputBar initialInput="Ship the composer" onSend={onSend} />
      </SelectionProvider>,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith('Ship the composer');
  });

  it('hides controls whose transport is unavailable in standard chat', () => {
    const { container } = render(
      <SelectionProvider>
        <ControlledInputBar initialInput="Ground this in runtime data" />
      </SelectionProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Attach file' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record video' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /response length/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /prompt context/i })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /voice input using speech recognition/i })).toBeInTheDocument();
  });

  it('discloses the enforced guest model without offering an ineffective selector', () => {
    render(
      <SelectionProvider>
        <ControlledInputBar
          modelSelectionEnabled={false}
          selectedModel={ANONYMOUS_FAST_AGENT_MODEL_ID}
        />
      </SelectionProvider>,
    );

    const enforcedRuntimeModel = screen.getByTestId('fast-agent-enforced-runtime-model');
    expect(enforcedRuntimeModel).toHaveTextContent('Guest runtime');
    expect(enforcedRuntimeModel).toHaveTextContent('Gemini 3.1 Flash-Lite Preview');
    expect(screen.queryByRole('button', { name: /runtime model|gemini 3\.1 flash-lite/i })).not.toBeInTheDocument();
  });

  it('does not claim document drag-and-drop grounding without a runtime transport', () => {
    const { container } = render(
      <SelectionProvider>
        <ControlledInputBar />
      </SelectionProvider>,
    );

    fireEvent.dragOver(container.firstElementChild as Element, {
      dataTransfer: { types: ['application/x-nodebench-document'] },
    });
    expect(screen.queryByText(/drop documents to add context/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/analyzing document/i)).not.toBeInTheDocument();
  });

  it('allows dragged-document-only submission through the parent fallback', async () => {
    const onSend = vi.fn();

    render(
      <SelectionProvider>
        <ControlledInputBar
          contextDocuments={[
            {
              id: 'doc-1',
              title: 'Board memo',
              type: 'document',
            },
          ]}
          onSend={onSend}
        />
      </SelectionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith(undefined);
  });

  it('allows legacy selected-document-only submission through the parent fallback', async () => {
    const onSend = vi.fn();

    render(
      <SelectionProvider>
        <ControlledInputBar
          onSend={onSend}
          selectedDocumentIds={new Set(['doc-legacy-1'])}
        />
      </SelectionProvider>,
    );

    const submit = screen.getByRole('button', { name: 'Send message' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith(undefined);
  });

  it('lets the user remove a selected document before it enters the prompt scope', () => {
    const onRemoveSelectedDocument = vi.fn();
    render(
      <SelectionProvider>
        <ControlledInputBar
          onRemoveSelectedDocument={onRemoveSelectedDocument}
          selectedDocumentIds={new Set(['doc-legacy-1'])}
        />
      </SelectionProvider>,
    );

    fireEvent.click(screen.getByRole('button', {
      name: 'Remove selected document doc-legacy-1',
    }));
    expect(onRemoveSelectedDocument).toHaveBeenCalledWith('doc-legacy-1');
  });

  it('removes attachment controls from the keyboard order while sending', () => {
    render(
      <SelectionProvider>
        <ControlledInputBar
          isStreaming
          onRemoveSelectedDocument={vi.fn()}
          selectedDocumentIds={new Set(['doc-legacy-1'])}
        />
      </SelectionProvider>,
    );

    expect(screen.queryByRole('button', {
      name: 'Remove selected document doc-legacy-1',
    })).not.toBeInTheDocument();
  });

  it('keeps analyzing-only document submission disabled until a document is ready', () => {
    const onSend = vi.fn();

    render(
      <SelectionProvider>
        <ControlledInputBar
          contextDocuments={[
            {
              analyzing: true,
              id: 'doc-loading',
              title: 'Board memo',
              type: 'document',
            },
          ]}
          onSend={onSend}
        />
      </SelectionProvider>,
    );

    expect(screen.getByText('Analyzing Board memo...')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Send message' });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('intercepts a completed voice command before agent submission', () => {
    const onSend = vi.fn();
    const onVoiceIntent = vi.fn(() => true);
    render(
      <SelectionProvider>
        <ControlledInputBar onSend={onSend} onVoiceIntent={onVoiceIntent} />
      </SelectionProvider>,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Voice input using speech recognition',
      }),
    );

    const recognition = SpeechRecognitionMock.instances[0];
    expect(recognition).toBeDefined();
    expect(recognition.start).toHaveBeenCalledTimes(1);

    act(() => {
      recognition.onresult?.({
        resultIndex: 0,
        results: [
          {
            0: { transcript: 'open reports' },
            isFinal: true,
          },
        ],
      });
      recognition.onend?.();
    });

    expect(onVoiceIntent).toHaveBeenCalledWith('open reports', 'voice');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('routes /spawn commands to the swarm callback without sending a chat message', async () => {
    const onSend = vi.fn();
    const onSpawn = vi.fn();
    render(
      <SelectionProvider>
        <ControlledInputBar
          initialInput={'/spawn "Tesla analysis" --agents=doc,media'}
          onSend={onSend}
          onSpawn={onSpawn}
        />
      </SelectionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => {
      expect(onSpawn).toHaveBeenCalledWith('Tesla analysis', [
        'DocumentAgent',
        'MediaAgent',
      ]);
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not advertise or intercept /spawn when the runtime capability is unavailable', async () => {
    const onSend = vi.fn();
    render(
      <SelectionProvider>
        <ControlledInputBar initialInput="/" onSend={onSend} />
      </SelectionProvider>,
    );

    expect(screen.queryByText('Start Team')).not.toBeInTheDocument();

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, {
      target: { value: '/spawn "Tesla analysis" --agents=doc,media' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      '/spawn "Tesla analysis" --agents=doc,media',
    ));
  });

  it('forwards the constructed selection and calendar context as the send argument', async () => {
    const onSend = vi.fn();
    render(
      <SelectionProvider>
        <ActiveSelection />
        <ControlledInputBar
          contextCalendarEvents={[
            {
              allDay: true,
              id: 'event-1',
              startTime: Date.UTC(2026, 6, 14),
              title: 'Board review',
            },
          ]}
          initialInput="Summarize the implications"
          onSend={onSend}
        />
      </SelectionProvider>,
    );

    await screen.findByText(/Cells A1:B2 from forecast.csv/);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const content = onSend.mock.calls[0][0] as string;
    expect(content).toContain('**Calendar Events for Context:**');
    expect(content).toContain('**Board review**');
    expect(content).toContain(
      '**Analyzing spreadsheet selection from "forecast.csv" (A1:B2):**',
    );
    expect(content).toContain('Revenue,42');
    expect(content.endsWith('Summarize the implications')).toBe(true);
  });

  it('stops the active stream instead of submitting', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(
      <SelectionProvider>
        <ControlledInputBar
          initialInput="Do not resubmit"
          isStreaming
          onSend={onSend}
          onStop={onStop}
        />
      </SelectionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps model selection delegated to the parent', async () => {
    const onSelectModel = vi.fn();
    render(
      <SelectionProvider>
        <ControlledInputBar onSelectModel={onSelectModel} />
      </SelectionProvider>,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Gemini 3 Flash Preview/i }),
    );
    fireEvent.click(await screen.findByText('GPT-5.4 Mini'));

    expect(onSelectModel).toHaveBeenCalledWith('gpt-5.4-mini');
  });

  it('keeps ordinary @ text without advertising unsupported mention controls', () => {
    render(
      <SelectionProvider>
        <ControlledInputBar />
      </SelectionProvider>,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, {
      target: { selectionStart: 5, value: '@docs' },
    });

    expect(textarea).toHaveValue('@docs');
    expect(screen.queryByText('Search documents')).not.toBeInTheDocument();
  });

  it('keeps slash-command completion on the controlled live input', async () => {
    render(
      <SelectionProvider>
        <ControlledInputBar onSpawn={vi.fn()} />
      </SelectionProvider>,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '/' } });
    fireEvent.click(await screen.findByText('Start Team'));

    expect(textarea).toHaveValue('/spawn "Tesla analysis" --agents=doc,media,sec');
  });

  it('keeps Ctrl+P enhancement on the Convex action and controlled input', async () => {
    enhancePrompt.mockResolvedValue({
      enhanced: 'Enhanced prompt with memory',
      injectedContext: { memory: ['memory'], suggestedTools: ['search'] },
    });
    render(
      <SelectionProvider>
        <ControlledInputBar initialInput="Improve this" threadId="thread-1" />
      </SelectionProvider>,
    );

    fireEvent.keyDown(window, { ctrlKey: true, key: 'p' });

    await waitFor(() => {
      expect(enhancePrompt).toHaveBeenCalledWith({
        attachedFileIds: undefined,
        prompt: 'Improve this',
        threadId: 'thread-1',
      });
    });
    expect(screen.getByRole('textbox')).toHaveValue(
      'Enhanced prompt with memory',
    );
  });

  it('keeps the real inline enhancer outside the form submit path', async () => {
    const onSend = vi.fn();
    enhancePrompt.mockResolvedValue({
      enhanced: 'Enhanced without sending',
      injectedContext: { memory: [], suggestedTools: [] },
    });
    render(
      <SelectionProvider>
        <ControlledInputBar initialInput="Improve this" onSend={onSend} />
      </SelectionProvider>,
    );

    const enhanceButton = screen.getByTitle(
      'Enhance prompt with context (Ctrl+P)',
    );
    expect(enhanceButton).toHaveAttribute('type', 'button');
    fireEvent.click(enhanceButton);

    await waitFor(() => expect(enhancePrompt).toHaveBeenCalledTimes(1));
    expect(onSend).not.toHaveBeenCalled();
  });
});
