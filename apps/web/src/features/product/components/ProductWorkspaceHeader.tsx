import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ProductWorkspaceHeaderProps = {
  kicker: string;
  title: string;
  description: string;
  aside?: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function ProductWorkspaceHeader({
  kicker,
  title,
  description,
  aside,
  className,
  contentClassName,
}: ProductWorkspaceHeaderProps) {
  return (
    <section
      className={cn(
        "nb-panel flex flex-col gap-3 px-4 py-4 sm:gap-4 sm:px-5 sm:py-5 xl:flex-row xl:items-end xl:justify-between xl:px-6",
        className,
      )}
    >
      <div className={cn("max-w-[760px]", contentClassName)}>
        <div className="nb-section-kicker">{kicker}</div>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[1.06] tracking-tight text-content sm:mt-3 sm:text-3xl md:text-[2.65rem] md:leading-[1.02]">
          {title}
        </h1>
        <p className="mt-2 max-w-[680px] text-sm leading-6 text-content-muted sm:mt-3 sm:leading-7 xl:text-base">
          {description}
        </p>
      </div>
      {aside ? <div className="flex flex-wrap gap-1.5 sm:gap-2 xl:justify-end">{aside}</div> : null}
    </section>
  );
}

export default ProductWorkspaceHeader;
