import { requireRole } from "@/lib/auth/require-role";
import AccountManager from "@/views/account/AccountManager";

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function AccountIndexPage({ params }: Props) {
  const { locale } = await params;
  await requireRole("/account", locale);

  return <AccountManager />;
}
