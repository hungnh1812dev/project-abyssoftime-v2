import type { CvNewPageDataType } from "../cv-new.types";
import { CvNewSection } from "../shared/CvNewSection";

import { HTMLParser } from "@/lib/html-parser";
import type { CommonTextType } from "@/views/cv/common-text.types";

interface CvNewEducationProps {
  educations: CvNewPageDataType["educations"];
  commonText: CommonTextType;
}

export const CvNewEducation = ({ educations, commonText }: CvNewEducationProps) => {
  if (!educations || educations.length === 0) return null;

  return (
    <CvNewSection title={commonText.text["education"] ?? "Education"} id="education">
      <div className="space-y-4">
        {educations.map((item, idx) => (
          <div key={idx} className="print:break-inside-avoid">
            <h4 className="text-sm font-bold">{item.institution}</h4>
            <p className="mt-0.5 text-sm text-foreground/60">
              <span>{item.period}</span>
              <span className="mx-2 text-foreground/30">|</span>
              <span>{item.degree}</span>
            </p>
            {item.description && <HTMLParser content={item.description} className="mt-1 text-sm text-foreground/70" />}
          </div>
        ))}
      </div>
    </CvNewSection>
  );
};
