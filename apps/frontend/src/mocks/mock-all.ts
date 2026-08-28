import { ArchitectureKnowledgePage_MockData, ArchitectureKnowledgePageMeta_MockData, architectureKnowledgeSectionMocks } from "./architecture-knowledge";
import { CVCommonText_MockData } from "./cv-common-text";
import { CVContact_MockData } from "./cv-contact";
import { CVDemoAbc123_MockData } from "./cv-demo-abc123";
import { CVElegantList_MockData } from "./cv-elegant-list";
import { CVElegantMain_MockData } from "./cv-elegant-main";
import { CVFeLeadJp2026_MockData } from "./cv-fe-lead-jp2026";
import { CVList_MockData } from "./cv-list";
import { CVMain_MockData } from "./cv-main";
import { CVNewList_MockData } from "./cv-new-list";
import { CVNewMain_MockData } from "./cv-new-main";
import { EnVocabWordGroups_MockData } from "./en-vocab-word-groups";
import { EnVocabWordList_MockData } from "./en-vocab-word-list";
import { GoKnowledgePageMeta_MockData, goKnowledgeSectionMocks } from "./go-knowledge";
import { Header_MockData } from "./header";
import { HomePage_MockData } from "./home";
import { ReactKnowledgePage_MockData, ReactKnowledgePageMeta_MockData, reactKnowledgeSectionMocks } from "./react-knowledge";
import { VaccinePage_MockData } from "./vaccine";

export const MockView: Record<string, unknown> = {
  // CV
  "cv-main": CVMain_MockData,
  "cv-list": CVList_MockData,
  "cv-contact": CVContact_MockData,
  "cv-common-text": CVCommonText_MockData,
  "cv-demo-abc123": CVDemoAbc123_MockData,
  "cv-fe-lead-jp2026": CVFeLeadJp2026_MockData,
  // Vaccine
  "vaccine-page": VaccinePage_MockData,
  // Home
  "home-page": HomePage_MockData,
  // Header
  header: Header_MockData,
  // React Knowledge
  "react-knowledge-page": ReactKnowledgePage_MockData,
  "react-knowledge-page-meta": ReactKnowledgePageMeta_MockData,
  ...reactKnowledgeSectionMocks,
  // Architecture & Design Patterns
  "architecture-knowledge-page": ArchitectureKnowledgePage_MockData,
  "architecture-knowledge-meta": ArchitectureKnowledgePageMeta_MockData,
  ...architectureKnowledgeSectionMocks,
  // Go Knowledge
  "go-knowledge-page-meta": GoKnowledgePageMeta_MockData,
  ...goKnowledgeSectionMocks,
  // EN Vocabulary v3
  "en-vocab-word-list": EnVocabWordList_MockData,
  "en-vocab-word-groups": EnVocabWordGroups_MockData,
  // CV Elegant
  "cv-elegant-main": CVElegantMain_MockData,
  "cv-elegant-list": CVElegantList_MockData,
  // CV New
  "cv-new-main": CVNewMain_MockData,
  "cv-new-list": CVNewList_MockData,
};
