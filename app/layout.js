import { Great_Vibes, Playfair_Display, Work_Sans } from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
});

const greatVibes = Great_Vibes({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-great-vibes",
});

const workSans = Work_Sans({
  subsets: ["latin"],
  variable: "--font-work-sans",
});

export const metadata = {
  title: "Bolo de Mãe JP Confeitaria",
  description: "Cardápio e painel administrativo da Bolo de Mãe JP Confeitaria.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="pt-BR"
      className={`${playfair.variable} ${greatVibes.variable} ${workSans.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
