import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "StartAppLK AI Sales Agent" },
      { name: "description", content: "Multi-channel AI sales dashboard for WhatsApp, Messenger and Instagram." },
    ],
  }),
  component: () => <Navigate to="/dashboard" replace />,
});
