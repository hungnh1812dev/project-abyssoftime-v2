import type { CommonTextType } from "@/views/cv/common-text.types";
import type { CvContactType } from "@/views/cv/contact.types";
import { PrintButton } from "@/views/cv/footer/PrintButton";

import styles from "./CvNewPage.module.css";
import type { CvNewListItemType, CvNewPageDataType } from "./cv-new.types";
import { CvNewEducation } from "./education/CvNewEducation";
import { CvNewExperience } from "./experience/CvNewExperience";
import { CvNewCompanyDropdown } from "./footer/CvNewCompanyDropdown";
import { CvNewHeader } from "./header/CvNewHeader";
import { CvNewLanguages } from "./languages/CvNewLanguages";
import { CvNewReferences } from "./references/CvNewReferences";
import { CvNewSkills } from "./skills/CvNewSkills";
import { CvNewSummary } from "./summary/CvNewSummary";

const ANCHOR_SECTIONS = [
  { id: "about-me", label: "About Me" },
  { id: "experience", label: "Experience" },
  { id: "skills", label: "Skills" },
  { id: "education", label: "Education" },
  { id: "languages", label: "Languages" },
  { id: "references", label: "References" },
];

interface CvNewPageContentProps {
  data: CvNewPageDataType;
  contact: CvContactType;
  commonText: CommonTextType;
  cvList: CvNewListItemType[];
}

export const CvNewPageContent = ({ data, contact, commonText, cvList }: CvNewPageContentProps) => {
  return (
    <div className={`relative mx-auto max-w-[800px] bg-background text-foreground/90 ${styles.cvContainer}`}>
      <CvNewHeader contact={contact} position={data.position} />

      <div className={`px-5 py-6 sm:px-8 sm:py-8 ${styles.content}`}>
        <nav className="mb-3 hidden justify-center gap-5 text-xs font-medium uppercase tracking-wider text-foreground/45 sm:flex print:hidden">
          {ANCHOR_SECTIONS.map(({ id, label }) => (
            <a key={id} href={`#${id}`} className="transition-colors hover:text-foreground hover:underline">
              {label}
            </a>
          ))}
        </nav>

        <CvNewSummary summary={data.summary} commonText={commonText} />
        <CvNewExperience experiences={data.experiences} commonText={commonText} />
        <CvNewSkills skills={data.skills} commonText={commonText} />
        <CvNewEducation educations={data.educations} commonText={commonText} />
        <CvNewLanguages languages={data.languages} commonText={commonText} />
        <CvNewReferences references={data.references} commonText={commonText} />

        <div className="mt-5 flex items-center justify-center gap-3 print:hidden">
          <CvNewCompanyDropdown items={cvList} />
          <PrintButton />
        </div>
      </div>
    </div>
  );
};
