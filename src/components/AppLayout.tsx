import { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Newspaper, CalendarDays, Pill, FolderOpen, Heart, LogOut } from "lucide-react";
import { signOut } from "@/lib/auth-client";

const tabs = [
  { path: "/", label: "Feed", icon: Newspaper },
  { path: "/appointments", label: "Appts", icon: CalendarDays },
  { path: "/medications", label: "Meds", icon: Pill },
  { path: "/documents", label: "Docs", icon: FolderOpen },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/50 px-5 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart className="w-6 h-6 text-accent" fill="hsl(var(--accent))" />
            <span className="text-xl font-extrabold text-foreground tracking-tight">
              Tend<span className="text-primary">Well</span>
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 pb-24 page-enter ph-no-capture">
        <div className="max-w-2xl mx-auto px-5 py-5">
          {children}
        </div>
      </main>

      {/* Bottom Tab Nav */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-card/90 backdrop-blur-md border-t border-border/50">
        <div className="max-w-2xl mx-auto flex">
          {tabs.map(({ path, label, icon: Icon }) => {
            const active = pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors duration-200 ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={active ? 2.5 : 2} />
                <span className="text-xs font-semibold">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
