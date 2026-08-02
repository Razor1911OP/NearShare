import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import nearshareCss from "../nearshare/index.css?url";

// The NearShare UI is entirely browser-driven (WebSocket, drag gestures,
// localStorage), so it is loaded only after hydration.
const NearShareApp = lazy(() => import("../nearshare/App.jsx"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NearShare — Drag files across your devices" },
      {
        name: "description",
        content:
          "Send files between your phone and PC over your local network with a drag gesture. No cloud, no accounts.",
      },
      { property: "og:title", content: "NearShare — Drag files across your devices" },
      {
        property: "og:description",
        content:
          "Send files between your phone and PC over your local network with a drag gesture. No cloud, no accounts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "stylesheet", href: nearshareCss }],
  }),
  component: Index,
});

function Index() {
  return (
    <ClientOnly fallback={<div style={{ minHeight: "100svh" }} />}>
      <Suspense fallback={<div style={{ minHeight: "100svh" }} />}>
        <NearShareApp />
      </Suspense>
    </ClientOnly>
  );
}
