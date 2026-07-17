/**
 * LegalPage — Tabbed Terms of Service and Privacy Policy.
 */

import { memo, useCallback, useState } from "react";
import { useRevealOnMount } from "@/hooks/useRevealOnMount";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ai-ui/tabs";

type LegalTab = "terms" | "privacy";

const TABS: { id: LegalTab; label: string }[] = [
  { id: "terms", label: "Terms of Service" },
  { id: "privacy", label: "Privacy Policy" },
];

function TermsContent() {
  return (
    <div className="prose-legal space-y-6 text-sm leading-relaxed text-content-secondary">
      <p className="text-[11px] text-content-muted">Last updated: March 2026</p>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">1. Acceptance of Terms</h3>
        <p>
          By accessing or using NodeBench AI ("the Service"), you agree to be bound by these Terms of
          Service. If you do not agree, do not use the Service. We may update these terms at any time
          by posting the revised version on this page.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">2. Description of Service</h3>
        <p>
          NodeBench provides an operational intelligence platform for founders and operators, including
          agent oversight, decision support, initiative tracking, and research intelligence surfaces. The
          Service is provided "as is" and "as available."
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">3. Acceptable Use</h3>
        <p>
          You agree not to: (a) use the Service for any unlawful purpose; (b) attempt to gain
          unauthorized access to any systems or networks; (c) interfere with other users' access to
          the Service; (d) reverse-engineer the Service beyond what applicable law permits; or (e)
          use the Service to build a competing product.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">4. Data Retention</h3>
        <p>
          Agent conversation logs, action receipts, and investigation data are retained for 90 days
          on Free plans and 1 year on Pro plans. Enterprise customers can configure custom retention
          periods. You may export or delete your data at any time from the settings page.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">5. Disclaimer of Warranties</h3>
        <p>
          The Service is provided without warranty of any kind, express or implied. NodeBench does
          not guarantee uninterrupted or error-free operation. Agent outputs, research signals, and
          investigation results are informational and should not be treated as professional advice.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">6. Limitation of Liability</h3>
        <p>
          To the maximum extent permitted by law, NodeBench shall not be liable for any indirect,
          incidental, special, or consequential damages arising from your use of the Service,
          including but not limited to loss of data, revenue, or business opportunities.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">7. Termination</h3>
        <p>
          Either party may terminate access at any time. We may suspend or terminate your account if
          you violate these terms. Upon termination, your right to use the Service ceases immediately.
          We will make your data available for export for 30 days after termination.
        </p>
      </section>
    </div>
  );
}

function PrivacyContent() {
  return (
    <div className="prose-legal space-y-6 text-sm leading-relaxed text-content-secondary">
      <p className="text-[11px] text-content-muted">Last updated: March 2026</p>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">1. What We Collect</h3>
        <p>
          We collect: (a) account information (email, name) when you sign up; (b) usage analytics
          (pages visited, features used, session duration); (c) agent conversation logs and action
          receipts generated during your use of the platform; (d) technical data (browser type, OS,
          IP address) for performance monitoring.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">2. How We Store It</h3>
        <p>
          All data is stored in Convex, a real-time database with encryption at rest and in transit.
          Conversation logs and action receipts are scoped to your account and not accessible by
          other users. Backups are retained for 30 days and then permanently deleted.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">3. Who Has Access</h3>
        <p>
          Only you can access your data through the NodeBench dashboard. Our engineering team may
          access anonymized, aggregated metrics for service improvement. We do not grant access to
          individual account data except when required by law or with your explicit consent.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">4. No Selling to Third Parties</h3>
        <p>
          We do not sell, rent, or share your personal data or conversation logs with third parties
          for advertising or marketing purposes. Period. We may share anonymized, aggregate statistics
          (e.g., "X% of users run investigations weekly") in public materials.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">5. Cookies and Analytics</h3>
        <p>
          We use essential cookies for authentication and session management. We use privacy-respecting
          analytics (no cross-site tracking) to understand feature usage. You can disable non-essential
          cookies in your browser settings.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">6. Your Rights</h3>
        <p>
          You can export all your data at any time from settings. You can request deletion of your
          account and all associated data by contacting support. We will process deletion requests
          within 30 days. If you are in the EU, you have additional rights under GDPR including the
          right to access, rectification, and portability.
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-base font-semibold text-content">7. Contact</h3>
        <p>
          For privacy-related questions, contact us at privacy@nodebench.ai. We aim to respond to
          all inquiries within 5 business days.
        </p>
      </section>
    </div>
  );
}

export const LegalPage = memo(function LegalPage() {
  const { ref: revealRef, isVisible, instant } = useRevealOnMount();
  const [activeTab, setActiveTab] = useState<LegalTab>("terms");

  const stagger = useCallback(
    (delay: string): React.CSSProperties => ({
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? "none" : "translateY(8px)",
      transition: instant ? "none" : "opacity 0.3s ease-out, transform 0.3s ease-out",
      transitionDelay: instant ? "0s" : delay,
    }),
    [isVisible, instant],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div ref={revealRef} className="mx-auto max-w-3xl px-6 py-16">
        {/* Header */}
        <div style={stagger("0s")} className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-content">Legal</h1>
          <p className="mt-3 text-base text-content-secondary">
            How NodeBench handles your data and what you agree to.
          </p>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as LegalTab)}
          className="contents"
        >
        {/* Tabs */}
        <TabsList style={stagger("0.1s")} className="mb-8 flex h-auto justify-center gap-2 bg-transparent p-0" aria-label="Legal documents">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-all data-[state=active]:bg-white/[0.08] data-[state=active]:text-content data-[state=active]:shadow-none ${
                activeTab === tab.id
                  ? "bg-white/[0.08] text-content"
                  : "text-content-muted hover:bg-white/[0.04] hover:text-content-secondary"
              }`}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Content */}
        <TabsContent
          value="terms"
          style={stagger("0.2s")}
          className="mt-0 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-8"
        >
          <TermsContent />
        </TabsContent>
        <TabsContent
          value="privacy"
          style={stagger("0.2s")}
          className="mt-0 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-8"
        >
          <PrivacyContent />
        </TabsContent>
        </Tabs>
      </div>
    </div>
  );
});

export default LegalPage;
