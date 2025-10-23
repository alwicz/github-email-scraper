// app/layout.tsx
import "./globals.css";

export const metadata = {
  title: "GitHub Email Finder",
  description: "Find commit emails for GitHub users and org members.",
};

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
