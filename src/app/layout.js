import "./globals.css";

export const metadata = {
  title: "Graph",
  description: "Graph visualization with React Flow",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
