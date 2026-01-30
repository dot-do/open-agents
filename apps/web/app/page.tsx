import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/session/constants";
import { HomePage } from "./home-page";

export default async function Home() {
  const store = await cookies();
  const hasSessionCookie = Boolean(store.get(SESSION_COOKIE_NAME)?.value);

  return <HomePage hasSessionCookie={hasSessionCookie} />;
}
