// convex/tools/sendSms.ts
// SMS send tool for Agent component with Twilio A2P 10DLC integration
//
// IMPORTANT: Requires Twilio A2P 10DLC approved campaign for production use.
// Every SMS send is logged to smsLogs table for compliance.

"use node";

import { createTool } from "@convex-dev/agent";
import { z } from "zod";
import { api } from "../_generated/api";

// Simple phone number format validation (E.164 format preferred)
function isValidPhoneNumber(phone: string): boolean {
  // Accept E.164 format (+1XXXXXXXXXX) or 10-digit US numbers
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^\+?1?\d{10,14}$/.test(cleaned);
}

function formatPhoneNumber(phone: string): string {
  // Convert to E.164 format for Twilio
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  return `+${cleaned}`;
}

/**
 * Send an SMS via Twilio with full audit logging
 *
 * Every SMS operation is recorded in the smsLogs table with:
 * - userId, to, body, status, messageSid
 * - Delivery status updates via webhook
 *
 * IMPORTANT: 
 * - SMS requires user's explicit consent (TCPA compliance)
 * - A2P 10DLC campaign must be approved for production
 * - Only send to phone numbers the user has explicitly provided
 */
export const sendSms = createTool({
  description: `Send an SMS text message via Twilio to a phone number.

IMPORTANT RULES:
1. NEVER fabricate or guess phone numbers - only use numbers explicitly provided by user
2. Keep messages concise (160 chars per segment, max 3 segments recommended)
3. Include opt-out instructions for marketing messages ("Reply STOP to unsubscribe")
4. Every send is logged for compliance
5. Requires A2P 10DLC approval for production use

Use this tool when the user explicitly asks to send an SMS or text message.`,

  args: z.object({
    to: z.string().describe("Recipient phone number in E.164 format (+1XXXXXXXXXX) or 10-digit format"),
    body: z.string().max(480).describe("SMS message body - max 480 chars (3 segments). Keep concise."),
  }),

  handler: async (ctx, args): Promise<string> => {
    // Validate phone number
    if (!isValidPhoneNumber(args.to)) {
      return `❌ Invalid phone number format: "${args.to}". Please provide a valid phone number in format +1XXXXXXXXXX or 10 digits.`;
    }

    const formattedPhone = formatPhoneNumber(args.to);

    // Check if Twilio is configured
    const twilioConfigured = Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
    );

    if (!twilioConfigured) {
      return `❌ SMS service not configured. Please set up Twilio credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER) in environment variables.`;
    }

    try {
      // Get userId from context if available
      const userId = (ctx as any).evaluationUserId ?? null;

      // Send SMS via Twilio (uses the internal action)
      await ctx.runAction(api.domains.integrations.sms.sendSms, {
        to: formattedPhone,
        body: args.body,
        userId: userId,
        eventType: "agent_message",
      });

      // Calculate message stats
      const charCount = args.body.length;
      const segments = Math.ceil(charCount / 160);

      return `✅ SMS sent successfully!

📱 To: ${formattedPhone}
📝 Message: "${args.body.slice(0, 50)}${args.body.length > 50 ? '...' : ''}"
📊 Length: ${charCount} chars (${segments} segment${segments > 1 ? 's' : ''})

The message has been queued for delivery. Status updates will be logged automatically.`;

    } catch (error: any) {
      console.error("[sendSms] Error:", error);
      
      // Handle specific Twilio errors
      if (error.message?.includes("unverified")) {
        return `❌ Cannot send SMS: Phone number ${formattedPhone} is not verified. In trial mode, you can only send to verified numbers.`;
      }
      if (error.message?.includes("blacklisted")) {
        return `❌ Cannot send SMS: Phone number ${formattedPhone} has opted out (STOP). The recipient must text START to re-subscribe.`;
      }
      if (error.message?.includes("invalid")) {
        return `❌ Cannot send SMS: Invalid phone number format for ${formattedPhone}.`;
      }
      
      return `❌ Failed to send SMS: ${error.message || "Unknown error"}. Please try again or contact support.`;
    }
  },
});

