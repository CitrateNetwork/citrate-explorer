import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f1eee6",
        color: "#0e0f0c",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div>
        <h1 style={{ fontSize: 22, margin: 0 }}>Page not found</h1>
        <p style={{ color: "#8a8c84", marginTop: 8 }}>
          That route is not part of CitrateScan.
        </p>
        <Link
          href="/"
          style={{ color: "#4f7304", marginTop: 16, display: "inline-block" }}
        >
          ← Back to the explorer
        </Link>
      </div>
    </main>
  );
}
