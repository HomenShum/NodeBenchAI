/**
 * Footnote — inline `<sup>` superscript that links to a footnote
 * anchor at the bottom of the editorial home.  IDs follow the
 * convention `fn-<slug>`; the matching `<li id="fn-<slug>">` lives in
 * <FootnoteList>.
 */

interface Props {
  id: string;
  index: number;
  label?: string;
}

export function Footnote({ id, index, label }: Props) {
  return (
    <sup className="rd-edition-footnote-ref" data-footnote={id}>
      <a href={`#fn-${id}`} aria-label={label ?? `Footnote ${index}`}>
        {index}
      </a>
    </sup>
  );
}
