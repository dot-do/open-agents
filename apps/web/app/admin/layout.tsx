import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminUserIdFromServerSession } from "@/lib/admin";

export const metadata = {
  title: "Admin",
  description: "Cross-tenant admin console",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const userId = await getAdminUserIdFromServerSession();
  if (!userId) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <nav className="flex items-center gap-4">
          <Link
            href="/admin"
            className="text-sm font-semibold text-foreground hover:underline"
          >
            Admin
          </Link>
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Cross-tenant ops
          </span>
          <span className="text-border">|</span>
          <Link
            href="/admin/tenants"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Tenants
          </Link>
          <Link
            href="/admin/webhooks"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Webhooks
          </Link>
        </nav>
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Back to app
        </Link>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
