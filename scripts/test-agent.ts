import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

async function test() {
  const client = new ConvexHttpClient("https://agile-caribou-964.convex.cloud");
  const sessionId = "test_" + Date.now();

  console.log("Creating thread...");
  const threadId = await client.action(
    api.domains.agents.fastAgentPanelStreaming.createThread,
    {
      title: "Test",
      anonymousSessionId: sessionId,
    }
  );
  console.log("Thread ID:", threadId);

  console.log("Sending message with useCoordinator=false...");
  const result = await client.mutation(
    api.domains.agents.fastAgentPanelStreaming.initiateAsyncStreaming,
    {
      threadId,
      prompt: "What is 2+2?",
      anonymousSessionId: sessionId,
      useCoordinator: false, // Use simple agent instead of coordinator
    }
  );
  console.log("Result:", result);

  console.log("Waiting for response (checking every 3 seconds for 2 minutes)...");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));

    const messages = await client.query(
      api.domains.agents.fastAgentPanelStreaming.getAnonymousThreadMessages,
      {
        threadId,
        sessionId,
      }
    );

    const assistantMsgs = messages.filter((m: any) => m.role === "assistant");
    const contentLengths = assistantMsgs.map((m: any) => m.content?.length || 0);

    console.log(
      `Attempt ${i + 1} - Assistant messages: ${assistantMsgs.length}, Content lengths: [${contentLengths.join(", ")}]`
    );

    if (assistantMsgs.some((m: any) => m.content && m.content.length > 0)) {
      console.log("\n✅ SUCCESS! Response received:");
      console.log(
        assistantMsgs.map((m: any) => m.content).join("\n")
      );
      return;
    }
  }

  console.log("\n❌ FAILED: No response received after 2 minutes");
  console.log("Final messages:", JSON.stringify(await client.query(
    api.domains.agents.fastAgentPanelStreaming.getAnonymousThreadMessages,
    { threadId, sessionId }
  ), null, 2));
}

test().catch(console.error);

