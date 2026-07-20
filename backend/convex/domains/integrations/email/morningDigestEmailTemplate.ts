/**
 * Morning Digest Email Template Generator
 * 
 * Generates clean, newsletter-style HTML emails for the daily morning digest
 * Includes today's meeting reminders and key briefing highlights
 */

export interface MeetingReminder {
  title: string;
  startTime: number; // Unix timestamp ms
  endTime?: number;
  location?: string;
  description?: string;
  allDay?: boolean;
}

export interface BriefingHighlight {
  title: string;
  summary: string;
  source?: string;
  url?: string;
  category?: 'market' | 'news' | 'research' | 'social' | 'other';
}

export interface MorningDigestEmailData {
  recipientName?: string;
  dateString: string; // e.g., "Monday, December 16, 2025"
  meetings: MeetingReminder[];
  highlights?: BriefingHighlight[];
  marketSummary?: string;
  topInsight?: string;
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
  warning: '#f9ab00',
  error: '#d93025',
  calendar: '#0d652d',
  calendarLight: '#e6f4ea',
};

/**
 * Format time from timestamp to readable string
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Generate the email header
 */
function generateHeader(data: MorningDigestEmailData): string {
  const greeting = data.recipientName ? `Good morning, ${data.recipientName}` : 'Good morning';
  
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${COLORS.primary}; padding: 32px 24px;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="color: #ffffff;">
                <h1 style="margin: 0 0 8px 0; font-size: 28px; font-weight: 600;">${greeting}</h1>
                <p style="margin: 0; font-size: 16px; opacity: 0.9;">Your Morning Dossier • ${data.dateString}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Generate the meetings section
 */
function generateMeetingsSection(meetings: MeetingReminder[]): string {
  if (meetings.length === 0) {
    return `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
        <tr>
          <td style="padding: 20px; background-color: ${COLORS.calendarLight}; border-radius: 8px; border-left: 4px solid ${COLORS.calendar};">
            <h2 style="margin: 0 0 8px 0; font-size: 18px; color: ${COLORS.calendar};">📅 Today's Schedule</h2>
            <p style="margin: 0; color: ${COLORS.textSecondary}; font-size: 14px;">No meetings scheduled for today. Time for deep work!</p>
          </td>
        </tr>
      </table>
    `;
  }

  const meetingRows = meetings.map((meeting, index) => {
    const timeStr = meeting.allDay 
      ? 'All Day' 
      : meeting.endTime 
        ? `${formatTime(meeting.startTime)} - ${formatTime(meeting.endTime)}`
        : formatTime(meeting.startTime);
    
    const locationStr = meeting.location 
      ? `<span style="color: ${COLORS.textMuted}; font-size: 12px;">📍 ${meeting.location}</span>` 
      : '';

    return `
      <tr>
        <td style="padding: 12px 0; border-bottom: ${index < meetings.length - 1 ? `1px solid ${COLORS.border}` : 'none'};">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="100" valign="top" style="padding-right: 16px;">
                <span style="font-size: 14px; font-weight: 600; color: ${COLORS.primary};">${timeStr}</span>
              </td>
              <td valign="top">
                <div style="font-size: 15px; font-weight: 500; color: ${COLORS.text}; margin-bottom: 4px;">${meeting.title}</div>
                ${locationStr}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 20px; background-color: ${COLORS.calendarLight}; border-radius: 8px; border-left: 4px solid ${COLORS.calendar};">
          <h2 style="margin: 0 0 16px 0; font-size: 18px; color: ${COLORS.calendar};">📅 Today's Meetings (${meetings.length})</h2>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${meetingRows}
          </table>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Generate highlights section
 */
function generateHighlightsSection(highlights: BriefingHighlight[]): string {
  if (!highlights || highlights.length === 0) return '';

  const highlightRows = highlights.map((h, index) => `
    <tr>
      <td style="padding: 16px 0; border-bottom: ${index < highlights.length - 1 ? `1px solid ${COLORS.border}` : 'none'};">
        <div style="font-size: 15px; font-weight: 500; color: ${COLORS.text}; margin-bottom: 4px;">${h.title}</div>
        <div style="font-size: 14px; color: ${COLORS.textSecondary}; margin-bottom: 8px;">${h.summary}</div>
        ${h.source ? `<span style="font-size: 12px; color: ${COLORS.textMuted};">${h.source}</span>` : ''}
      </td>
    </tr>
  `).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 20px; background-color: ${COLORS.backgroundSecondary}; border-radius: 8px;">
          <h2 style="margin: 0 0 16px 0; font-size: 18px; color: ${COLORS.text};">🔔 Key Signals</h2>
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${highlightRows}
          </table>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Generate top insight callout
 */
function generateTopInsight(insight: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 20px; background-color: ${COLORS.primaryLight}; border-radius: 8px; border-left: 4px solid ${COLORS.primary};">
          <div style="font-size: 13px; font-weight: 600; color: ${COLORS.primary}; margin-bottom: 8px;">💡 TODAY'S INSIGHT</div>
          <div style="font-size: 15px; color: ${COLORS.text}; line-height: 1.5;">${insight}</div>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Generate email footer
 */
function generateFooter(): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 32px; padding-top: 24px; border-top: 1px solid ${COLORS.border};">
      <tr>
        <td align="center" style="color: ${COLORS.textMuted}; font-size: 12px;">
          <p style="margin: 0 0 8px 0;">Powered by <strong style="color: ${COLORS.text};">Nodebench AI</strong></p>
          <p style="margin: 0;">Your daily intelligence briefing, delivered automatically.</p>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Generate complete morning digest email
 */
export function generateMorningDigestEmail(data: MorningDigestEmailData): string {
  const sections: string[] = [];

  // Header
  sections.push(generateHeader(data));

  // Body wrapper
  const bodyStart = `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${COLORS.background};">
      <tr>
        <td align="center" style="padding: 32px 24px;">
          <table width="600" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
  `;

  const bodyEnd = `
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  // Content sections
  const content: string[] = [];
  
  // Top insight (if present)
  if (data.topInsight) {
    content.push(generateTopInsight(data.topInsight));
  }

  // Meetings section (always show)
  content.push(generateMeetingsSection(data.meetings));

  // Highlights section (if present)
  if (data.highlights && data.highlights.length > 0) {
    content.push(generateHighlightsSection(data.highlights));
  }

  // Footer
  content.push(generateFooter());

  sections.push(bodyStart);
  sections.push(content.join(''));
  sections.push(bodyEnd);

  // Wrap in HTML document
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Morning Dossier - ${data.dateString}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  ${sections.join('')}
</body>
</html>
  `.trim();
}

