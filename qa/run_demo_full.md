# ScratchNode Full Demo Regression Oracle

The full demo is the product-story oracle. A change is not an improvement if it breaks this loop.

Expected story:

1. Participants enter the event.
2. Public messages appear.
3. A `/ask` parent row appears.
4. A sourced answer appears under the parent question.
5. The answer trace states no private notes were used.
6. A private note is saved outside the public feed.
7. Attendee suggests an answer for FAQ.
8. Host promotes the answer.
9. Public wiki publishes without private notes.
10. User opens NodeBench handoff.
11. NodeBench shows event artifact plus private-note continuation.

Verification command:

```bash
npm run scratchnode:launch:goal
```
