import { createFileRoute } from "@tanstack/react-router";
import { MetaConnectPage } from "./messenger";

export const Route = createFileRoute("/_authenticated/instagram")({
  component: () => <MetaConnectPage kind="instagram" />,
  errorComponent: ({ error }) => <div className="p-6 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});
