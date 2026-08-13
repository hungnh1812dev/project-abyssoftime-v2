import LayoutMain from "@/components/layouts/main/LayoutMain";
import { BaseLayoutProps } from "@/types/BasicType";

export default async function MainLayoutIndex({ children, params }: BaseLayoutProps) {
  const { locale = "en" } = await params;
  return <LayoutMain locale={locale}>{children}</LayoutMain>;
}
