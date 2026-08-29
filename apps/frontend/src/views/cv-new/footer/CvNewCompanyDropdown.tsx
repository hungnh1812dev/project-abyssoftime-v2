"use client";

import { useParams, useRouter } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CvNewListItemType } from "@/views/cv-new/cv-new.types";

interface CvNewCompanyDropdownProps {
  items: CvNewListItemType[];
}

export const CvNewCompanyDropdown = ({ items }: CvNewCompanyDropdownProps) => {
  const router = useRouter();
  const params = useParams();
  const locale = params?.locale ?? "en";

  if (items.length === 0) return null;

  return (
    <Select onValueChange={(documentId) => router.push(`/${locale}/cv-3/${documentId}`)}>
      <SelectTrigger className="h-8 w-44 text-xs">
        <SelectValue placeholder="Company CVs" />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.documentId} value={item.documentId} className="text-xs">
            {item.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
