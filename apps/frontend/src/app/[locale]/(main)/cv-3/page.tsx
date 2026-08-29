import type { Metadata } from "next";

import CvNewPage from "@/views/cv-new/CvNewPage";

export const metadata: Metadata = {
  title: "CV",
  description: "CV của Nguyen Huy Hung — Senior React Frontend Developer với 6+ năm kinh nghiệm xây dựng ứng dụng web hiện đại.",
};

export default async function CvNewIndexPage() {
  return <CvNewPage />;
}
