import { Link, useRouterState } from "@tanstack/react-router";
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

const groups = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Channels",
    items: [
      { title: "Channels", url: "/channels", icon: Radio },
      { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle },
      { title: "Messenger", url: "/messenger", icon: Facebook },
      { title: "Instagram", url: "/instagram", icon: Instagram },
    ],
  },
  {
    label: "AI",
    items: [
      { title: "AI Agent Settings", url: "/ai-settings", icon: Bot },
      { title: "Gemini API", url: "/api-settings", icon: Sparkles },
      { title: "Business Knowledge", url: "/business-knowledge", icon: BookOpen },
      { title: "Reply Rules", url: "/reply-rules", icon: ListChecks },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Conversations", url: "/conversations", icon: Inbox },
      { title: "Appointments", url: "/appointments", icon: Calendar },
      { title: "Sales CRM", url: "/crm", icon: Kanban },
      { title: "Leads", url: "/leads", icon: Users },
      { title: "Lead Follow-ups", url: "/lead-followups", icon: Send },
      { title: "Human Takeover", url: "/human-takeover", icon: UserCheck },
      { title: "Risk Control", url: "/risk", icon: ShieldAlert },
      { title: "VPS Bots", url: "/vps", icon: Server },
    ],
  },
  {
    label: "Account",
    items: [{ title: "Settings", url: "/settings", icon: Settings }],
  },
];

export function AppSidebar() {
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (p: string) => currentPath === p;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-primary to-chart-4 text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">StartAppLK</span>
            <span className="text-xs text-muted-foreground">AI Sales Agent</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
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
