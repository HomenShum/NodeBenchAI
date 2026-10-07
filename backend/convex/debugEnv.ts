import { action } from "./_generated/server";

export const listEnvVars = action({
  args: {},
  handler: async () => {
    return {
      hasXAI: !!process.env.XAI_API_KEY,
      hasGitHub: !!process.env.GITHUB_TOKEN,
      hasOpenRouter: !!process.env.OPENROUTER_API_KEY,
      xaiKeyLength: process.env.XAI_API_KEY?.length || 0,
      allKeys: Object.keys(process.env).filter(k => k.includes('XAI') || k.includes('GITHUB')),
    };
  },
});
