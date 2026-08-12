import { requireRole } from "@/lib/auth/require-role";
import Secret from "@/views/secret/Secret";

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function SecretIndexPage({ params }: Props) {
  const { locale } = await params;
  await requireRole("/secret", locale);

  return <Secret />;
}
