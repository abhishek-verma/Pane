import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { type Query, QueryClient } from '@tanstack/react-query'
import {
  type AsyncStorage,
  PersistQueryClientProvider,
} from '@tanstack/react-query-persist-client'
import { del, get, set } from 'idb-keyval'
import type { FC, ReactNode } from 'react'

/** Keep in-memory / IDB cache short so PI page docs do not linger in LO-space. */
const QUERY_GC_TIME_MS = 1000 * 60 * 45 // 45 minutes

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: QUERY_GC_TIME_MS,
    },
  },
})

const idbStorage: AsyncStorage<string> = {
  getItem: (key: string) => get<string>(key).then((v) => v ?? null),
  setItem: (key: string, value: string) => set(key, value),
  removeItem: (key: string) => del(key),
}

const asyncStoragePersister = createAsyncStoragePersister({
  storage: idbStorage,
})

/**
 * Do not dehydrate PI page docs or chat transcripts into IDB — they are the
 * main LO-space risk when every extension shell rehydrates on boot.
 */
export function shouldDehydrateQueryForLoContainment(query: Query): boolean {
  const key = query.queryKey
  if (!Array.isArray(key) || key.length === 0) return false
  const root = key[0]
  if (root === 'pi') return false
  if (root === 'sidepanel-chat-history') return false
  if (root === 'harness-agent-history') return false
  // GraphQL / other conversation payloads
  if (typeof root === 'string' && /conversation/i.test(root)) return false
  return true
}

export const QueryProvider: FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <PersistQueryClientProvider
      persistOptions={{
        persister: asyncStoragePersister,
        maxAge: QUERY_GC_TIME_MS,
        dehydrateOptions: {
          shouldDehydrateQuery: shouldDehydrateQueryForLoContainment,
        },
      }}
      client={queryClient}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
