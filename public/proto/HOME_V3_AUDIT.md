# COMPREHENSIVE INTERACTIVE BEHAVIOR AUDIT
## public/proto/home-v3.html (10,991 lines, ~580KB)

Date: 2026-05-17
Scope: Very Thorough - Complete enumeration of all event handlers, navigation logic, state management

---

## EXECUTIVE SUMMARY

The home-v3.html prototype is a single-file HTML/CSS/JS application with 5 main surfaces 
(Home, Reports, Chat, Inbox, Me) and extensive interactive features.

### Key Statistics
- 75 total functions, 23 key interactive functions
- 13 unique event types with 68+ click handlers
- 8 core data structures driving dynamic content
- 29+ timer-based animations for sequential UI transitions
- 3-level nested expansion depth limit (MAX_EXPAND_DEPTH = 3)
- Artifact overlay system that cleans up transient state

---

## 1. NAVIGATION & SURFACE SWITCHING

### Primary Surface Navigation (5 Nav Tabs)
Location: Lines 7051-7081 | Function: switchSurface(surface)

Surfaces:
1. Home - Daily brief + composer
2. Reports - Collection views (gallery/board/table/graph) + notebook detail
3. Chat - Thread list + message stream + trace waterfall + review panels
4. Inbox - Placeholder, partially implemented
5. Me - Placeholder, partially implemented

### Sub-View Navigation (Reports Collection Views)
Location: Lines 7819-7851 | Function: switchView(view)

Surfaces: gallery, board, table, graph
State Variable: activeCollectionView (initialized to 'gallery')
Special: graph view triggers requestAnimationFrame(initGraph)

---

## 2. EVENT LISTENERS INVENTORY

Event Type Distribution:
- click: 68 (Navigation, expand/collapse, detail views)
- keydown: 12 (Escape, Enter, Arrow keys)
- input: 6 (Search/filter, composer resize)
- scroll: 2 (Trace panel pinning, visibility)
- dblclick: 3 (Row selection)
- mouseenter: 3 (Hover previews)
- mouseleave: 2 (Close hover previews)
- mousedown/move/up: 3 (Resize drag)
- resize: 2 (Panel adjustment)
- blur: 1 (Filter collapse)
- touchstart/end: 1 (Carousel swipe)

Global Event Listeners:
- Escape key: Closes trace panel, notebook detail, command palette
- Document click: Dismisses popovers, source pops, backlink panels
- Ctrl+K / Cmd+K: Toggle command palette
- Arrow keys: Navigate palette results

---

## 3. REPORTS NOTEBOOK VIEW - EXPANSION SYSTEM

Data Structures (Lines 8022-8368):

1. MENTION_DATA (line 8023)
   Keys: entity IDs
   Fields: name, kind, summary, claims[], edges[], refs[]
   Drives: .nb-mention clickable chips & reference blocks

2. SOURCE_DATA (line 8291)
   Keys: source IDs
   Fields: title, url, snippet, date, type
   Drives: Source popovers (.nb-source-pop)

3. WIKI_DATA (line 8347)
   Keys: entity IDs
   Fields: title, body (HTML), refs[]
   Drives: Wiki expansions (.nb-wiki-expand)

4. BACKLINK_REGISTRY (line 8460)
   Keys: entity names
   Fields: Array of {from, type, context, confidence}
   Drives: Backlink panel visualization

5. NAME_TO_ENTITY_ID (line 8500)
   Map: display name -> MENTION_DATA key

### Layer 1: Mention Chips & Expansion
Function: toggleMentionExpand(mention) (Lines 8161-8190)

Mechanism:
1. Check if already expanded (look for .nb-ref-expand[data-entity])
2. If exists: remove it -> toggle OFF
3. If not: close siblings, add .expanded, insert .nb-ref-expand block
4. Wire close button to remove block
5. Wire agent button to trigger triggerAgentExpand()

State Tracking:
- mention.classList.contains('expanded') tracks UI state
- activeSrcPop (global) holds current source popover

Depth Limit: getExpandDepth(el) counts nested .nb-ref-expand ancestors
- MAX_EXPAND_DEPTH = 3 (line 8405)

### Layer 2a: Reference Blocks (.nb-ref-expand)
Builder: buildRefBlock(entityId) (Lines 8100-8159)

Structure:
.nb-ref-expand[data-entity="X"]
  ├─ .nb-ref-header (icon, title, close button)
  ├─ .nb-ref-body (summary, claims, edges)
  └─ .nb-ref-actions (agent button, open report, backlinks)

### Layer 2b: Source Popovers
Function: showSourcePop(srcEl) (Lines 8309-8341)

Behavior:
1. Remove previous pop if exists
2. Parse source ID from element text
3. Create .nb-source-pop div with title, URL, snippet, date, type
4. Position relative to source element + editor bounds
5. Setup document click listener to close on outside click

Dismissal: Document click outside -> remove pop, set activeSrcPop = null

### Layer 2c: Wiki Expansions
Function: toggleWikiExpand(mention) (Lines 8370-8402)

Similar to mention expand, but renders wiki data

### Layer 3: Agent Expansion Sequences
Function: triggerAgentExpand(entityId, refBlock) (Lines 8192-8240)

Animation: 5-step sequence over ~5 seconds
Step 1: Searching Linkup... (active)
Step 2: Fetching 3 source URLs (starts at 1000ms)
Step 3: Extracting claims (starts at 2000ms)
Step 4: Cross-referencing (starts at 3000ms)
Step 5: Finalizing (starts at 4000ms)

---

## 4. BACKLINK PANEL & GRAPH EXPANSION

Function: showBacklinkPanel(blEl) (Lines 8505-8600)
State: activeBlPanel global variable

Behavior:
1. Remove previous panel if exists
2. Get entity ID from backlink element
3. Lookup BACKLINK_REGISTRY for incoming relationships
4. Build relationship visualization with confidence scores
5. Position panel near the clicked element
6. Wire click handlers on edges

Related: scrollToAndExpandEntity(entityId) (Lines 8603-8630)
- Finds target mention in notebook
- Scrolls to view with smooth behavior
- After 400ms delay, calls toggleMentionExpand(target)

---

## 5. CHAT SURFACE - TRACE WATERFALL & REVIEW PANELS

### Trace Waterfall Panel (Lines 7152-7218)
Key Function: pinTracePanel() - Adjusts top/height for scroll offset
Triggered on: scroll (traceChatMain), resize (window)

Row Expand/Collapse:
- Click .wf-row[data-wf-expand] -> toggle child visibility
- Toggles .wf-row--expanded class + display:none/block

Cross-Surface Links:
- Click .wf-link -> e.stopPropagation()
- Reads data-trace-surface and data-trace-target
- Closes trace panel + switches surface or calls openArtifact()

### Review Panels (Lines 7250-7333)

Opening: Click [data-review-target] button -> adds .open class
Closing: Click [data-review-close] button -> calls cleanupPanelClose(panel)

Cleanup Function:
function cleanupPanelClose(p) {
  p.removeAttribute('data-origin-surface')
  p.classList.remove('open', 'show-editor')
  chatMain.classList.remove('artifact-open')
  shell.classList.remove('artifact-in')
  shell.removeAttribute('data-artifact-open')
}

Helper: closeAllReviewPanels() (Line 7296)
- Closes all .chat-review.open panels

---

## 6. STATE MANAGEMENT & GLOBAL VARIABLES

UI State Variables:

activeCollectionView (string): Tracks Reports view (gallery/board/table/graph)
activeSrcPop (DOM element or null): Current source popover
activeBlPanel (DOM element or null): Current backlink panel
currentNotebookEntity (string or null): Which entity is open in notebook
hoverTimeout (number): setTimeout ID for hover preview delay

---

## 7. DISMISSAL & EVENT COORDINATION

stopPropagation Usage (Prevents parent click handlers):
- Close buttons (.nb-ref-close, .nb-wiki-close)
- Agent buttons inside ref blocks
- Nested mention clicks inside expanded blocks
- Cross-surface trace links (.wf-link)
- Review panel buttons

Dismissal Patterns:

Pattern 1: Click Outside (Active Popover)
setTimeout(() => {
  document.addEventListener('click', function closePop(e) {
    if (pop && !pop.contains(e.target) && e.target !== srcEl) {
      pop.remove()
      activeSrcPop = null
      document.removeEventListener('click', closePop)
    }
  })
})
Why setTimeout? Prevents the click that opened the popover from immediately closing it

Pattern 2: Escape Key
Global keydown listener closes panels

Pattern 3: Explicit Button Click
Direct close button removes element

Artifact Overlay Cleanup (Triggered on):
1. Surface switch
2. Review panel close
3. Chat view transitions

Actions:
- Remove .artifact-in class from shell
- Remove data-artifact-open attribute
- Close all .chat-review.open panels
- Remove .show-editor class
- Remove artifact-open class from .chat-main

---

## 8. ANIMATION & TIMER-BASED LOGIC

Agent Expansion Sequence: ~5 seconds total
Typing Indicator: CSS animation with staggered delays (0s, 0.15s, 0.3s)

Timeouts:
- 300ms: Source editor live update debounce
- 350ms: After backlink edge click, toggle mention expansion
- 400ms: Hover preview delay, highlight background reset
- 650ms: Reapply topological overlays after graph update

---

## 9. RIGHT RAIL INSPECTOR (Chat Surface)

HTML: Lines 4547-4640
Data: inspectorData object (line 7902+)

Function: updateInspector(name) (Lines 7913-7945)

Updates:
1. ar-agent-meta: type · status · sources count
2. ar-pills: context pills
3. ar-pipeline: progress indicator
4. ar-transparency: evidence, freshness, sources, coverage

---

## 10. FILTER & SEARCH INTERACTION

### Command Palette (Ctrl+K)

Input Handling:
- input event: rerenders results
- keydown ArrowDown/Up: navigate results (activeIdx++)
- keydown Enter: confirm selection + close
- keydown Escape: close palette

### Vertex Filter (Graph View)

Behavior:
- Click to expand filter
- Input event: renders matching vertices
- Blur event: collapse filter if empty

---

## 11. KEYBOARD ACCESSIBILITY

Tab Navigation Order:
1. Topbar buttons
2. Tab switches
3. Mentions/entities
4. Buttons in ref blocks/popovers
5. Close buttons

No tabindex > 0 hardcoding — follows natural DOM order

ARIA Attributes:
- .topbar-nav button: aria-label
- .view-tab: aria-selected
- nav dots: aria-label
- .chat-ctx-tab: aria-selected
- .nb-mention: data-entity, data-kind

---

## 12. COMPLETE FUNCTION ROSTER (23 KEY INTERACTIVE)

1. toggleTheme (7042)
2. switchSurface (7051)
3. cleanupPanelClose (7285)
4. closeAllReviewPanels (7296)
5. closeArtifact (7717)
6. switchView (7823)
7. closeNotebook (7889)
8. toggleMentionExpand (8161)
9. triggerAgentExpand (8192)
10. showSourcePop (8309)
11. toggleWikiExpand (8370)
12. getExpandDepth (8405)
13. showBacklinkPanel (8505)
14. scrollToAndExpandEntity (8603)
15. showHoverPreview (8632)
16. toggleInspector (8834)
17. showPeek (9372)
18. switchGraphMode (10043)
19. toggleTopoOverlay (10319)
20. closePalette (10489)
21. expandFilter (10624)
22. collapseFilter (10631)
23. showEvidencePopup (10807)

---

## 13. GAPS & POTENTIAL ISSUES

Not Fully Wired:
- Inbox and Me surfaces (only stub HTML — planned for separate implementation pass)
- Review panel editor save/submit buttons
- Artifact code block interactions

Potential Issues:
1. ~~activeSrcPop reset~~ FIXED — toggleWikiExpand already cleans up activeSrcPop (line 8371)
2. ~~MAX_EXPAND_DEPTH enforcement in backlink panel~~ FIXED — G4: depth check added to edge click handler
3. ~~Trace panel pin for dynamic resize~~ FIXED — G5: ResizeObserver added for content changes
4. ~~Event listener cleanup~~ FIXED — G6: Named functions with cleanup on re-attach for source pop and backlink panel dismiss listeners

Accessibility — FIXED:
- ~~No role="button" on divs with onclick~~ FIXED — G7: All div[onclick] elements now have role="button", tabindex="0", and onkeydown handlers (Enter/Space)
- ~~Source popover not announced to screen readers~~ FIXED — G8: Source popovers have role="dialog" + aria-label + aria-live="polite"; backlink panels have role="dialog" + aria-label
- ~~No keyboard shortcut hints~~ FIXED — G9: Escape key hints added to trace close button and notebook back button

Agent Expansion — FIXED:
- ~~Agent expansion completion (no data insertion)~~ FIXED — G10: New claim [src:new] badges are wired as interactive with click + keyboard handlers for source popovers

---

## 14. ARCHITECTURAL PATTERNS

1. Layered expansion: Mention -> Ref Block -> (Wiki | Agent) -> Nested Mentions (depth 3)
2. Transient state: Source pops, backlink panels, overlays dismissed explicitly
3. Event coordination: stopPropagation prevents bubbling; setTimeout prevents re-triggering
4. Data-driven UI: MENTION_DATA, WIKI_DATA, SOURCE_DATA, BACKLINK_REGISTRY power expansions

---

## 15. PRODUCTION RECOMMENDATIONS

- Component encapsulation (React/Web Components instead of loose functions)
- Proper focus management for keyboard users
- Event listener cleanup (avoid global document listeners)
- Performance optimization (memoize MENTION_DATA lookups, defer rendering)
- Complete Inbox/Me surfaces
- Consistent event listener cleanup patterns

---

End of Audit
