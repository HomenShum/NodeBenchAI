/**
 * Dossier Email Template Generator
 * 
 * Generates clean, newsletter-style HTML emails that mirror the web dossier structure
 * Optimized for email clients (Gmail, Outlook, Apple Mail) with inline styles and table layouts
 */

export interface EmailCompanyOverview {
  name: string;
  description: string;
  headquarters?: string;
  website?: string;
  founded?: string;
  industry?: string;
  employeeCount?: string;
  stage?: string;
}

export interface EmailFounder {
  name: string;
  role: string;
  bio?: string;
  linkedin?: string;
  twitter?: string;
}

export interface EmailFundingRound {
  round: string;
  amount: string;
  date: string;
  investors?: string[];
}

export interface EmailFunding {
  totalRaised: string;
  latestRound?: EmailFundingRound;
  rounds?: EmailFundingRound[];
  keyInvestors?: string[];
}

export interface EmailResearchLink {
  title: string;
  url: string;
  source?: string;
  date?: string;
  type?: 'news' | 'research' | 'document' | 'video' | 'other';
  snippet?: string;
}

export interface DossierEmailData {
  title: string;
  companyOverview?: EmailCompanyOverview;
  founders?: EmailFounder[];
  funding?: EmailFunding;
  researchLinks?: EmailResearchLink[];
  highlightedQuote?: {
    text: string;
    author?: string;
  };
}

// Color palette matching NodeBench design
const COLORS = {
  primary: '#1a73e8',
  primaryLight: '#e8f0fe',
  text: '#202124',
  textSecondary: '#5f6368',
  textMuted: '#80868b',
  border: '#dadce0',
  background: '#ffffff',
  backgroundSecondary: '#f8f9fa',
  success: '#1e8e3e',
  error: '#d93025',
};

/**
 * Generate complete HTML email for a dossier
 */
export function generateDossierEmail(data: DossierEmailData): string {
  const sections: string[] = [];

  // Header
  sections.push(generateEmailHeader(data.title));

  // Highlighted Quote (if present)
  if (data.highlightedQuote) {
    sections.push(generateHighlightedQuote(data.highlightedQuote.text, data.highlightedQuote.author));
  }

  // Company Overview
  if (data.companyOverview) {
    sections.push(generateCompanyOverviewSection(data.companyOverview));
  }

  // Founders
  if (data.founders && data.founders.length > 0) {
    sections.push(generateFoundersSection(data.founders));
  }

  // Funding
  if (data.funding) {
    sections.push(generateFundingSection(data.funding));
  }

  // Research Links
  if (data.researchLinks && data.researchLinks.length > 0) {
    sections.push(generateResearchLinksSection(data.researchLinks));
  }

  // Footer
  sections.push(generateEmailFooter());

  return wrapEmailTemplate(sections.join('\n'));
}

/**
 * Wrap content in email template structure
 */
function wrapEmailTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NodeBench Dossier Digest</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: ${COLORS.backgroundSecondary};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${COLORS.backgroundSecondary};">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: ${COLORS.background}; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          ${content}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate email header
 */
function generateEmailHeader(title: string): string {
  return `
<tr>
  <td style="padding: 32px 32px 24px; background: linear-gradient(135deg, ${COLORS.primary} 0%, #1557b0 100%);">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td>
          <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #ffffff; line-height: 1.3;">
            ${escapeHtml(title)}
          </h1>
          <p style="margin: 8px 0 0; font-size: 14px; color: rgba(255,255,255,0.9);">
            Your personalized dossier digest from NodeBench
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
  `.trim();
}

/**
 * Generate highlighted quote section
 */
function generateHighlightedQuote(text: string, author?: string): string {
  return `
<tr>
  <td style="padding: 24px 32px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="padding: 20px; background-color: ${COLORS.primaryLight}; border-left: 4px solid ${COLORS.primary}; border-radius: 4px;">
          <p style="margin: 0; font-size: 16px; font-style: italic; color: ${COLORS.text}; line-height: 1.6;">
            "${escapeHtml(text)}"
          </p>
          ${author ? `<p style="margin: 12px 0 0; font-size: 14px; font-weight: 600; color: ${COLORS.textSecondary};">— ${escapeHtml(author)}</p>` : ''}
        </td>
      </tr>
    </table>
  </td>
</tr>
  `.trim();
}

/**
 * Generate company overview section
 */
function generateCompanyOverviewSection(data: EmailCompanyOverview): string {
  const stats: string[] = [];
  
  if (data.founded) stats.push(`<td style="padding: 12px; text-align: center; background-color: ${COLORS.backgroundSecondary}; border-radius: 4px;"><div style="font-size: 11px; font-weight: 600; color: ${COLORS.textSecondary}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Founded</div><div style="font-size: 20px; font-weight: 700; color: ${COLORS.text};">${escapeHtml(data.founded)}</div></td>`);
  if (data.employeeCount) stats.push(`<td style="padding: 12px; text-align: center; background-color: ${COLORS.backgroundSecondary}; border-radius: 4px;"><div style="font-size: 11px; font-weight: 600; color: ${COLORS.textSecondary}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Employees</div><div style="font-size: 20px; font-weight: 700; color: ${COLORS.text};">${escapeHtml(data.employeeCount)}</div></td>`);
  if (data.stage) stats.push(`<td style="padding: 12px; text-align: center; background-color: ${COLORS.backgroundSecondary}; border-radius: 4px;"><div style="font-size: 11px; font-weight: 600; color: ${COLORS.textSecondary}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Stage</div><div style="font-size: 20px; font-weight: 700; color: ${COLORS.text};">${escapeHtml(data.stage)}</div></td>`);

  return `
<tr>
  <td style="padding: 24px 32px;">
    <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: ${COLORS.text};">
      🏢 Company Overview
    </h2>
    <h3 style="margin: 0 0 8px; font-size: 24px; font-weight: 700; color: ${COLORS.text};">
      ${escapeHtml(data.name)}
    </h3>
    ${data.industry ? `<span style="display: inline-block; padding: 4px 12px; font-size: 12px; font-weight: 600; color: ${COLORS.primary}; background-color: ${COLORS.primaryLight}; border-radius: 12px; margin-bottom: 12px;">${escapeHtml(data.industry)}</span>` : ''}
    <p style="margin: 12px 0; font-size: 15px; color: ${COLORS.text}; line-height: 1.6;">
      ${escapeHtml(data.description)}
    </p>
    ${stats.length > 0 ? `
    <table role="presentation" cellspacing="8" cellpadding="0" border="0" width="100%" style="margin: 16px 0;">
      <tr>${stats.join('')}</tr>
    </table>
    ` : ''}
    ${data.headquarters || data.website ? `
    <div style="margin-top: 16px; font-size: 14px; color: ${COLORS.textSecondary};">
      ${data.headquarters ? `📍 ${escapeHtml(data.headquarters)}` : ''}
      ${data.headquarters && data.website ? ' • ' : ''}
      ${data.website ? `<a href="${escapeHtml(data.website)}" style="color: ${COLORS.primary}; text-decoration: none;">🌐 Visit Website</a>` : ''}
    </div>
    ` : ''}
  </td>
</tr>
  `.trim();
}

/**
 * Generate founders section
 */
function generateFoundersSection(founders: EmailFounder[]): string {
  const founderCards = founders.map(founder => `
    <tr>
      <td style="padding: 16px; background-color: ${COLORS.backgroundSecondary}; border-radius: 8px; margin-bottom: 12px;">
        <h4 style="margin: 0 0 4px; font-size: 16px; font-weight: 600; color: ${COLORS.text};">
          ${escapeHtml(founder.name)}
        </h4>
        <p style="margin: 0 0 8px; font-size: 14px; color: ${COLORS.textSecondary};">
          ${escapeHtml(founder.role)}
        </p>
        ${founder.bio ? `<p style="margin: 0 0 12px; font-size: 14px; color: ${COLORS.text}; line-height: 1.5;">${escapeHtml(founder.bio.slice(0, 150))}${founder.bio.length > 150 ? '...' : ''}</p>` : ''}
        ${founder.linkedin || founder.twitter ? `
        <div style="margin-top: 8px;">
          ${founder.linkedin ? `<a href="${escapeHtml(founder.linkedin)}" style="display: inline-block; margin-right: 12px; color: ${COLORS.primary}; text-decoration: none; font-size: 13px;">🔗 LinkedIn</a>` : ''}
          ${founder.twitter ? `<a href="${escapeHtml(founder.twitter)}" style="display: inline-block; color: ${COLORS.primary}; text-decoration: none; font-size: 13px;">🐦 Twitter</a>` : ''}
        </div>
        ` : ''}
      </td>
    </tr>
    <tr><td style="height: 12px;"></td></tr>
  `).join('');

  return `
<tr>
  <td style="padding: 24px 32px;">
    <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: ${COLORS.text};">
      👥 Founders & Team <span style="display: inline-block; padding: 2px 8px; font-size: 12px; font-weight: 600; color: ${COLORS.primary}; background-color: ${COLORS.primaryLight}; border-radius: 10px; margin-left: 8px;">${founders.length}</span>
    </h2>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      ${founderCards}
    </table>
  </td>
</tr>
  `.trim();
}

/**
 * Generate funding section
 */
function generateFundingSection(data: EmailFunding): string {
  const roundsHtml = data.rounds && data.rounds.length > 1 ? `
    <div style="margin-top: 20px;">
      <h4 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: ${COLORS.text};">Funding History</h4>
      ${data.rounds.map(round => `
        <div style="padding: 12px; background-color: ${COLORS.backgroundSecondary}; border-radius: 4px; margin-bottom: 8px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
              <td>
                <div style="font-size: 14px; font-weight: 600; color: ${COLORS.text};">${escapeHtml(round.round)}</div>
                <div style="font-size: 12px; color: ${COLORS.textSecondary};">${escapeHtml(round.date)}</div>
              </td>
              <td style="text-align: right;">
                <div style="font-size: 14px; font-weight: 700; color: ${COLORS.primary};">${escapeHtml(round.amount)}</div>
              </td>
            </tr>
          </table>
        </div>
      `).join('')}
    </div>
  ` : '';

  const investorsHtml = data.keyInvestors && data.keyInvestors.length > 0 ? `
    <div style="margin-top: 20px;">
      <h4 style="margin: 0 0 12px; font-size: 14px; font-weight: 600; color: ${COLORS.text};">Key Investors</h4>
      <div>
        ${data.keyInvestors.map(investor => `<span style="display: inline-block; padding: 6px 12px; margin: 0 8px 8px 0; font-size: 13px; font-weight: 600; color: ${COLORS.primary}; background-color: ${COLORS.primaryLight}; border-radius: 12px;">${escapeHtml(investor)}</span>`).join('')}
      </div>
    </div>
  ` : '';

  return `
<tr>
  <td style="padding: 24px 32px;">
    <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: ${COLORS.text};">
      💰 Funding & Investment
    </h2>
    <div style="padding: 20px; background: linear-gradient(to right, ${COLORS.primaryLight}, transparent); border-left: 4px solid ${COLORS.primary}; border-radius: 4px;">
      ${data.latestRound ? `
      <div style="margin-bottom: 8px; font-size: 14px; font-weight: 600; color: ${COLORS.text};">
        Latest Round: ${escapeHtml(data.latestRound.round)}
        <span style="float: right; font-size: 12px; color: ${COLORS.textSecondary};">${escapeHtml(data.latestRound.date)}</span>
      </div>
      ` : ''}
      <div style="font-size: 32px; font-weight: 700; color: ${COLORS.primary}; margin-bottom: 8px;">
        ${escapeHtml(data.totalRaised)}
      </div>
      ${data.latestRound?.investors && data.latestRound.investors.length > 0 ? `
      <div style="margin-top: 12px;">
        <div style="font-size: 12px; font-weight: 600; color: ${COLORS.textSecondary}; margin-bottom: 6px;">Investors:</div>
        <div>
          ${data.latestRound.investors.map(inv => `<span style="display: inline-block; padding: 4px 8px; margin: 0 6px 6px 0; font-size: 12px; color: ${COLORS.text}; background-color: ${COLORS.background}; border: 1px solid ${COLORS.border}; border-radius: 10px;">${escapeHtml(inv)}</span>`).join('')}
        </div>
      </div>
      ` : ''}
    </div>
    ${roundsHtml}
    ${investorsHtml}
  </td>
</tr>
  `.trim();
}

/**
 * Generate research links section
 */
function generateResearchLinksSection(links: EmailResearchLink[]): string {
  const typeEmojis = {
    news: '📰',
    research: '🔬',
    document: '📄',
    video: '🎥',
    other: '🔗',
  };

  const linkCards = links.map(link => `
    <tr>
      <td style="padding: 16px; background-color: ${COLORS.backgroundSecondary}; border-radius: 8px; border: 1px solid ${COLORS.border};">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td style="width: 24px; vertical-align: top; padding-right: 12px;">
              <span style="font-size: 18px;">${typeEmojis[link.type || 'other']}</span>
            </td>
            <td>
              <a href="${escapeHtml(link.url)}" style="font-size: 15px; font-weight: 600; color: ${COLORS.text}; text-decoration: none; display: block; margin-bottom: 4px;">
                ${escapeHtml(link.title)}
              </a>
              ${link.source ? `<div style="font-size: 12px; color: ${COLORS.textSecondary}; margin-bottom: 6px;">${escapeHtml(link.source)}</div>` : ''}
              ${link.snippet ? `<div style="font-size: 13px; color: ${COLORS.textSecondary}; line-height: 1.4; margin-bottom: 8px;">${escapeHtml(link.snippet.slice(0, 120))}${link.snippet.length > 120 ? '...' : ''}</div>` : ''}
              <div style="font-size: 11px; color: ${COLORS.textMuted};">
                ${link.date ? `📅 ${escapeHtml(link.date)}` : ''}
                ${link.date && link.type ? ' • ' : ''}
                ${link.type ? `<span style="padding: 2px 6px; background-color: ${COLORS.background}; border-radius: 8px;">${link.type}</span>` : ''}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr><td style="height: 12px;"></td></tr>
  `).join('');

  return `
<tr>
  <td style="padding: 24px 32px;">
    <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 700; color: ${COLORS.text};">
      📚 Research & Sources <span style="display: inline-block; padding: 2px 8px; font-size: 12px; font-weight: 600; color: ${COLORS.primary}; background-color: ${COLORS.primaryLight}; border-radius: 10px; margin-left: 8px;">${links.length}</span>
    </h2>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      ${linkCards}
    </table>
  </td>
</tr>
  `.trim();
}

/**
 * Generate email footer
 */
function generateEmailFooter(): string {
  return `
<tr>
  <td style="padding: 24px 32px; background-color: ${COLORS.backgroundSecondary}; border-top: 1px solid ${COLORS.border};">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="text-align: center;">
          <p style="margin: 0 0 8px; font-size: 14px; font-weight: 600; color: ${COLORS.text};">
            NodeBench AI
          </p>
          <p style="margin: 0 0 12px; font-size: 12px; color: ${COLORS.textSecondary};">
            Your AI research assistant for dossiers & newsletters
          </p>
          <a href="https://app.nodebench.ai" style="display: inline-block; padding: 10px 24px; font-size: 14px; font-weight: 600; color: #ffffff; background-color: ${COLORS.primary}; border-radius: 6px; text-decoration: none; margin-bottom: 12px;">
            Open in NodeBench
          </a>
          <p style="margin: 12px 0 0; font-size: 11px; color: ${COLORS.textMuted};">
            You're receiving this because you subscribed to daily digests.
            <br>
            <a href="#" style="color: ${COLORS.textMuted}; text-decoration: underline;">Manage preferences</a> • <a href="#" style="color: ${COLORS.textMuted}; text-decoration: underline;">Unsubscribe</a>
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
  `.trim();
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m] || m);
}

