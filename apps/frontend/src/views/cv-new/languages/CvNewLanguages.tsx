import type { CvNewPageDataType } from "../cv-new.types";
import { CvNewSection } from "../shared/CvNewSection";

import type { CommonTextType } from "@/views/cv/common-text.types";

interface CvNewLanguagesProps {
  languages: CvNewPageDataType["languages"];
  commonText: CommonTextType;
}

export const CvNewLanguages = ({ languages, commonText }: CvNewLanguagesProps) => {
  if (!languages || languages.length === 0) return null;

  return (
    <CvNewSection title={commonText.text["languages"] ?? "Languages"} id="languages">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {languages.map((lang, idx) => (
          <div key={idx} className="text-sm">
            <span className="font-semibold">{lang.language}</span>
            <span className="ml-1.5 text-xs text-foreground/55">{lang.level}</span>
          </div>
        ))}
      </div>
    </CvNewSection>
  );
};
