import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  UserCog,
  UserPlus,
  LogIn,
  MessageCircle,
  Bot,
  Kanban,
  FileText,
  Wallet,
  RefreshCcw,
  ArrowRight,
  ArrowDown,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/workflow")({
  component: WorkflowPage,
});

type Step = {
  title: string;
  desc: string;
  icon: any;
  role: "Admin" | "Client" | "System" | "AI";
  href?: string;
};

const STEPS: Step[] = [
  {
    title: "Admin",
    desc: "StartAppLK admin signs in to the control panel.",
    icon: UserCog,
    role: "Admin",
    href: "/dashboard",
  },
  {
    title: "Create Client",
    desc: "Admin onboards a new business and provisions credentials.",
    icon: UserPlus,
    role: "Admin",
    href: "/clients",
  },
  {
    title: "Client Login",
    desc: "Client signs in to their dedicated workspace.",
    icon: LogIn,
    role: "Client",
    href: "/auth",
  },
  {
    title: "Connect WhatsApp",
    desc: "Client scans QR and links their WhatsApp number.",
    icon: MessageCircle,
    role: "Client",
    href: "/whatsapp",
  },
  {
    title: "AI Handles Leads",
    desc: "Gemini AI replies, qualifies, and captures new leads 24/7.",
    icon: Bot,
    role: "AI",
    href: "/ai-settings",
  },
  {
    title: "CRM",
    desc: "Leads flow into the pipeline — new, contacted, qualified, won.",
    icon: Kanban,
    role: "System",
    href: "/crm",
  },
  {
    title: "Invoices",
    desc: "Generate and send invoices to won leads automatically.",
    icon: FileText,
    role: "System",
    href: "/invoices",
  },
  {
    title: "Payment",
    desc: "Client receives payments and uploads slips for verification.",
    icon: Wallet,
    role: "Client",
    href: "/billing",
  },
  {
    title: "Subscription Renewal",
    desc: "Admin approves payment, subscription extends 30 days.",
    icon: RefreshCcw,
    role: "Admin",
    href: "/payments",
  },
];

const ROLE_STYLE: Record<Step["role"], string> = {
  Admin: "bg-primary/10 text-primary border-primary/20",
  Client: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  AI: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  System: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
};

function WorkflowPage() {
  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="text-center space-y-2">
        <Badge variant="outline" className="mb-2">
          End-to-End Flow
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight">
          How StartAppLK Works
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          From onboarding to renewal — the complete journey of a client on the
          AI Sales Agent platform.
        </p>
      </div>

      {/* Role legend */}
      <div className="flex flex-wrap justify-center gap-2">
        {(Object.keys(ROLE_STYLE) as Step["role"][]).map((r) => (
          <span
            key={r}
            className={`px-3 py-1 rounded-full text-xs font-medium border ${ROLE_STYLE[r]}`}
          >
            {r}
          </span>
        ))}
      </div>

      {/* Desktop horizontal flow */}
      <div className="hidden lg:block">
        <div className="grid grid-cols-3 gap-x-4 gap-y-6">
          {STEPS.map((step, i) => (
            <FlowCard key={step.title} step={step} index={i} total={STEPS.length} />
          ))}
        </div>
      </div>

      {/* Mobile/tablet vertical flow */}
      <div className="lg:hidden space-y-4">
        {STEPS.map((step, i) => (
          <div key={step.title}>
            <FlowCard step={step} index={i} total={STEPS.length} vertical />
            {i < STEPS.length - 1 && (
              <div className="flex justify-center py-2">
                <ArrowDown className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
      </div>

      <Card className="p-8 bg-gradient-to-br from-primary/10 via-background to-background border-primary/20">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">Ready to onboard a client?</h2>
            <p className="text-muted-foreground mt-1">
              Start the workflow by creating a new client workspace.
            </p>
          </div>
          <Link
            to="/clients"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
          >
            Create Client <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </Card>
    </div>
  );
}

function FlowCard({
  step,
  index,
  total,
  vertical = false,
}: {
  step: Step;
  index: number;
  total: number;
  vertical?: boolean;
}) {
  const Icon = step.icon;
  const isLast = index === total - 1;
  const content = (
    <Card className="group relative h-full p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all border-border/60 overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary to-primary/0 opacity-0 group-hover:opacity-100 transition" />
      <div className="flex items-start justify-between mb-3">
        <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <span className="text-3xl font-bold text-muted-foreground/20 leading-none">
          {String(index + 1).padStart(2, "0")}
        </span>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{step.title}</h3>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${ROLE_STYLE[step.role]}`}
          >
            {step.role}
          </span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {step.desc}
        </p>
      </div>
      {!isLast && !vertical && (
        <div className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 hidden lg:flex">
          <div className="h-7 w-7 rounded-full bg-background border border-border flex items-center justify-center shadow-sm">
            <ArrowRight className="h-3.5 w-3.5 text-primary" />
          </div>
        </div>
      )}
    </Card>
  );
  return step.href ? (
    <Link to={step.href} className="block h-full">
      {content}
    </Link>
  ) : (
    content
  );
}
