import { CvNewSection } from "../shared/CvNewSection";

import { HTMLParser } from "@/lib/html-parser";
import type { CommonTextType } from "@/views/cv/common-text.types";

interface CvNewSummaryProps {
  summary: string;
  commonText: CommonTextType;
}

export const CvNewSummary = ({ summary, commonText }: CvNewSummaryProps) => {
  return (
    <CvNewSection title={commonText.text["about-me"] ?? "About Me"} id="about-me">
      <HTMLParser className="text-sm leading-relaxed text-foreground/80 [&>p]:m-0" content={summary} />
    </CvNewSection>
  );
};
