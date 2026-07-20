/**
 * Test LinkedIn Posting Integration
 *
 * This script tests the LinkedIn posting functionality using the
 * system-level access token stored in LINKEDIN_ACCESS_TOKEN env var.
 *
 * Usage:
 *   CONVEX_URL=https://formal-shepherd-851.convex.cloud npx tsx scripts/test-linkedin-posting.ts
 *
 * Set DRY_RUN=false to actually post to LinkedIn (default is dry run)
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../backend/convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL || "https://formal-shepherd-851.convex.cloud";
const DRY_RUN = process.env.DRY_RUN !== "false";

async function testLinkedInPosting() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  LinkedIn Posting Test Script");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const client = new ConvexHttpClient(CONVEX_URL);
  console.log(`📡 Connected to: ${CONVEX_URL}`);
  console.log(`🧪 Mode: ${DRY_RUN ? "DRY RUN (no actual post)" : "LIVE (will post to LinkedIn)"}\n`);

  // Test 1: Check LinkedIn account status
  console.log("Step 1: Checking LinkedIn connection status...");
  try {
    const account = await client.query(api.domains.social.linkedinAccounts.getLinkedInAccount, {});

    if (account) {
      console.log("  ✅ User-level LinkedIn account found:");
      console.log(`     Name: ${account.displayName || "(not set)"}`);
      console.log(`     Email: ${account.email || "(not set)"}`);
      console.log(`     URN: ${account.personUrn || "(pending)"}`);
      console.log(`     Expired: ${account.isExpired ? "YES" : "No"}`);
    } else {
      console.log("  ℹ️  No user-level LinkedIn account connected");
      console.log("  ℹ️  Will use system-level LINKEDIN_ACCESS_TOKEN from env\n");
    }
  } catch (error) {
    console.log(`  ⚠️  Could not check account status: ${error}`);
    console.log("  ℹ️  This is normal if not authenticated - system token will be used\n");
  }

  // Test 2: Try to create a post (dry run by default)
  if (!DRY_RUN) {
    console.log("\nStep 2: Creating a test LinkedIn post...");

    const testMessage = `🚀 Testing NodeBench AI's LinkedIn integration!

AI-powered research and analysis platform with:
• Multi-model LLM benchmarking
• Autonomous agent workflows
• Real-time news intelligence

#AI #MachineLearning #NodeBenchAI #LLM`;

    try {
      const result = await client.action(api.domains.social.linkedinPosting.createTextPost, {
        text: testMessage,
      });

      if (result.success) {
        console.log("  ✅ Post created successfully!");
        if (result.postUrl) {
          console.log(`  🔗 View post: ${result.postUrl}`);
        }
        if (result.postUrn) {
          console.log(`  📝 Post URN: ${result.postUrn}`);
        }
      } else {
        console.log(`  ❌ Post failed: ${result.error}`);
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
    }
  } else {
    console.log("\nStep 2: Skipping actual post (DRY_RUN=true)");
    console.log("  ℹ️  To actually post, run with: DRY_RUN=false npx tsx scripts/test-linkedin-posting.ts");
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Test Complete");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("📖 Usage in Agent:");
  console.log('  "Post to LinkedIn: Check out NodeBench AI for LLM benchmarking!"');
  console.log('  "Share on LinkedIn: [your content]"');
  console.log('  "Check my LinkedIn connection"');
}

testLinkedInPosting().catch(console.error);
