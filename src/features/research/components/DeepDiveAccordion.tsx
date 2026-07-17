"use client";

import React from "react";
import { Sparkles } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ai-ui/accordion";

interface DeepDiveProps {
  title: string;
  content: string;
}

export const DeepDiveAccordion: React.FC<DeepDiveProps> = ({ title, content }) => {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem
        value="deep-dive"
        className="border-b-0 border-l-4 border-slate-900 bg-slate-50 pl-4 transition-colors hover:bg-slate-100"
      >
        <AccordionTrigger className="py-2.5 pr-2 text-left hover:no-underline">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Sparkles className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
            <span>{title}</span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pr-2 pb-2 pt-0 text-sm leading-relaxed text-slate-700">
          {content}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

export default DeepDiveAccordion;
