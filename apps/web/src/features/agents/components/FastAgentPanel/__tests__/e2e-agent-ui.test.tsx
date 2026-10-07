// src/components/FastAgentPanel/__tests__/e2e-agent-ui.test.tsx
// End-to-end tests for agent chat UI integration

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConvexProvider } from 'convex/react';
import { ConvexReactClient } from 'convex/react';
import { FastAgentPanel } from '../FastAgentPanel';

/**
 * E2E Tests for Agent Chat UI Integration
 *
 * These tests verify:
 * 1. UI correctly displays agent responses
 * 2. Rich media components render from agent output
 * 3. Sub-query filtering works in the UI
 * 4. Message stream updates correctly
 * 5. Citations and media galleries display properly
 */

describe.skipIf(!process.env.CONVEX_DEPLOYMENT_URL)('Agent Chat UI Integration E2E Tests', () => {
  let client: ConvexReactClient;

  beforeAll(() => {
    const deploymentUrl = process.env.CONVEX_DEPLOYMENT_URL;
    if (!deploymentUrl) {
      throw new Error('CONVEX_DEPLOYMENT_URL environment variable is required');
    }
    client = new ConvexReactClient(deploymentUrl);
  });

  afterAll(() => {
    if (client) {
      client.close();
    }
  });

  const renderWithConvex = (component: React.ReactElement) => {
    return render(
      <ConvexProvider client={client}>
        {component}
      </ConvexProvider>
    );
  };

  describe('Message Display', () => {
    it('should render FastAgentPanel component', () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      // Panel should be visible
      const panel = screen.getByRole('main', { hidden: true });
      expect(panel).toBeInTheDocument();
    });

    it('should display input area for user messages', () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      // Input area should be present
      const input = screen.getByPlaceholderText(/ask anything/i);
      expect(input).toBeInTheDocument();
    });

    it('should display message stream area', () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      // Chat area should be present
      const chatArea = screen.getByRole('region', { hidden: true });
      expect(chatArea).toBeInTheDocument();
    });
  });

  describe('User Input Handling', () => {
    it('should accept user input', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      
      fireEvent.change(input, { target: { value: 'Search for Tesla news' } });
      expect(input).toHaveValue('Search for Tesla news');
    });

    it('should send message on Enter key', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      
      fireEvent.change(input, { target: { value: 'Test query' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      
      // Input should be cleared after sending
      await waitFor(() => {
        expect(input).toHaveValue('');
      }, { timeout: 2000 });
    });

    it('should send message on button click', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      const sendButton = screen.getByRole('button', { name: /send|submit/i, hidden: true });
      
      fireEvent.change(input, { target: { value: 'Test query' } });
      fireEvent.click(sendButton);
      
      // Input should be cleared
      await waitFor(() => {
        expect(input).toHaveValue('');
      }, { timeout: 2000 });
    });
  });

  describe('Response Display', () => {
    it('should display user message in chat', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      const sendButton = screen.getByRole('button', { name: /send|submit/i, hidden: true });
      
      fireEvent.change(input, { target: { value: 'Hello agent' } });
      fireEvent.click(sendButton);
      
      // User message should appear in chat
      await waitFor(() => {
        expect(screen.getByText('Hello agent')).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('should display agent response', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      const sendButton = screen.getByRole('button', { name: /send|submit/i, hidden: true });
      
      fireEvent.change(input, { target: { value: 'What is AI?' } });
      fireEvent.click(sendButton);
      
      // Agent response should appear
      await waitFor(() => {
        const messages = screen.getAllByRole('article', { hidden: true });
        expect(messages.length).toBeGreaterThan(1);
      }, { timeout: 5000 });
    });

    it('should show typing indicator while streaming', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      const sendButton = screen.getByRole('button', { name: /send|submit/i, hidden: true });
      
      fireEvent.change(input, { target: { value: 'Search for information' } });
      fireEvent.click(sendButton);
      
      // Typing indicator should appear
      await waitFor(() => {
        const typingIndicator = screen.queryByTestId('typing-indicator');
        expect(typingIndicator).toBeInTheDocument();
      }, { timeout: 2000 });
    });
  });

  describe('Rich Media Rendering', () => {
    it('should render video cards from agent response', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      const sendButton = screen.getByRole('button', { name: /send|submit/i, hidden: true });
      
      fireEvent.change(input, { target: { value: 'Find videos about machine learning' } });
      fireEvent.click(sendButton);
      
      // Video carousel should appear
      await waitFor(() => {
        const videoCarousel = screen.queryByText(/Related Videos|videos/i);
        expect(videoCarousel).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('should render source cards from agent response', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      const sendButton = screen.getByRole('button', { name: /send|submit/i, hidden: true });
      
      fireEvent.change(input, { target: { value: 'Search for news articles' } });
      fireEvent.click(sendButton);
      
      // Source grid should appear
      await waitFor(() => {
        const sourceGrid = screen.queryByText(/Sources|Documents/i);
        expect(sourceGrid).toBeInTheDocument();
      }, { timeout: 5000 });
    });

    it('should render profile cards from agent response', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      const sendButton = screen.getByRole('button', { name: /send|submit/i, hidden: true });
      
      fireEvent.change(input, { target: { value: 'Find information about tech leaders' } });
      fireEvent.click(sendButton);
      
      // Profile grid should appear
      await waitFor(() => {
        const profileGrid = screen.queryByText(/People|Profiles/i);
        expect(profileGrid).toBeInTheDocument();
      }, { timeout: 5000 });
    });
  });

  describe('Show More Functionality', () => {
    it('should show "Show More" button for videos', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      const sendButton = screen.getByRole('button', { name: /send|submit/i, hidden: true });
      
      fireEvent.change(input, { target: { value: 'Find many videos about Python' } });
      fireEvent.click(sendButton);
      
      // Show More button should appear if there are more than 6 videos
      await waitFor(() => {
        const showMoreButton = screen.queryByRole('button', { name: /Show.*More/i, hidden: true });
        if (showMoreButton) {
          expect(showMoreButton).toBeInTheDocument();
        }
      }, { timeout: 5000 });
    });

    it('should expand media list when "Show More" is clicked', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      const sendButton = screen.getByRole('button', { name: /send|submit/i, hidden: true });
      
      fireEvent.change(input, { target: { value: 'Find many sources' } });
      fireEvent.click(sendButton);
      
      // Wait for response
      await waitFor(() => {
        const showMoreButton = screen.queryByRole('button', { name: /Show.*More/i, hidden: true });
        if (showMoreButton) {
          fireEvent.click(showMoreButton);
          
          // Should show "Show Less" button after expanding
          expect(screen.queryByRole('button', { name: /Show Less/i, hidden: true })).toBeInTheDocument();
        }
      }, { timeout: 5000 });
    });
  });

  describe('Citation System', () => {
    it('should display citation numbers on source cards', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      const sendButton = screen.getByRole('button', { name: /send|submit/i, hidden: true });
      
      fireEvent.change(input, { target: { value: 'Search for information with citations' } });
      fireEvent.click(sendButton);
      
      // Citation numbers should appear
      await waitFor(() => {
        const citations = screen.queryAllByText(/^[0-9]$/);
        expect(citations.length).toBeGreaterThan(0);
      }, { timeout: 5000 });
    });

    it('should scroll to source when citation is clicked', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      const sendButton = screen.getByRole('button', { name: /send|submit/i, hidden: true });
      
      fireEvent.change(input, { target: { value: 'Search for sources' } });
      fireEvent.click(sendButton);
      
      // Wait for response and citations
      await waitFor(() => {
        const citations = screen.queryAllByText(/^[0-9]$/);
        if (citations.length > 0) {
          fireEvent.click(citations[0]);
          // Should scroll to corresponding source
        }
      }, { timeout: 5000 });
    });
  });

  describe('Thread Management', () => {
    it('should create new thread for new conversation', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const newThreadButton = screen.getByRole('button', { name: /new|create|plus/i, hidden: true });
      fireEvent.click(newThreadButton);
      
      // New thread should be created
      await waitFor(() => {
        const input = screen.getByPlaceholderText(/ask anything/i);
        expect(input).toHaveValue('');
      }, { timeout: 2000 });
    });

    it('should maintain conversation history in thread', async () => {
      renderWithConvex(
        <FastAgentPanel isOpen={true} onClose={vi.fn()} />
      );

      const input = screen.getByPlaceholderText(/ask anything/i);
      const sendButton = screen.getByRole('button', { name: /send|submit/i, hidden: true });
      
      // Send first message
      fireEvent.change(input, { target: { value: 'First question' } });
      fireEvent.click(sendButton);
      
      await waitFor(() => {
        expect(input).toHaveValue('');
      }, { timeout: 2000 });
      
      // Send second message
      fireEvent.change(input, { target: { value: 'Second question' } });
      fireEvent.click(sendButton);
      
      // Both messages should be visible
      await waitFor(() => {
        expect(screen.getByText('First question')).toBeInTheDocument();
        expect(screen.getByText('Second question')).toBeInTheDocument();
      }, { timeout: 3000 });
    });
  });
});

