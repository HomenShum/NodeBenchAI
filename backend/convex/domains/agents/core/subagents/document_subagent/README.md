# Document Agent

Specialized agent for document management and analysis in NodeBench AI.

## 🎯 Purpose

The Document Agent handles all document-related operations including search, retrieval, creation, editing, and multi-document analysis.

## 🔧 Capabilities

### Document Search & Retrieval
- Search documents by title, content, or metadata
- Retrieve full document content
- Find documents by hashtag
- Search across uploaded files with Gemini

### Document Creation & Editing
- Create new documents
- Update existing documents
- Generate edit proposals
- Create documents from agent responses

### Multi-Document Analysis
- Compare multiple documents
- Synthesize information across documents
- Identify themes and relationships
- Aggregate data from multiple sources

### Hashtag Management
- Search documents by hashtag
- Create hashtag dossiers
- Manage hashtag collections

## 📁 Tools

- `findDocument` - Search for documents
- `getDocumentContent` - Retrieve document content
- `analyzeDocument` - Analyze single document
- `analyzeMultipleDocuments` - Analyze multiple documents
- `updateDocument` - Update document content
- `createDocument` - Create new document
- `generateEditProposals` - Generate edit suggestions
- `createDocumentFromAgentContentTool` - Create document from agent output
- `searchHashtag` - Search by hashtag
- `createHashtagDossier` - Create hashtag collection
- `getOrCreateHashtagDossier` - Get or create hashtag dossier
- `searchFiles` - Search uploaded files with Gemini

## 🚀 Usage

```typescript
import { createDocumentAgent } from "./documentAgent";

const agent = createDocumentAgent("gpt-4o");
```

## 📞 Owner

Document Team

