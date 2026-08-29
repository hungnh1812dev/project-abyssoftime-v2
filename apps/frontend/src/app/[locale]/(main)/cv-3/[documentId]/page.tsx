import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getCommonText } from "@/views/cv/common-text.service";
import { getContact } from "@/views/cv/contact.service";
import type { CommonTextType, CvContactType, CvNewPageDataType } from "@/views/cv-new/CvNewPage";
import { CvNewPageContent } from "@/views/cv-new/CvNewPageContent";
import { getCvNewById } from "@/views/cv-new/cv-new.service";

interface Props {
  params: Promise<{ locale: string; documentId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { documentId } = await params;
  return { title: `CV — ${documentId}` };
}

export default async function CvNewChildPage({ params }: Props) {
  const { documentId } = await params;

  let data: CvNewPageDataType | null;
  let contact: CvContactType;
  let commonText: CommonTextType;

  try {
    [data, contact, commonText] = (await Promise.all([getCvNewById(documentId), getContact(), getCommonText()])) as [CvNewPageDataType | null, CvContactType, CommonTextType];
  } catch {
    notFound();
  }

  if (!data) notFound();

  return <CvNewPageContent data={data} contact={contact!} commonText={commonText!} cvList={[]} />;
}
