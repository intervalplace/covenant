import "./globals.css";
import { Providers } from "../src/providers";

export const metadata = {
  title: "Covenant v0",
  description: "Execution requires authorization.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
