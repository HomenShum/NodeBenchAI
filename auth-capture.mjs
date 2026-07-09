/**
 * Self-serve a real authed session for proof-looping depth tests — NO human needed for the
 * non-OAuth providers. Tries, in order: anonymous/guest sign-in, then email+password signup.
 * On success writes storageState -> auth.json. Captures screenshots of each step (honest evidence).
 * Run: BASE_URL=https://www.nodebenchai.com node auth-capture.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = (process.env.BASE_URL ?? "https://www.nodebenchai.com").replace(/\/$/, "");
const OUT = ".proofloop-auth";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const log = (...a) => console.log(...a);

async function authed() {
  // authed signal: the composer is usable (placeholder Message/Ask) OR a known authed-only control shows
  const composer = page.getByPlaceholder(/message|ask about|^ask|research/i).first();
  if (await composer.isVisible().catch(() => false)) return true;
  const signInWall = await page.getByText(/sign in to|log in to|sign in required|authentication required/i).first().isVisible().catch(() => false);
  return !signInWall && (await composer.isVisible().catch(() => false));
}

let method = "none";
try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/01-landing.png` });

  // open the sign-in surface
  const signInBtn = page.getByRole("button", { name: /sign in|log in|get started|sign up/i }).first();
  if (await signInBtn.isVisible().catch(() => false)) { await signInBtn.click().catch(() => {}); await page.waitForTimeout(1500); }
  await page.screenshot({ path: `${OUT}/02-auth-options.png` });

  // STRATEGY 1: anonymous / guest
  const guest = page.getByRole("button", { name: /guest|anonymous|continue without|try.*free|skip sign/i }).first();
  if (await guest.isVisible().catch(() => false)) {
    log("trying anonymous/guest…");
    await guest.click().catch(() => {});
    await page.waitForTimeout(3000);
    if (await authed()) method = "anonymous";
  }

  // STRATEGY 2: email + password signup
  if (method === "none") {
    log("trying email+password signup…");
    // reveal a sign-up form if there's a toggle
    const signUpToggle = page.getByRole("button", { name: /sign up|create.*account|register/i }).first();
    if (await signUpToggle.isVisible().catch(() => false)) { await signUpToggle.click().catch(() => {}); await page.waitForTimeout(800); }
    const email = page.getByPlaceholder(/email/i).first();
    const pass = page.getByPlaceholder(/password/i).first();
    if (await email.isVisible().catch(() => false) && await pass.isVisible().catch(() => false)) {
      const addr = `proofloop.bot.${Math.abs(Date.now() % 1e7)}@example.com`;
      await email.fill(addr);
      await pass.fill("ProofLoop!" + (Date.now() % 1e6));
      await page.screenshot({ path: `${OUT}/03-filled.png` });
      const submit = page.getByRole("button", { name: /sign up|create|continue|sign in|submit/i }).first();
      await submit.click().catch(() => {});
      await page.waitForTimeout(4000);
      if (await authed()) method = "password";
      log(`(signup email: ${addr})`);
    } else {
      log("no email/password inputs found on the auth surface");
    }
  }

  await page.screenshot({ path: `${OUT}/04-after-auth.png` });
  const ok = await authed();
  log(`\nAUTH RESULT: method=${method} authed=${ok}`);
  if (ok) { await ctx.storageState({ path: "auth.json" }); log("saved -> auth.json"); }
  else { log("could NOT self-serve a session via anonymous/password. Remaining provider: Google OAuth (real human creds)."); }
} catch (e) {
  log("auth-capture error:", String(e?.message ?? e).slice(0, 200));
} finally {
  await page.screenshot({ path: `${OUT}/99-final.png` }).catch(() => {});
  await browser.close();
}
