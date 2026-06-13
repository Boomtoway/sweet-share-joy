import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle, Facebook, Instagram, Radio } from "lucide-react";

export const Route = createFileRoute("/_authenticated/channels")({
  head: () => ({ meta: [{ title: "Channels — StartAppLK" }] }),
  component: ChannelsPage,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

type ChannelType = "whatsapp" | "messenger" | "instagram";
type ChannelStatus = "disconnected" | "connecting" | "connected" | "error";

interface ChannelRow {
  id: string;
  name: string;
  type: ChannelType;
  status: ChannelStatus;
  updated_at: string;
}

const CHANNELS: Array<{
  type: ChannelType;
  label: string;
  description: string;
  icon: typeof MessageCircle;
}> = [
  { type: "whatsapp", label: "WhatsApp", description: "Manage WhatsApp automation and VPS bot connection.", icon: MessageCircle },
  { type: "messenger", label: "Messenger", description: "Connect Facebook Pages and route inbox messages.", icon: Facebook },
  { type: "instagram", label: "Instagram", description: "Connect Instagram Business DMs for lead capture.", icon: Instagram },
];

function ChannelLink({ type }: { type: ChannelType }) {
  if (type === "whatsapp") return <Button asChild><Link to="/whatsapp">Open</Link></Button>;
  if (type === "messenger") return <Button asChild><Link to="/messenger">Open</Link></Button>;
  return <Button asChild><Link to="/instagram">Open</Link></Button>;
}

function ChannelsPage() {
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<ChannelRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("workspace_id")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (!profile?.workspace_id) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("channels")
        .select("id,name,type,status,updated_at")
        .eq("workspace_id", profile.workspace_id)
        .order("updated_at", { ascending: false });
      setChannels((data ?? []) as ChannelRow[]);
      setLoading(false);
    })();
  }, []);

  const byType = useMemo(() => {
    const map = new Map<ChannelType, ChannelRow[]>();
    for (const channel of channels) {
      map.set(channel.type, [...(map.get(channel.type) ?? []), channel]);
    }
    return map;
  }, [channels]);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-primary/10 p-2"><Radio className="h-5 w-5 text-primary" /></div>
        <div>
          <h1 className="text-2xl font-semibold">Channels</h1>
          <p className="text-sm text-muted-foreground">Connect and monitor every customer messaging channel.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {CHANNELS.map((config) => {
          const Icon = config.icon;
          const rows = byType.get(config.type) ?? [];
          const connected = rows.filter((row) => row.status === "connected").length;
          return (
            <Card key={config.type}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-primary" /> {config.label}
                </CardTitle>
                <CardDescription>{config.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Connected accounts</span>
                  <Badge variant={connected > 0 ? "default" : "outline"}>{connected}</Badge>
                </div>
                {rows.length > 0 && (
                  <div className="space-y-2">
                    {rows.slice(0, 3).map((row) => (
                      <div key={row.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                        <span className="truncate">{row.name}</span>
                        <Badge variant={row.status === "connected" ? "default" : row.status === "error" ? "destructive" : "secondary"}>{row.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
                <ChannelLink type={config.type} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}