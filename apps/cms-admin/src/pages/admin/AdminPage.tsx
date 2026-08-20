import { FileText, Image, KeyRound, Shield, Users } from "lucide-react";
import type { ComponentType } from "react";
import { Link } from "react-router-dom";

import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useContentTypes } from "@/hooks/useContentTypes";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface QuickLink {
  to: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  permission?: string;
  iconBg: string;
  iconFg: string;
  hoverBorder: string;
}

export function AdminPage() {
  const { displayName, permissions } = useAuth();
  const { data: contentTypes } = useContentTypes();

  const can = (permission: string) => hasPermission(permissions, permission);
  const contentTypeCount = contentTypes?.length ?? 0;

  const quickLinks: QuickLink[] = [
    {
      to: contentTypes?.[0] ? `/admin/content-type/${contentTypes[0].kind}-type/${contentTypes[0].slug}` : "/admin",
      label: "Content Manager",
      description: contentTypeCount > 0 ? `${contentTypeCount} content type${contentTypeCount === 1 ? "" : "s"}` : "No content types yet",
      icon: FileText,
      iconBg: "bg-primary/10",
      iconFg: "text-primary",
      hoverBorder: "hover:border-primary/50",
    },
    {
      to: "/admin/settings/media",
      label: "Media Library",
      description: "Upload and manage assets",
      icon: Image,
      permission: "media:read",
      iconBg: "bg-category-media/10",
      iconFg: "text-category-media",
      hoverBorder: "hover:border-category-media/50",
    },
    {
      to: "/admin/settings/users",
      label: "Users",
      description: "Manage admin accounts",
      icon: Users,
      permission: "user:read",
      iconBg: "bg-category-users/10",
      iconFg: "text-category-users",
      hoverBorder: "hover:border-category-users/50",
    },
    {
      to: "/admin/settings/roles",
      label: "Roles",
      description: "Configure role permissions",
      icon: Shield,
      permission: "role:read",
      iconBg: "bg-category-roles/10",
      iconFg: "text-category-roles",
      hoverBorder: "hover:border-category-roles/50",
    },
    {
      to: "/admin/settings/access-tokens",
      label: "Access Tokens",
      description: "Manage API credentials",
      icon: KeyRound,
      permission: "api_token:read",
      iconBg: "bg-category-tokens/10",
      iconFg: "text-category-tokens",
      hoverBorder: "hover:border-category-tokens/50",
    },
  ].filter((link) => !link.permission || can(link.permission));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{displayName ? `Welcome back, ${displayName}` : "Welcome back"}</h1>
        <p className="text-muted-foreground mt-1">Here's a quick way into the areas you manage.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {quickLinks.map(({ to, label, description, icon: Icon, iconBg, iconFg, hoverBorder }) => (
          <Link key={label} to={to} className="focus-visible:ring-ring rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-offset-2">
            <Card className={cn("h-full transition-colors hover:shadow-md", hoverBorder)}>
              <CardContent className="flex items-start gap-4">
                <div className={cn("rounded-lg p-2.5", iconBg, iconFg)}>
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-foreground font-medium">{label}</p>
                  <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
