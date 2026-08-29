import { unifyFetch } from "@/api/fetcher";
import graphqlApi from "@/api/graphqlApi";
import { registerService } from "@/api/registry";

import { GET_CV_NEW_BY_DOCUMENT_ID, GET_CV_NEW_LIST, GET_MAIN_CV_NEW } from "./cv-new.queries";
import type { CvNewListItemType, CvNewPageDataType } from "./cv-new.types";

export const CV_NEW_MAIN_KEY = "cv-new.main" as const;
export const CV_NEW_LIST_KEY = "cv-new.list" as const;
export const CV_NEW_BY_ID_KEY = "cv-new.by-id" as const;

async function _fetchMainCvNew(): Promise<CvNewPageDataType | null> {
  const pages = await graphqlApi.fetch<CvNewPageDataType[]>({
    body: { query: GET_MAIN_CV_NEW },
    selectKey: "cvPageNews.items",
    mock: "cv-new-main",
    next: { revalidate: 300, tags: ["cv"] },
  });
  return pages?.[0] ?? null;
}

async function _fetchCvNewList(): Promise<CvNewListItemType[]> {
  return graphqlApi.fetch<CvNewListItemType[]>({
    body: { query: GET_CV_NEW_LIST },
    selectKey: "cvPageNews.items",
    mock: "cv-new-list",
    next: { revalidate: 300, tags: ["cv"] },
  });
}

async function _fetchCvNewById(params?: unknown): Promise<CvNewPageDataType | null> {
  const { documentId } = (params ?? {}) as { documentId: string };
  const data = await graphqlApi.fetch<CvNewPageDataType>({
    body: { query: GET_CV_NEW_BY_DOCUMENT_ID, variables: { documentId } },
    selectKey: "cvPageNew",
    mock: `cv-new-${documentId}`,
    next: { revalidate: 300, tags: ["cv"] },
  });
  return data ?? null;
}

registerService({ key: CV_NEW_MAIN_KEY, driver: "graphql", execute: _fetchMainCvNew });
registerService({ key: CV_NEW_LIST_KEY, driver: "graphql", execute: _fetchCvNewList });
registerService({ key: CV_NEW_BY_ID_KEY, driver: "graphql", execute: _fetchCvNewById });

export async function getMainCvNew(): Promise<CvNewPageDataType | null> {
  return unifyFetch<CvNewPageDataType | null>({ apiKey: CV_NEW_MAIN_KEY });
}

export async function getCvNewList(): Promise<CvNewListItemType[]> {
  return unifyFetch<CvNewListItemType[]>({ apiKey: CV_NEW_LIST_KEY });
}

export async function getCvNewById(documentId: string): Promise<CvNewPageDataType | null> {
  return unifyFetch<CvNewPageDataType | null>({ apiKey: CV_NEW_BY_ID_KEY, params: { documentId } });
}
