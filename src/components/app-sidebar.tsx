import { Link, useRouterState } from "@tanstack/react-router";
import logoAsset from "@/assets/logo.png.asset.json";
import {
  LayoutDashboard,
  Radio,
  MessageCircle,
  Facebook,
  Instagram,
  Bot,
  BookOpen,
  Inbox,
  Users,
  UserCheck,
  ListChecks,
  ShieldAlert,
  Server,
  Settings,
  Sparkles,
  Calendar,
  Send,
  Kanban,
  DollarSign,
  FileText,
  Briefcase,
  CreditCard,
  Wallet,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useRole } from "@/hooks/use-role";

type Item = { title: string; url: string; icon: any; roles?: ("admin" | "client")[] };
type Group = { label: string; items: Item[] };

const groups: Group[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Channels",
    items: [
      { title: "Channels", url: "/channels", icon: Radio, roles: ["admin"] },
      { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle, roles: ["admin"] },
      { title: "Messenger", url: "/messenger", icon: Facebook, roles: ["admin"] },
      { title: "Instagram", url: "/instagram", icon: Instagram, roles: ["admin"] },
    ],
  },
  {
    label: "AI",
    items: [
      { title: "AI Agent Settings", url: "/ai-settings", icon: Bot, roles: ["admin"] },
      { title: "Gemini API", url: "/api-settings", icon: Sparkles, roles: ["admin"] },
      { title: "Business Knowledge", url: "/business-knowledge", icon: BookOpen, roles: ["admin"] },
      { title: "Reply Rules", url: "/reply-rules", icon: ListChecks, roles: ["admin"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Conversations", url: "/conversations", icon: Inbox, roles: ["admin"] },
      { title: "Appointments", url: "/appointments", icon: Calendar },
      { title: "Sales CRM", url: "/crm", icon: Kanban, roles: ["admin"] },
      { title: "Revenue History", url: "/revenue", icon: DollarSign },
      { title: "Invoices", url: "/invoices", icon: FileText },
      { title: "Leads", url: "/leads", icon: Users },
      { title: "Lead Follow-ups", url: "/lead-followups", icon: Send, roles: ["admin"] },
      { title: "Human Takeover", url: "/human-takeover", icon: UserCheck, roles: ["admin"] },
      { title: "Risk Control", url: "/risk", icon: ShieldAlert, roles: ["admin"] },
      { title: "VPS Bots", url: "/vps", icon: Server, roles: ["admin"] },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Clients", url: "/clients", icon: Briefcase, roles: ["admin"] },
      { title: "Subscriptions", url: "/subscriptions", icon: CreditCard, roles: ["admin"] },
      { title: "Payment Approvals", url: "/payments", icon: Wallet, roles: ["admin"] },
      { title: "Revenue Analytics", url: "/revenue-analytics", icon: TrendingUp, roles: ["admin"] },
    ],
  },

  {
    label: "Account",
    items: [
      { title: "Billing", url: "/billing", icon: CreditCard },
      { title: "Settings", url: "/settings", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (p: string) => currentPath === p;
  const { role } = useRole();
  const effectiveRole = role ?? "client";

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => !it.roles || it.roles.includes(effectiveRole)),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <img
            src={logoAsset.url}
            alt="AI Sales Agent Logo"
            className="h-8 w-8 rounded-md object-cover"
            width={32}
            height={32}
          />
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">AI Sales Agent</span>
            <span className="text-xs text-muted-foreground">by StartAppLK</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {visibleGroups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
