import { createContext, useContext } from 'react'

export interface Session {
  signedIn: boolean
  setSignedIn: (signedIn: boolean) => void
}

export const SessionContext = createContext<Session>({ signedIn: false, setSignedIn: () => {} })

export const useSession = () => useContext(SessionContext)
