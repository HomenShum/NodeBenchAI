import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SelectionProvider,
  useSelection,
} from '@/features/agents/context/SelectionContext';
import { FastAgentInputBar } from '../FastAgentPanel.InputBar';

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

vi.mock('../FastAgentPanel.MediaRecorder', () => ({
  MediaRecorderComponent: ({ mode }: { mode: string }) => (
    <div data-mode={mode} data-testid="media-recorder" />
  ),
}));

vi.mock('../FastAgentPanel.PromptEnhancer', () => ({
  InlineEnhancer: ({ onEnhance }: { onEnhance: () => void }) => (
    <button aria-label="Enhance prompt" onClick={onEnhance} type="button">
      Enhance
    </button>
  ),
}));

vi.mock('@/shared/components/FileDropOverlay', () => ({
  FileDropOverlay: () => null,
}));

type InputBarProps = React.ComponentProps<typeof FastAgentInputBar>;

const defaultProps = (): InputBarProps => ({
  attachedFiles: [],
  id: 'fa-chat-input',
  input: '',
  isStreaming: false,
  onAttachFiles: vi.fn(),
  onRemoveFile: vi.fn(),
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

  it('submits with Enter and preserves Shift+Enter for a newline', async () => {
    const onSend = vi.fn();
    render(
      <SelectionProvider>
        <ControlledInputBar initialInput="Ship the composer" onSend={onSend} />
      </SelectionProvider>,
    );

    const textarea = screen.getByRole('textbox');
    expect(screen.getByTestId('fast-agent-prompt-input')).toHaveAttribute(
      'id',
      'fa-chat-input',
    );
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith('Ship the composer');
  });

  it('allows attachment-only submission through the existing optional content API', async () => {
    const onSend = vi.fn();
    const attachment = new File(['evidence'], 'evidence.txt', {
      type: 'text/plain',
    });

    render(
      <SelectionProvider>
        <ControlledInputBar attachedFiles={[attachment]} onSend={onSend} />
      </SelectionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith(undefined);
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

  it('keeps @mention completion on the controlled live input', async () => {
    render(
      <SelectionProvider>
        <ControlledInputBar />
      </SelectionProvider>,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, {
      target: { selectionStart: 3, value: '@do' },
    });
    fireEvent.click(await screen.findByText('@docs'));

    expect(textarea).toHaveValue('@docs ');
  });

  it('keeps slash-command completion on the controlled live input', async () => {
    render(
      <SelectionProvider>
        <ControlledInputBar />
      </SelectionProvider>,
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '/' } });
    fireEvent.click(await screen.findByText('Start Team'));

    expect(textarea).toHaveValue('/spawn "Tesla analysis" --agents=doc,media,sec');
  });

  it('keeps file-picker and pasted-image attachments on the parent-owned state path', () => {
    const onAttachFiles = vi.fn();
    const pickedFile = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    const pastedFile = new File(['image'], 'chart.png', { type: 'image/png' });
    const { container } = render(
      <SelectionProvider>
        <ControlledInputBar onAttachFiles={onAttachFiles} />
      </SelectionProvider>,
    );

    const fileInputs = container.querySelectorAll('input[type="file"]');
    expect(fileInputs).toHaveLength(1);
    const fileInput = fileInputs.item(0);
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, { target: { files: [pickedFile] } });
    expect(onAttachFiles).toHaveBeenNthCalledWith(1, [pickedFile]);

    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: {
        getData: () => '',
        items: [
          {
            getAsFile: () => pastedFile,
            kind: 'file',
            type: 'image/png',
          },
        ],
      },
    });
    expect(onAttachFiles).toHaveBeenNthCalledWith(2, [pastedFile]);
  });

  it('keeps media drag-and-drop on the parent-owned attachment state path', () => {
    const onAttachFiles = vi.fn();
    const droppedFile = new File(['image'], 'drop.png', { type: 'image/png' });
    const { container } = render(
      <SelectionProvider>
        <ControlledInputBar onAttachFiles={onAttachFiles} />
      </SelectionProvider>,
    );

    const dropTarget = container.querySelector('.fa-input-bar-wrapper');
    expect(dropTarget).not.toBeNull();
    fireEvent.drop(dropTarget!, {
      dataTransfer: {
        files: [droppedFile],
        getData: () => '',
        types: ['Files'],
      },
    });

    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    expect(onAttachFiles).toHaveBeenCalledWith([droppedFile]);
  });

  it('keeps the custom media recorder entry point', () => {
    render(
      <SelectionProvider>
        <ControlledInputBar />
      </SelectionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Record video' }));
    expect(screen.getByTestId('media-recorder')).toHaveAttribute(
      'data-mode',
      'video',
    );
  });

  it('keeps response-length control delegated to the parent', () => {
    const onResponseLengthChange = vi.fn();
    render(
      <SelectionProvider>
        <ControlledInputBar
          onResponseLengthChange={onResponseLengthChange}
          responseLength="detailed"
        />
      </SelectionProvider>,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Response length: detailed' }),
    );
    expect(onResponseLengthChange).toHaveBeenCalledWith('exhaustive');
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
});
