import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { signOut } from "@/app/login/actions"

export function SignOutButton({ name }: { name?: string }) {
  return (
    <form action={signOut}>
      <Button type="submit" variant="ghost" className="h-10 w-full justify-start px-2.5 text-ink">
        <LogOut aria-hidden="true" />
        <span className="truncate">Sign out{name ? ` (${name})` : ""}</span>
      </Button>
    </form>
  )
}
