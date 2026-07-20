import React, { useState } from "react";
import {
  Linkedin,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Microscope,
  TrendingUp,
  Shield,
  Handshake,
  Newspaper,
  DollarSign,
} from "lucide-react";

interface LinkedInPostCardProps {
  content?: string | null;
  postType?: string | null;
  persona?: string | null;
  dateString: string;
  postedAt: number;
  postUrl?: string;
  factCheckCount?: number;
  metadata?: Record<string, unknown>;
}

const POST_TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  daily_digest: { label: "Daily Digest", color: "bg-indigo-100 text-indigo-700", icon: Newspaper },
  funding_tracker: { label: "Funding Tracker", color: "bg-indigo-100 text-content-secondary", icon: TrendingUp },
  funding_brief: { label: "Funding Brief", color: "bg-green-100 text-green-700", icon: DollarSign },
  fda: { label: "FDA Updates", color: "bg-red-100 text-red-700", icon: Shield },
  clinical: { label: "Clinical Trials", color: "bg-purple-100 text-purple-700", icon: FlaskConical },
  research: { label: "Research", color: "bg-blue-100 text-blue-700", icon: Microscope },
  ma: { label: "Deals", color: "bg-amber-100 text-amber-700", icon: Handshake },
};

const PERSONA_CONFIG: Record<string, { label: string; color: string }> = {
  GENERAL: { label: "General", color: "bg-surface-secondary text-content-secondary" },
  VC_INVESTOR: { label: "Investor", color: "bg-violet-100 text-violet-600" },
  TECH_BUILDER: { label: "Tech Builder", color: "bg-cyan-100 text-cyan-600" },
  FUNDING: { label: "Funding", color: "bg-indigo-100 text-indigo-600" },
  FDA: { label: "FDA Updates", color: "bg-red-100 text-red-600" },
  CLINICAL: { label: "Clinical Trials", color: "bg-purple-100 text-purple-600" },
  RESEARCH: { label: "Research", color: "bg-blue-100 text-blue-600" },
  MA: { label: "Deals", color: "bg-amber-100 text-amber-600" },
};

const CONTENT_PREVIEW_LENGTH = 400;

export const LinkedInPostCard: React.FC<LinkedInPostCardProps> = ({
  content,
  postType,
  persona,
  dateString,
  postedAt,
  postUrl,
  factCheckCount,
  metadata,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const safePostType = typeof postType === "string" ? postType : "";
  const safePersona = typeof persona === "string" ? persona : "GENERAL";
  const typeConfig = POST_TYPE_CONFIG[safePostType] || POST_TYPE_CONFIG.daily_digest;
  const personaConfig = PERSONA_CONFIG[safePersona] || PERSONA_CONFIG.GENERAL;
  const TypeIcon = typeConfig.icon;
  const safeContent = typeof content === "string" ? content : "";

  const isLong = safeContent.length > CONTENT_PREVIEW_LENGTH;
  const displayContent =
    expanded || !isLong ? safeContent : safeContent.slice(0, CONTENT_PREVIEW_LENGTH) + "...";

  const formattedTime = new Date(postedAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(safeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-surface border border-edge rounded-lg p-4 transition-shadow">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${typeConfig.color}`}>
            <TypeIcon className="w-3 h-3" />
            {typeConfig.label}
          </span>
          {safePersona !== safePostType.toUpperCase() && safePersona !== "FUNDING" && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${personaConfig.color}`}>
              {personaConfig.label}
            </span>
          )}
          {typeof metadata?.part !== "undefined" && (
            <span className="text-xs text-content-muted">
              Part {String(metadata.part)}/{String(metadata.totalParts)}
            </span>
          )}
        </div>
        <span className="text-xs text-content-muted">{formattedTime}</span>
      </div>

      {/* Content */}
      <div className="text-sm text-content whitespace-pre-wrap leading-relaxed font-normal">
        {displayContent}
      </div>

      {/* Expand/collapse */}
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-2 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 transition-colors"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" /> Show more
            </>
          )}
        </button>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-edge">
        <div className="flex items-center gap-3 text-xs text-content-muted">
          {factCheckCount != null && factCheckCount > 0 && (
            <span>{factCheckCount} fact checks</span>
          )}
          <span>{safeContent.length > 60 ? `${Math.ceil(safeContent.length / 200)} min read` : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-content-secondary hover:text-content hover:bg-surface-hover rounded transition-colors"
            title="Copy post text"
          >
            {copied ? <Check className="w-3 h-3 text-indigo-600 dark:text-indigo-400" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
          {postUrl && (
            <a
              href={postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/10 rounded transition-colors"
            >
              <Linkedin className="w-3 h-3" />
              View
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

export default LinkedInPostCard;
