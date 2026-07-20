import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Email } from "@convex-dev/auth/providers/Email";
import Google from "@auth/core/providers/google";
import { query, internalQuery } from "../../_generated/server";
import { v } from "convex/values";

const EmailMagicLink = Email({
  // Magic link behavior: skip requiring the email during verification
  authorize: undefined,
  sendVerificationRequest: async (
    { identifier, url, expires },
    // ctx is available for logging if needed
  ) => {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM ?? "Nodebench <no-reply@example.com>";
    try {
      const host = (() => {
        try {
          return new URL(url).host;
        } catch {
          return "(invalid-url)";
        }
      })();
      console.info("Auth: sendVerificationRequest start", {
        to: identifier,
        host,
        expires: expires.toISOString(),
        usingResend: Boolean(apiKey),
        from,
      });
    } catch {
      // Best-effort logging; never crash the flow due to logging
    }
    // Basic email format validation (server-side guard)
    const emailRe = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    if (!emailRe.test(identifier.trim())) {
      console.warn("Auth: invalid email for magic link, skipping send", {
        to: identifier,
      });
      throw new Error("Invalid email address");
    }
    if (apiKey) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(apiKey);
        const result: any = await resend.emails.send({
          from,
          to: [identifier],
          subject: "Your sign-in link",
          html: `
            <p>Click the link below to sign in:</p>
            <p><a href="${url}">Sign in to Nodebench</a></p>
            <p>This link expires at ${expires.toISOString()}.</p>
          `,
        });
        if (result?.error) {
          const message: string = result.error?.message ?? "Resend send failed";
          console.warn("Auth: Resend send returned error", { to: identifier, message });
          // On validation errors, do not fall back to logging the link
          if (message.toLowerCase().includes("invalid `to` field") || message.toLowerCase().includes("validation")) {
            throw new Error("Invalid email address");
          }
          throw new Error(message);
        }
        console.info("Auth: magic link email sent via Resend", { to: identifier });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes("invalid `to` field") || message.toLowerCase().includes("invalid email")) {
          console.warn("Auth: invalid email detected during send, not logging fallback link", { to: identifier });
          throw new Error("Invalid email address");
        }
        console.warn("Auth: Resend send failed, falling back to log.", {
          to: identifier,
          error: message,
        });
        // Fall through to logging below
      }
    }
    // Fallback for development: log the magic link to the server logs
    console.log(
      `Auth: Fallback magic link for ${identifier}: ${url} (expires ${expires.toISOString()})`,
    );
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password, Anonymous, EmailMagicLink, Google],
});

export const loggedInUser = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }
    return user;
  },
});

/**
 * Get user by ID (internal use)
 */
export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});
