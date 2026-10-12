"use client"

import { NavLink } from "./nav-link"
import { adminNav } from "./nav-items"

export function AdminNav({ pendingCount = 0, onNavigate }: { pendingCount?: number; onNavigate?: () => void }) {
  return (
    <nav aria-label="Console">
      <ul className="space-y-0.5">
        {adminNav.map(({ href, label, icon: Icon, exact, badge }) => (
          <li key={href}>
            <NavLink
              href={href}
              exact={exact}
              icon={<Icon aria-hidden="true" />}
              badge={badge === "pending" ? pendingCount : undefined}
              onNavigate={onNavigate}
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
