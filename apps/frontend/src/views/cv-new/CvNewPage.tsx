import { getCommonText } from "@/views/cv/common-text.service";
import { getContact } from "@/views/cv/contact.service";

import { getCvNewList, getMainCvNew } from "./cv-new.service";
import { CvNewPageContent } from "./CvNewPageContent";

export type { CvNewListItemType, CvNewPageDataType } from "./cv-new.types";
export type { CvContactType } from "@/views/cv/contact.types";
export type { CommonTextType } from "@/views/cv/common-text.types";

const CvNewPage = async () => {
  const [mainCv, cvList, contact, commonText] = await Promise.all([getMainCvNew(), getCvNewList(), getContact(), getCommonText()]);

  return <CvNewPageContent data={mainCv!} contact={contact!} commonText={commonText!} cvList={cvList} />;
};

export default CvNewPage;
