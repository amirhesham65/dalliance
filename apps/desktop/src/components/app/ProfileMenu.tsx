import { LogIn, LogOut, Settings, UserRound } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Kbd } from '@/components/ui/kbd'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { AccountView } from '@dalliance/shared/ipc'
import { actions, getApi, useNotebook } from '@/store/notebook-store'

/** Up to two letters for the avatar: the first of the name's first two words, or of the email's. */
function initials(user: { name: string; email: string }) {
  const words = (user.name.trim() || user.email.split('@')[0]).split(/[\s._-]+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

/** The account at the right of the top bar: who is signed in, and the ways to sign in or out. */
export function ProfileMenu({ mod }: { mod: string }) {
  const account = useNotebook((s) => s.account)
  const api = getApi()
  if (!api) return null
  const user = account?.user ?? null

  const act = async (call: () => Promise<AccountView>) => {
    try {
      useNotebook.setState({ account: await call() })
    } catch (err) {
      if (account) useNotebook.setState({ account: { ...account, error: err instanceof Error ? err.message : String(err) } })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={user ? `Account: ${user.name || user.email}` : 'Account'}
        className="flex size-7 items-center justify-center rounded-full outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-background"
      >
        <Avatar size="sm" className={cn(!account || account.checking ? 'opacity-50' : undefined)}>
          <AvatarFallback className="text-[10.5px] font-medium">{user ? initials(user) : <UserRound className="size-3.5" />}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2.5 py-2 font-normal">
          <Avatar>
            <AvatarFallback className="text-xs font-medium">{user ? initials(user) : <UserRound className="size-4" />}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-foreground">{user ? user.name || user.email : 'Not signed in'}</p>
            <p className="truncate text-xs text-muted-foreground">
              {user ? user.email : account?.waiting ? 'Finish signing in in your browser' : 'An account is optional'}
            </p>
          </div>
        </DropdownMenuLabel>
        {account?.error && <p className="px-2 pb-1.5 text-xs text-destructive">{account.error}</p>}
        <DropdownMenuSeparator />
        {!user && (
          <DropdownMenuItem disabled={!account || account.checking} onSelect={() => void act(() => api.signIn())}>
            <LogIn />
            {account?.waiting ? 'Open the sign-in page again' : 'Sign in…'}
          </DropdownMenuItem>
        )}
        {account?.waiting && !user && (
          <DropdownMenuItem onSelect={() => actions.openSettings('account')}>
            <UserRound />
            Enter a code…
          </DropdownMenuItem>
        )}
        {user && (
          <DropdownMenuItem onSelect={() => actions.openSettings('account')}>
            <UserRound />
            Account
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => actions.openSettings()}>
          <Settings />
          Settings
          <Kbd className="ml-auto">{mod},</Kbd>
        </DropdownMenuItem>
        {user && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void act(() => api.signOut())}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
