import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Mail, MessageCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/subscription-expired")({
  head: () => ({ meta: [{ title: "Subscription Expired — StartAppLK" }] }),
  component: ExpiredPage,
});

function ExpiredPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <Card className="relative max-w-xl w-full overflow-hidden border-border/60 bg-card/60 backdrop-blur-sm">
        <div className="absolute inset-0 opacity-[0.08] bg-gradient-to-br from-rose-500 via-orange-500 to-amber-500" />
        <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-rose-500/30 blur-3xl" />
        <CardContent className="relative p-10 text-center space-y-5">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center shadow-lg shadow-rose-500/30">
            <AlertTriangle className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Subscription Expired</h1>
            <p className="mt-2 text-muted-foreground">
              Please contact StartAppLK to renew your plan and restore access to your AI sales agent.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Button asChild>
              <a href="mailto:support@startapplk.com">
                <Mail className="h-4 w-4 mr-2" /> Email Support
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="https://wa.me/94000000000" target="_blank" rel="noreferrer">
                <MessageCircle className="h-4 w-4 mr-2" /> WhatsApp Us
              </a>
            </Button>
          </div>
          <div className="pt-4 text-xs text-muted-foreground">
            <Link to="/dashboard" className="hover:underline">Return to dashboard</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
