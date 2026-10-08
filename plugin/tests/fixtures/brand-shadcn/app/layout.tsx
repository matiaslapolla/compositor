import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
const instrumentSans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });
export default function Layout({ children }) { return <html className={instrumentSans.variable}>{children}</html>; }
