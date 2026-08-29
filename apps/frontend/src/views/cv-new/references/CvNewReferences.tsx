import type { CvNewPageDataType } from "../cv-new.types";
import { CvNewSection } from "../shared/CvNewSection";

import type { CommonTextType } from "@/views/cv/common-text.types";

interface CvNewReferencesProps {
  references: CvNewPageDataType["references"];
  commonText: CommonTextType;
}

export const CvNewReferences = ({ references, commonText }: CvNewReferencesProps) => {
  if (!references || references.length === 0) return null;

  return (
    <CvNewSection title={commonText.text["references"] ?? "References"} id="references">
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        {references.map((ref, idx) => (
          <div key={idx} className="text-sm">
            <div className="font-semibold">{ref.name}</div>
            {ref.role && <div className="text-xs text-foreground/55">{ref.role}</div>}
            {ref.phone && (
              <div className="text-xs font-semibold">
                {commonText.text["phone"] ?? "Phone"}:{" "}
                <a href={`tel:${ref.phone}`} className="text-xs text-primary hover:underline">
                  {ref.phone}
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </CvNewSection>
  );
};
