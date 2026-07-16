export interface FastAgentContextDocument {
  id: string;
  title: string;
  type?: 'document' | 'dossier' | 'note';
  analyzing?: boolean;
}

export type FastAgentSubmissionBlockReason =
  | 'attachments_unsupported'
  | 'documents_analyzing'
  | 'empty';

export type FastAgentPreparedSubmission =
  | {
      ok: false;
      reason: FastAgentSubmissionBlockReason;
    }
  | {
      consumedContextDocumentIds: string[];
      messageContent: string;
      ok: true;
      text: string;
    };

export function getAuthenticatedDocumentCreationTopic({
  chatMode,
  isAuthenticated,
  isProductConversationMode,
  text,
}: {
  chatMode: 'agent' | 'agent-streaming';
  isAuthenticated: boolean;
  isProductConversationMode: boolean;
  text: string;
}): string | null {
  if (!isAuthenticated || chatMode !== 'agent-streaming' || isProductConversationMode) {
    return null;
  }
  return text.match(/^(?:make|create)\s+(?:new\s+)?document\s+(?:about|on|for)\s+(.+)$/i)?.[1]?.trim() || null;
}

interface PrepareFastAgentSubmissionArgs {
  allowAttachments: boolean;
  attachedFiles: Array<{ name: string }>;
  content?: string;
  contextDocuments: FastAgentContextDocument[];
  dossierPrefix: string;
  input: string;
  selectedDocumentIds: Iterable<string>;
}

/**
 * Builds the exact text contract consumed by FastAgentPanel's backends.
 *
 * File objects never become text-only claims here unless the caller confirms that the
 * selected backend will receive real file references. This keeps the presentation layer
 * and both non-product chat modes capability-honest.
 */
export function prepareFastAgentSubmission({
  allowAttachments,
  attachedFiles,
  content,
  contextDocuments,
  dossierPrefix,
  input,
  selectedDocumentIds,
}: PrepareFastAgentSubmissionArgs): FastAgentPreparedSubmission {
  if (attachedFiles.length > 0 && !allowAttachments) {
    return { ok: false, reason: 'attachments_unsupported' };
  }

  const submittedText = (content ?? input).trim();
  const readyDocuments = contextDocuments.filter((document) => !document.analyzing);
  const legacyDocumentIds = Array.from(selectedDocumentIds);
  const hasReadyDocumentContext =
    readyDocuments.length > 0 || legacyDocumentIds.length > 0;

  if (
    !submittedText &&
    !hasReadyDocumentContext &&
    contextDocuments.some((document) => document.analyzing)
  ) {
    return { ok: false, reason: 'documents_analyzing' };
  }

  const attachmentPrompt =
    allowAttachments && attachedFiles.length > 0
      ? `Please analyze the attached file${attachedFiles.length === 1 ? '' : 's'}: ${attachedFiles
          .map((file) => file.name)
          .join(', ')}.`
      : '';
  const documentPrompt = hasReadyDocumentContext
    ? 'Please analyze the selected documents.'
    : '';
  const text = submittedText || attachmentPrompt || documentPrompt;

  if (!text) {
    return { ok: false, reason: 'empty' };
  }

  let messageContent = dossierPrefix ? `${dossierPrefix}${text}` : text;

  if (readyDocuments.length > 0) {
    const contextInfo = readyDocuments
      .map((document) => `${document.title} (ID: ${document.id})`)
      .join(', ');
    messageContent = `[CONTEXT: Analyzing documents: ${contextInfo}]\n\n${messageContent}`;
  }

  if (legacyDocumentIds.length > 0) {
    messageContent = `[CONTEXT: Analyzing ${legacyDocumentIds.length} document(s): ${legacyDocumentIds.join(', ')}]\n\n${messageContent}`;
  }

  return {
    consumedContextDocumentIds: readyDocuments.map((document) => document.id),
    messageContent,
    ok: true,
    text,
  };
}

interface FastAgentClientContext {
  timezone?: string;
  locale?: string;
  utcOffsetMinutes?: number;
  location?: string;
}

interface DispatchFastAgentSubmissionArgs {
  activeThreadId: string | null;
  anonymousSessionId?: string;
  chatMode: 'agent' | 'agent-streaming';
  clientContext?: FastAgentClientContext;
  continueThreadAction: (args: {
    message: string;
    threadId: string;
  }) => Promise<unknown>;
  createThreadWithMessage: (args: {
    message: string;
    model: string;
  }) => Promise<{ threadId: string }>;
  entitySlug?: string;
  messageContent: string;
  selectedModel: string;
  sendStreamingMessage: (args: {
    anonymousSessionId?: string;
    clientContext?: FastAgentClientContext;
    entitySlug?: string;
    model: string;
    prompt: string;
    threadId: string;
    useCoordinator: boolean;
  }) => Promise<unknown>;
  streamThreadId: string | null;
}

export async function dispatchFastAgentSubmission({
  activeThreadId,
  anonymousSessionId,
  chatMode,
  clientContext,
  continueThreadAction,
  createThreadWithMessage,
  entitySlug,
  messageContent,
  selectedModel,
  sendStreamingMessage,
  streamThreadId,
}: DispatchFastAgentSubmissionArgs): Promise<{
  createdThreadId?: string;
}> {
  if (chatMode === 'agent') {
    if (activeThreadId) {
      await continueThreadAction({
        message: messageContent,
        threadId: activeThreadId,
      });
      return {};
    }

    const result = await createThreadWithMessage({
      message: messageContent,
      model: selectedModel,
    });
    return { createdThreadId: result.threadId };
  }

  if (!streamThreadId) {
    throw new Error('Thread ID is required');
  }

  await sendStreamingMessage({
    anonymousSessionId,
    clientContext,
    entitySlug,
    model: selectedModel,
    prompt: messageContent,
    threadId: streamThreadId,
    useCoordinator: true,
  });
  return {};
}
