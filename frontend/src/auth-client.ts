import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_AUTH_BASE_URL || window.location.origin,
})

export const { signIn, signOut, signUp, useSession } = authClient
