import type { CommonTextType } from "@/views/cv/common-text.types";
import type { CvContactType } from "@/views/cv/contact.types";

import type { CvNewPageDataType } from "./cv-new.types";
import { CvNewExperience } from "./experience/CvNewExperience";
import { CvNewHeader } from "./header/CvNewHeader";
import { CvNewSummary } from "./summary/CvNewSummary";

interface CvNewPageContentProps {
  data: CvNewPageDataType;
  contact: CvContactType;
  commonText: CommonTextType;
}

export const CvNewPageContent = ({ data, contact, commonText }: CvNewPageContentProps) => {
  return (
    <div className="relative mx-auto max-w-[800px] bg-background text-foreground/90">
      <CvNewHeader contact={contact} position={data.position} />

      <div className="px-5 py-6 sm:px-8 sm:py-8">
        <CvNewSummary summary={data.summary} commonText={commonText} />
        <CvNewExperience experiences={data.experiences} commonText={commonText} />
      </div>
    </div>
  );
};
