import { describe, expect, it, vi } from 'vitest';

import {
  dispatchFastAgentSubmission,
  getAuthenticatedDocumentCreationTopic,
  prepareFastAgentSubmission,
} from '../FastAgentPanel.sendContract';

const createBackends = () => ({
  continueThreadAction: vi.fn().mockResolvedValue({ success: true }),
  createThreadWithMessage: vi.fn().mockResolvedValue({
    success: true,
    threadId: 'agent-thread-new',
  }),
  sendStreamingMessage: vi.fn().mockResolvedValue({ messageId: 'message-1' }),
});

async function prepareAndDispatch(
  input: Parameters<typeof prepareFastAgentSubmission>[0],
  dispatch: Omit<
    Parameters<typeof dispatchFastAgentSubmission>[0],
    'messageContent'
  >,
) {
  const prepared = prepareFastAgentSubmission(input);
  if (prepared.ok) {
    await dispatchFastAgentSubmission({
      ...dispatch,
      messageContent: prepared.messageContent,
    });
  }
  return prepared;
}

describe('FastAgentPanel send contract', () => {
  it('routes guest document wording through normal chat instead of the auth-only creator', () => {
    expect(getAuthenticatedDocumentCreationTopic({
      chatMode: 'agent-streaming',
      isAuthenticated: false,
      isProductConversationMode: false,
      text: 'Create document about battery supply chains',
    })).toBeNull();

    expect(getAuthenticatedDocumentCreationTopic({
      chatMode: 'agent-streaming',
      isAuthenticated: true,
      isProductConversationMode: false,
      text: 'Create document about battery supply chains',
    })).toBe('battery supply chains');
  });

  it('holds text plus files and never calls a text-only backend', async () => {
    const backends = createBackends();

    const result = await prepareAndDispatch(
      {
        allowAttachments: false,
        attachedFiles: [{ name: 'evidence.txt' }],
        content: 'Use this evidence',
        contextDocuments: [],
        dossierPrefix: '',
        input: '',
        selectedDocumentIds: [],
      },
      {
        activeThreadId: null,
        chatMode: 'agent-streaming',
        clientContext: undefined,
        selectedModel: 'gpt-5.4-mini',
        streamThreadId: 'stream-thread-1',
        ...backends,
      },
    );

    expect(result).toEqual({ ok: false, reason: 'attachments_unsupported' });
    expect(backends.createThreadWithMessage).not.toHaveBeenCalled();
    expect(backends.continueThreadAction).not.toHaveBeenCalled();
    expect(backends.sendStreamingMessage).not.toHaveBeenCalled();
  });

  it('holds file-only sends without synthesizing an attached-file claim', async () => {
    const backends = createBackends();

    const result = await prepareAndDispatch(
      {
        allowAttachments: false,
        attachedFiles: [{ name: 'board.pdf' }],
        contextDocuments: [],
        dossierPrefix: '',
        input: '',
        selectedDocumentIds: [],
      },
      {
        activeThreadId: null,
        chatMode: 'agent',
        clientContext: undefined,
        selectedModel: 'gpt-5.4-mini',
        streamThreadId: null,
        ...backends,
      },
    );

    expect(result).toEqual({ ok: false, reason: 'attachments_unsupported' });
    expect(JSON.stringify(result)).not.toContain('attached file');
    expect(backends.createThreadWithMessage).not.toHaveBeenCalled();
    expect(backends.continueThreadAction).not.toHaveBeenCalled();
    expect(backends.sendStreamingMessage).not.toHaveBeenCalled();
  });

  it('sends a ready dragged document through the streaming backend with its real id', async () => {
    const backends = createBackends();

    const result = await prepareAndDispatch(
      {
        allowAttachments: false,
        attachedFiles: [],
        contextDocuments: [
          { id: 'doc-ready', title: 'Board memo', type: 'document' },
        ],
        dossierPrefix: '',
        input: '',
        selectedDocumentIds: [],
      },
      {
        activeThreadId: null,
        chatMode: 'agent-streaming',
        clientContext: { locale: 'en-US' },
        selectedModel: 'gpt-5.4-mini',
        streamThreadId: 'stream-thread-1',
        ...backends,
      },
    );

    expect(result).toMatchObject({
      consumedContextDocumentIds: ['doc-ready'],
      ok: true,
      text: 'Please analyze the selected documents.',
    });
    expect(backends.sendStreamingMessage).toHaveBeenCalledWith({
      anonymousSessionId: undefined,
      clientContext: { locale: 'en-US' },
      entitySlug: undefined,
      model: 'gpt-5.4-mini',
      prompt:
        '[CONTEXT: Analyzing documents: Board memo (ID: doc-ready)]\n\nPlease analyze the selected documents.',
      threadId: 'stream-thread-1',
      useCoordinator: true,
    });
  });

  it('sends anonymous prompts through the canonical streaming backend', async () => {
    const backends = createBackends();

    const result = await prepareAndDispatch(
      {
        allowAttachments: false,
        attachedFiles: [],
        contextDocuments: [],
        dossierPrefix: '',
        input: 'What changed in my market?',
        selectedDocumentIds: [],
      },
      {
        activeThreadId: 'anonymous-thread',
        anonymousSessionId: 'anonymous-session-1',
        chatMode: 'agent-streaming',
        clientContext: { locale: 'en-US' },
        selectedModel: 'gpt-5.4-mini',
        streamThreadId: 'anonymous-thread',
        ...backends,
      },
    );

    expect(result).toMatchObject({ ok: true, text: 'What changed in my market?' });
    expect(backends.sendStreamingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        anonymousSessionId: 'anonymous-session-1',
        prompt: 'What changed in my market?',
        threadId: 'anonymous-thread',
      }),
    );
  });

  it('holds analyzing-only document sends and leaves every backend untouched', async () => {
    const backends = createBackends();

    const result = await prepareAndDispatch(
      {
        allowAttachments: false,
        attachedFiles: [],
        contextDocuments: [
          {
            analyzing: true,
            id: 'doc-loading',
            title: 'Still indexing',
            type: 'document',
          },
        ],
        dossierPrefix: '',
        input: '',
        selectedDocumentIds: [],
      },
      {
        activeThreadId: null,
        chatMode: 'agent-streaming',
        clientContext: undefined,
        selectedModel: 'gpt-5.4-mini',
        streamThreadId: 'stream-thread-1',
        ...backends,
      },
    );

    expect(result).toEqual({ ok: false, reason: 'documents_analyzing' });
    expect(backends.createThreadWithMessage).not.toHaveBeenCalled();
    expect(backends.continueThreadAction).not.toHaveBeenCalled();
    expect(backends.sendStreamingMessage).not.toHaveBeenCalled();
  });

  it('sends legacy selected document ids through the existing agent backend', async () => {
    const backends = createBackends();

    const result = await prepareAndDispatch(
      {
        allowAttachments: false,
        attachedFiles: [],
        contextDocuments: [],
        dossierPrefix: '',
        input: '',
        selectedDocumentIds: ['legacy-doc-1'],
      },
      {
        activeThreadId: 'agent-thread-existing',
        chatMode: 'agent',
        clientContext: undefined,
        selectedModel: 'gpt-5.4-mini',
        streamThreadId: null,
        ...backends,
      },
    );

    expect(result).toMatchObject({ ok: true });
    expect(backends.continueThreadAction).toHaveBeenCalledWith({
      message:
        '[CONTEXT: Analyzing 1 document(s): legacy-doc-1]\n\nPlease analyze the selected documents.',
      threadId: 'agent-thread-existing',
    });
    expect(backends.createThreadWithMessage).not.toHaveBeenCalled();
  });
});
