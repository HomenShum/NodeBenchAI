import React from "react";

interface SkipLink {
  id: string;
  label: string;
}

interface SkipLinksProps {
  links?: SkipLink[];
}

const DEFAULT_LINKS: SkipLink[] = [
  { id: "main-content", label: "Skip to main content" },
  { id: "main-navigation", label: "Skip to navigation" },
];

export function SkipLinks({ links = DEFAULT_LINKS }: SkipLinksProps) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const target = document.getElementById(id);
    if (target) {
      target.focus();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <nav aria-label="Skip links" className="skip-links">
      {links.map((link) => (
        <a
          key={link.id}
          href={`#${link.id}`}
          onClick={(e) => handleClick(e, link.id)}
          className="
            sr-only focus:not-sr-only
            fixed top-0 left-0 z-[9999]
            m-2 rounded-md
            bg-[var(--accent-primary)] px-4 py-2 text-sm font-medium text-white shadow-lg
            focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] focus:ring-offset-2
            transition-transform
          "
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export default SkipLinks;
